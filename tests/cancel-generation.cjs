const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const cancelCode = source.slice(source.indexOf('async function cancelImageGeneration('), source.indexOf('async function generateDirect('));
const imageCode = source.slice(source.indexOf('async function generateImage('), source.indexOf('const workflowSteps ='));
const generationCode = source.slice(source.indexOf('async function generateFromSummary('), source.indexOf('async function runForMessage('));
const handlerCode = source.slice(source.indexOf('function bindGenerationClickHandler('), source.indexOf('function settingField('));
const flush = () => new Promise(resolve => setImmediate(resolve));
const queueItem = (id, client) => [0, id, {}, { client_id: client }];

function harness() {
  const message = { extra: { sceneDrawImage: '/old-image.png' } };
  const jobs = new WeakMap(), running = new Set(), notices = [], requests = [], savedImages = [];
  let releaseImage, rejectImage, activeClient;
  const context = vm.createContext({
    chat: [message], imageGenerations: jobs, runningGenerations: running,
    settings: () => ({ enabled: true, useComfyProxy: true, comfyUrl: 'http://127.0.0.1:8188' }),
    clientId: 'page', logPrefix: '[test]', URL, AbortSignal,
    Date, setTimeout: callback => { queueMicrotask(callback); return 0; },
    renderSidebar: () => {}, debug: () => {},
    console: { warn: () => {}, error: () => {} },
    notify: (kind, text) => notices.push({ kind, text }),
    workflowWithPrompt: () => ({}),
    comfyProgressUrl: id => 'ws://192.168.0.7:8188/base/ws?clientId=' + id,
    watchComfyProgress: () => () => {},
    imageSizeForRatio: ratio => ratio === '1:1' ? { width: 1200, height: 1200 } : null,
    saveChatConditional: async () => {}, renderImage: () => {},
    persistImage: async image => { savedImages.push(image); return '/new-image.png'; },
    setWorkflowState: (id, msg, step, detail) => { msg.extra.sceneDrawState = { step, detail }; },
    generateProxy: (workflow, progress, client) => {
      activeClient = client;
      return new Promise((resolve, reject) => { releaseImage = resolve; rejectImage = reject; });
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/queue')) return { ok: true, json: async () => ({ queue_running: [queueItem('other-job', 'another-client'), queueItem('own/job', activeClient)], queue_pending: [] }) };
      if (url.endsWith('/api/jobs/own%2Fjob/cancel')) return { ok: true, status: 200, json: async () => ({ cancelled: true }) };
      throw new Error('Unexpected control request ' + url);
    },
  });
  vm.runInContext(cancelCode + imageCode + generationCode, context);
  return { context, message, jobs, running, notices, requests, savedImages, release: value => releaseImage(value), reject: error => rejectImage(error), client: () => activeClient };
}

