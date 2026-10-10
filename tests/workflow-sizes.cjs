const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const variables = source.slice(source.indexOf('const imageAspectRatios ='), source.indexOf('async function summarizeTurn('));
const workflowCode = source.slice(source.indexOf('function workflowWithPrompt('), source.indexOf('function outputImage('));
const imageCode = source.slice(source.indexOf('async function generateImage('), source.indexOf('const workflowSteps ='));
const generationCode = source.slice(source.indexOf('async function generateFromSummary('), source.indexOf('async function runForMessage('));
const defaultWorkflow = vm.runInNewContext(source.slice(source.indexOf('const defaultWorkflow ='), source.indexOf('const defaults =')) + '; defaultWorkflow');
const template = {
  '3': defaultWorkflow['3'],
  '5': { inputs: { text: '{{prompt}}' } },
  '9': { class_type: 'Seed (rgthree)', inputs: { seed: '{{seed}}' } },
  '13': { inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  '20': { inputs: { width: 1024, height: 1024 } },
  '21': { inputs: { width: ['22', 0], height: ['22', 1] } },
};
const conf = { enabled: true, comfyUrl: 'test', workflow: JSON.stringify(template), positiveNodeId: '5', positiveInputName: 'text', width: 512, height: 768, seed: -1 };
const message = { extra: {} };
const requests = [];
const context = vm.createContext({
  settings: () => conf,
  clientId: 'test-client', watchComfyProgress: () => () => {},
  URL, comfyProgressUrl: id => 'ws://test:8188/ws?clientId=' + id,
  chat: [message], runningGenerations: new Set(), imageGenerations: new WeakMap(),
  debug: () => {}, notify: () => {}, console,
  saveChatConditional: async () => {},
  generateProxy: async workflow => { requests.push({ route: 'proxy', workflow }); return 'image'; },
  generateDirect: async workflow => { requests.push({ route: 'direct', workflow }); return 'image'; },
  persistImage: async () => '/saved/image.png', renderImage: () => {}, renderSidebar: () => {},
  setWorkflowState: (id, msg, step, detail) => { msg.extra.sceneDrawState = { step, detail }; },
});
vm.runInContext(variables + workflowCode + imageCode + generationCode, context);
(async () => {
  const sizes = { '9:16': [900, 1600], '3:4': [1050, 1400], '16:9': [1600, 900], '4:3': [1400, 1050], '1:1': [1200, 1200] };
  for (const useProxy of [true, false]) {
    conf.useComfyProxy = useProxy;
    for (const [ratio, [width, height]] of Object.entries(sizes)) {
      const controls = { character: 'MouYunxuan_v1', zoom: -6.5 };
      await context.generateFromSummary(0, message, 'edited scene', ratio, controls);
      const request = requests.at(-1);
      assert.equal(request.route, useProxy ? 'proxy' : 'direct');
      for (const nodeId of ['13', '20']) {
        assert.equal(request.workflow[nodeId].inputs.width, width);
        assert.equal(request.workflow[nodeId].inputs.height, height);
      }
      assert.equal(request.workflow['5'].inputs.text, 'edited scene');
      assert(Number.isSafeInteger(request.workflow['9'].inputs.seed) && request.workflow['9'].inputs.seed >= 0, 'Both proxy and direct transports receive a resolved random seed');
      const loras = request.workflow['3'].inputs.loras.__value__;
      assert.equal(loras.find(entry => entry.name === controls.character).active, true);
      assert.equal(loras.find(entry => entry.name === 'LiRuinan_v2').active, false);
      assert.equal(loras.find(entry => entry.name === 'zoom_krea2_loraholic').strength, controls.zoom);
      assert.equal(message.extra.sceneDrawLoraControls.character, controls.character);
      assert.equal(message.extra.sceneDrawLoraControls.zoom, controls.zoom);
      assert.deepEqual(JSON.parse(JSON.stringify(request.workflow['21'].inputs)), template['21'].inputs, 'Linked dimensions stay intact');
      assert.equal(message.extra.sceneDrawAspectRatio, ratio);
      assert.equal(message.extra.sceneDrawState.step, 'completed');
      assert.equal(context.runningGenerations.size, 0);
    }
  }
  assert.equal(conf.width, 512, 'Global settings are not modified');
  assert.equal(conf.height, 768);
  assert.equal(conf.seed, -1, 'Random mode remains enabled after generation');
  assert.equal(conf.workflow, JSON.stringify(template), 'Workflow template is not modified');
  const count = requests.length;
  await context.generateFromSummary(0, message, 'scene');
  await context.generateFromSummary(0, message, 'scene', 'invalid');
  assert.equal(requests.length, count, 'Missing/invalid selection cannot generate');
  assert.equal(context.imageSizeForRatio('toString'), null);
  console.log('Workflow sizes: all five presets through proxy/direct, literal/placeholder sizes, linked inputs and required selection passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
