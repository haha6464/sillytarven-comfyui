const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const defaults = vm.runInNewContext(source.slice(source.indexOf('const defaultWorkflow ='), source.indexOf('function settings(')) + '; defaults');
const settingsCode = source.slice(source.indexOf('function settings('), source.indexOf('function save('));
const variablesCode = source.slice(source.indexOf('const imageAspectRatios ='), source.indexOf('async function summarizeTurn('));
const workflowCode = source.slice(source.indexOf('function workflowWithPrompt('), source.indexOf('function outputImage('));
const extensionSettings = {};
const randomValues = [0, .25, 1 - Number.EPSILON];
let randomCalls = 0;
const context = vm.createContext({
  defaults, extension_settings: extensionSettings, extensionName: 'st-chatu8',
  Math: Object.assign(Object.create(Math), { random: () => randomValues[randomCalls++ % randomValues.length] }),
});
vm.runInContext(settingsCode + variablesCode + workflowCode, context);
const conf = context.settings();
assert.equal(conf.seed, -1, 'New settings default to random');
for (const seed of [0, 123456, 31982231011750]) {
  conf.seed = seed;
  assert.equal(context.settings().seed, seed, 'Existing fixed seed settings are preserved on update');
  assert.equal(context.workflowWithPrompt('scene')['9'].inputs.seed, seed);
}
assert.equal(randomCalls, 0, 'Fixed seeds do not draw random numbers');
conf.seed = -1;
const originalTemplate = conf.workflow;
const seeds = new Set();
for (let i = 0; i < randomValues.length; i++) {
  const workflow = context.workflowWithPrompt('scene');
  const seed = workflow['9'].inputs.seed;
  assert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 2 ** 50, 'API gets a valid nonnegative rgthree seed');
  assert.deepEqual(JSON.parse(JSON.stringify(workflow['14'].inputs.seed)), ['9', 0], 'Linked sampler seed stays intact');
  seeds.add(seed);
}
assert.equal(seeds.size, 3, 'Each new workflow draws a fresh seed');
assert.equal(conf.seed, -1, 'Random mode remains enabled in saved settings');
assert.equal(conf.workflow, originalTemplate, 'The saved workflow template is not mutated');

conf.workflow = JSON.stringify({
  '5': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  '14': { class_type: 'KSampler', inputs: { seed: '{{seed}}' } },
  '20': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: '{{seed}}' } },
  '21': { class_type: 'SaveImage', inputs: { filename_prefix: 'seed-{{seed}}' } },
});
conf.seed = '-1';
const callsBefore = randomCalls;
const nativeWorkflow = context.workflowWithPrompt('scene');
assert.equal(randomCalls, callsBefore + 1, 'One draw per submission, not per placeholder');
const nativeSeed = nativeWorkflow['14'].inputs.seed;
assert(Number.isSafeInteger(nativeSeed) && nativeSeed >= 0, 'Native KSampler never receives -1');
assert.equal(nativeWorkflow['20'].inputs.noise_seed, nativeSeed);
assert.equal(nativeWorkflow['21'].inputs.filename_prefix, 'seed-' + nativeSeed);
conf.seed = 0;
assert.equal(context.workflowWithPrompt('scene')['14'].inputs.seed, 0, 'Zero is still a fixed seed');
console.log('Random seed: new defaults, saved fixed seeds, per-submission randomization, safe range, rgthree/native workflows and shared placeholders passed.');
