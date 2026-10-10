const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const progressCode = source.slice(source.indexOf('function comfyProgressUrl('), source.indexOf('const workflowSteps ='));
const stateCode = source.slice(source.indexOf('function setWorkflowState('), source.indexOf('function recoverStaleGenerationLocks('));
const conf = { comfyUrl: 'http://127.0.0.1:8188', useComfyProxy: true };
const workflow = { '14': { class_type: 'KSampler' }, '12': { class_type: 'VAEDecode' } };
const events = [], sockets = [], timers = new Map(), requests = [];
let nextTimer = 0, failConstructor = false, failRequest = false, pendingProxy;
class Socket {
  constructor(url) {
    if (failConstructor) throw new Error('Blocked');
    this.url = url;
    this.closed = false;
    sockets.push(this);
  }
  emit(type, data) { this.onmessage?.({ data: JSON.stringify({ type, data }) }); }
  close() { this.closed = true; }
}
const onProgress = (step, detail, progress) => events.push({ step, progress });
const context = vm.createContext({
  URL, WebSocket: Socket, window: { location: { hostname: '192.168.0.7' } },
  settings: () => conf, debug: () => {}, clientId: 'test-page',
  workflowWithPrompt: () => workflow, headers: () => ({}),
  setTimeout: (callback, delay) => {
    if (delay === 1000) { queueMicrotask(callback); return 0; }
    timers.set(++nextTimer, callback); return nextTimer;
  },
  clearTimeout: id => timers.delete(id),
  outputImage: () => ({ filename: 'image.png' }), blobToDataUrl: async () => 'direct-image',
  URLSearchParams, renderWorkflowState: () => {},
  fetch: async (url, options) => {
    if (options?.body) requests.push({ url, body: JSON.parse(options.body) });
    if (failRequest) throw new Error('Request failed');
    const socket = sockets.at(-1);
    if (url === '/api/sd/comfy/generate') {
      socket.onopen();
      socket.emit('execution_start', { prompt_id: 'proxy-job' });
      socket.emit('progress', { prompt_id: 'proxy-job', node: '14', value: 3, max: 9 });
      return new Promise(resolve => { pendingProxy = () => resolve({ ok: true, status: 200, text: async () => JSON.stringify({ data: 'base64', format: 'png' }) }); });
    }
    if (url.endsWith('/prompt')) {
      socket.onopen();
      socket.emit('execution_start', { prompt_id: 'direct-job' });
      return { ok: true, json: async () => ({ prompt_id: 'direct-job' }) };
    }
    if (url.includes('/history/')) {
      socket.emit('progress', { prompt_id: 'direct-job', node: '14', value: 4, max: 9 });
      return { json: async () => ({ 'direct-job': { outputs: {} } }) };
    }
    if (url.includes('/view?')) return { ok: true, blob: async () => ({}) };
    throw new Error('Unexpected URL ' + url);
  },
});
vm.runInContext(progressCode + stateCode, context);
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(context.comfyProgressUrl('job 1'), 'ws://192.168.0.7:8188/ws?clientId=job+1', 'Proxy loopback must resolve on the Tavern host for mobile');
conf.useComfyProxy = false;
assert.equal(new URL(context.comfyProgressUrl('job')).hostname, '127.0.0.1');
conf.comfyUrl = 'https://comfy.example/base/?old=1#fragment';
assert.equal(context.comfyProgressUrl('job'), 'wss://comfy.example/base/ws?clientId=job');
conf.comfyUrl = 'http://[::1]:8188'; conf.useComfyProxy = true;
assert.equal(new URL(context.comfyProgressUrl('job')).hostname, '192.168.0.7');
context.window.location.hostname = 'localhost';
assert.equal(new URL(context.comfyProgressUrl('job')).hostname, '[::1]');
context.window.location.hostname = '192.168.0.7'; conf.comfyUrl = 'http://127.0.0.1:8188';