(async () => {
  const h = harness();
  const generation = h.context.generateFromSummary(0, h.message, 'scene', '1:1');
  await flush();
  assert(h.jobs.has(h.message));
  const job = h.jobs.get(h.message);
  assert.equal(job.controlBase, 'http://192.168.0.7:8188/base', 'Snapshot the mobile control address and preserve its prefix');
  await h.context.cancelImageGeneration(0);
  assert.equal(job.cancelled, true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, 'http://192.168.0.7:8188/base/api/jobs/own%2Fjob/cancel');
  assert.equal(h.requests[1].options.body, '{}');
  assert(!h.requests.some(request => request.url.endsWith('/interrupt') || (request.url.endsWith('/queue') && request.options.method === 'POST')), 'Never issue a global interrupt or delete queued jobs');
  await h.context.cancelImageGeneration(0);
  assert.equal(h.requests.length, 2, 'Repeated clicks cannot send duplicate cancellation');
  h.reject(new Error('ComfyUI execution interrupted'));
  await generation;
  assert.equal(h.message.extra.sceneDrawState.step, 'cancelled');
  assert.equal(h.message.extra.sceneDrawImage, '/old-image.png', 'Existing images survive cancellation');
  assert.equal(h.savedImages.length, 0);
  assert.equal(h.jobs.has(h.message), false);
  assert.equal(h.running.size, 0);
  assert.equal(h.notices.at(-1).kind, 'info', 'Intentional cancellation is not a generation failure');
  const retry = h.context.generateFromSummary(0, h.message, 'retry', '1:1');
  await flush(); h.release('image'); await retry;
  assert.equal(h.message.extra.sceneDrawState.step, 'completed');
  assert.equal(h.message.extra.sceneDrawImage, '/new-image.png');

  // If execution exits before the cancel acknowledgement arrives, classification must wait for it.
  const race = harness();
  const racingGeneration = race.context.generateFromSummary(0, race.message, 'scene', '1:1');
  await flush();
  const normalFetch = race.context.fetch;
  let acknowledge;
  race.context.fetch = async (url, options) => {
    if (!url.endsWith('/cancel')) return normalFetch(url, options);
    race.reject(new Error('interrupted before cancel HTTP response'));
    return { ok: true, status: 200, json: () => new Promise(resolve => { acknowledge = () => resolve({ cancelled: true }); }) };
  };
  const raceCancel = race.context.cancelImageGeneration(0);
  await flush();
  assert.equal(race.message.extra.sceneDrawState.step, 'submitting', 'Do not mark a pending cancel acknowledgement as a failed job');
  acknowledge(); await raceCancel; await racingGeneration;
  assert.equal(race.message.extra.sceneDrawState.step, 'cancelled');

  const queued = harness();
  const queuedGeneration = queued.context.generateFromSummary(0, queued.message, 'scene', '1:1');
  await flush();
  const queuedFetch = queued.context.fetch;
  let polls = 0;
  queued.context.fetch = async (url, options) => {
    if (url.endsWith('/queue') && polls++ === 0) return { ok: true, json: async () => ({ queue_running: [queueItem('other-job', 'another-client')], queue_pending: [queueItem('own/job', queued.client())] }) };
    return queuedFetch(url, options);
  };
  await queued.context.cancelImageGeneration(0);
  assert.equal(polls, 2, 'Queued jobs wait to start so the Tavern proxy can still retrieve their final history');
  assert(queued.jobs.get(queued.message).cancelled);
  queued.reject(new Error('interrupted')); await queuedGeneration;

  for (const failure of ['unsupported', 'network']) {
    const failed = harness();
    const pending = failed.context.generateFromSummary(0, failed.message, 'scene', '1:1');
    await flush();
    const fetchQueue = failed.context.fetch;
    failed.context.fetch = async (url, options) => {
      if (!url.endsWith('/cancel')) return fetchQueue(url, options);
      if (failure === 'network') throw new Error('Cannot reach ComfyUI');
      return { ok: false, status: 404 };
    };
    await failed.context.cancelImageGeneration(0);
    assert.equal(failed.jobs.get(failed.message).cancelling, false, 'A failed interruption re-enables retry');
    assert.equal(failed.notices.at(-1).kind, 'error');
    failed.release('still-generated'); await pending;
    assert.equal(failed.message.extra.sceneDrawState.step, 'completed', 'Control failures must not abort a working image request');
  }

  const switched = harness();
  const originalGeneration = switched.context.generateFromSummary(0, switched.message, 'scene', '1:1');
  await flush();
  switched.context.chat[0] = { extra: {} };
  await switched.context.cancelImageGeneration(0);
  assert.equal(switched.requests.length, 0, 'Same message ID in another chat must not interrupt the original chat');
  switched.release('image'); await originalGeneration;
  assert.equal(switched.jobs.has(switched.message), false);

  // The delegated handler must also work when character-card scripts replace the button/SVG.
  let listener, cancelCalls = 0, generateCalls = 0;
  class Element { closest(selector) { return selector === '.scene-draw-sidebar-stop' ? this.button : null; } }
  const handler = vm.createContext({
    Element, generationClickHandlerBound: false,
    document: { addEventListener: (type, callback) => { listener = callback; } },
    debug: () => {}, cancelImageGeneration: id => { assert.equal(id, '42'); cancelCalls++; },
    runForMessage: () => { generateCalls++; },
  });
  vm.runInContext(handlerCode, handler); handler.bindGenerationClickHandler();
  const target = new Element(); target.button = { dataset: { sceneDrawMesid: '42' }, disabled: false };
  const event = { target, preventDefault: () => {}, stopPropagation: () => {} };
  listener(event); target.button.disabled = true; listener(event);
  assert.equal(cancelCalls, 1); assert.equal(generateCalls, 0);
  const proxyCode = source.slice(source.indexOf('async function generateProxy('), source.indexOf('async function generateImage('));
  assert(!proxyCode.includes('signal:'), 'Never abort the Tavern image request: its close handler can globally interrupt an unrelated job');
  console.log('Cancellation: own-job targeting, queued tasks, acknowledgement races, proxy safety, failures, chat switches, retry, existing images and delegated stop clicks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