const stop = context.watchComfyProgress(workflow, 'isolated-job', onProgress);
const socket = sockets.at(-1);
socket.onopen();
assert.equal(timers.size, 0, 'Handshake timeout is cleared on connection');
socket.emit('execution_start', { prompt_id: 'job' });
socket.emit('progress', { prompt_id: 'another-job', node: '14', value: 8, max: 9 });
socket.emit('progress', { prompt_id: 'job', node: '12', value: 2, max: 10 });
socket.onmessage({ data: new Uint8Array([1, 2]) });
socket.onmessage({ data: '{bad json' });
socket.onmessage({ data: 'null' });
socket.emit('progress', { prompt_id: 'job', node: '14', value: 3, max: 0 });
socket.emit('progress', { prompt_id: 'job', node: '14', value: 10, max: 9 });
socket.emit('progress', { prompt_id: 'job', node: '14', value: '3', max: 9 });
assert.equal(events.length, 0, 'Ignore other tasks, non-sampling nodes, previews, malformed and invalid messages');
socket.emit('progress', { prompt_id: 'job', node: '14', value: 0, max: 9 });
socket.emit('progress', { prompt_id: 'job', node: '14', value: 3, max: 9 });
socket.emit('progress', { prompt_id: 'job', node: '14', value: 3, max: 9 });
assert.equal(events.length, 2, 'Deduplicate the same step');
assert.deepEqual(plain(events.at(-1).progress), { value: 3, max: 9 });
socket.emit('executing', { prompt_id: 'job', node: '12' });
assert.equal(events.at(-1).progress, undefined, 'VAE/save stages clear the sampling counter');
socket.emit('executing', { prompt_id: 'job', node: '14' });
socket.emit('progress', { value: 4, max: 9 });
assert.deepEqual(plain(events.at(-1).progress), { value: 4, max: 9 }, 'Support older progress messages using the current node');
socket.emit('execution_success', { prompt_id: 'another-job' });
assert.equal(socket.closed, false);
socket.emit('execution_success', { prompt_id: 'job' });
assert.equal(socket.closed, true);
assert.equal(events.at(-1).progress, undefined);
assert.equal(socket.onmessage, null);
stop();
assert.equal(timers.size, 0);

for (const terminal of ['execution_error', 'execution_interrupted']) {
  context.watchComfyProgress(workflow, terminal, onProgress);
  sockets.at(-1).emit(terminal, { prompt_id: terminal });
  assert.equal(sockets.at(-1).closed, true);
}
context.watchComfyProgress(workflow, 'disconnected', onProgress);
const disconnected = sockets.at(-1);
disconnected.emit('progress', { prompt_id: 'disconnected', node: '14', value: 5, max: 9 });
disconnected.onerror();
assert.equal(disconnected.closed, true);
assert.equal(events.at(-1).progress, undefined, 'Do not freeze stale step numbers after a network error');
context.watchComfyProgress(workflow, 'timeout', onProgress);
[...timers.values()].forEach(callback => callback());
assert.equal(sockets.at(-1).closed, true);
assert.equal(timers.size, 0);
failConstructor = true;
assert.doesNotThrow(() => context.watchComfyProgress(workflow, 'blocked', onProgress)());
failConstructor = false;

const message = { extra: {} };
context.setWorkflowState(0, message, 'generating', 'sampling', { value: 3, max: 9 });
assert.equal(message.extra.sceneDrawState.progress.value, 3);
context.setWorkflowState(0, message, 'generating', 'saving');
assert.equal(message.extra.sceneDrawState.progress, undefined);

(async () => {
  events.length = 0;
  const proxyGeneration = context.generateImage('scene', onProgress);
  const proxySocket = sockets.at(-1);
  assert.deepEqual(plain(events.at(-1).progress), { value: 3, max: 9 }, 'Proxy receives real steps while its HTTP request is pending');
  const proxyRequest = requests.at(-1);
  const proxyId = JSON.parse(proxyRequest.body.prompt).client_id;
  assert.equal(new URL(proxySocket.url).searchParams.get('clientId'), proxyId);
  assert.equal(proxyRequest.body.url, conf.comfyUrl, 'Phone URL mapping must not change the server-side ComfyUI address');
  pendingProxy();
  assert.equal(await proxyGeneration, 'data:image/png;base64,base64');
  assert.equal(proxySocket.closed, true);
  assert.equal(events.at(-1).progress, undefined);
  conf.useComfyProxy = false;
  assert.equal(await context.generateImage('scene', onProgress), 'direct-image');
  const directRequest = requests.findLast(request => request.url.endsWith('/prompt'));
  const directSocket = sockets.at(-1);
  assert.equal(new URL(directSocket.url).searchParams.get('clientId'), directRequest.body.client_id);
  assert.notEqual(directRequest.body.client_id, proxyId, 'Each generation has an isolated socket/client ID');
  assert(events.some(event => event.progress?.value === 4));
  assert.equal(directSocket.closed, true);
  const originalDirect = context.generateDirect;
  context.generateDirect = async () => 'fallback-image';
  failConstructor = true;
  assert.equal(await context.generateImage('scene', onProgress), 'fallback-image', 'Unavailable WebSocket cannot prevent image generation');
  failConstructor = false;
  context.generateDirect = originalDirect;
  failRequest = true;
  await assert.rejects(context.generateImage('scene', onProgress), /Request failed/);
  assert.equal(sockets.at(-1).closed, true, 'Failed image requests must clean up progress sockets');
  assert.equal(timers.size, 0);
  console.log('ComfyUI progress: events, task isolation, mobile/proxy URLs, direct/proxy transport, cleanup and fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
