const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const defaultWorkflow = vm.runInNewContext(source.slice(source.indexOf('const defaultWorkflow ='), source.indexOf('const defaults =')) + '; defaultWorkflow');
const helpers = source.slice(source.indexOf('const imageAspectRatios ='), source.indexOf('async function summarizeTurn('));
const workflowCode = source.slice(source.indexOf('function workflowWithPrompt('), source.indexOf('function outputImage('));
const conf = { workflow: JSON.stringify(defaultWorkflow), positiveNodeId: '5', positiveInputName: 'text', lastCharacterLora: '', lastZoomLora: null };
const context = vm.createContext({ settings: () => conf });
vm.runInContext(helpers + workflowCode, context);
const names = ['LiRuinan_v2', 'YangMaguo_v1_7500', 'MouYunxuan_v1', 'LanXidan_v1', 'YinShiyou_v1_9500', 'ZhouXinyi_v1', 'ZengSiqi_v1', 'ZhangYihuai_v1'];
const original = JSON.parse(conf.workflow);
const normalWorkflow = conf.workflow;
conf.workflow = conf.workflow.replace('<lora:ZhouXinyi_v1:1.00>, ', '<lora:ZhouXinyi_v1:1.00>, \n');
assert.throws(() => JSON.parse(conf.workflow));
assert.equal(context.loraControlState().characters.length, 8, 'Literal newlines in LoRA text do not disable sliders');
const repairedWorkflow = context.workflowWithPrompt('scene', null, { character: 'ZengSiqi_v1' });
assert(repairedWorkflow['3'].inputs.text.includes('ZengSiqi_v1'));
assert(conf.workflow.includes('\n<lora:breast_size'), 'The saved workflow remains untouched');
assert.throws(() => context.parseWorkflow('{"text":"x\ny",broken}'), error => error.name === 'SyntaxError', 'Other JSON errors are not hidden');
conf.workflow = normalWorkflow;
const entries = original['3'].inputs.loras.__value__;
assert.deepEqual(entries.slice(0, 8).map(entry => entry.name), names);
assert.equal(entries.find(entry => entry.name === 'SNOFS_krea_v1_5').strength, .8);
assert(original['3'].inputs.text.includes('<lora:SNOFS_krea_v1_5:0.80>'));
assert.equal(entries.find(entry => entry.name.startsWith('breast_size')).strength, '-1.00');
assert.equal(entries.find(entry => entry.name.startsWith('penis_size')).strength, '-1.00');
assert.equal(context.loraControlState().character, names[0]);
assert.equal(context.loraControlState().zoom, 0);
assert.equal(context.loraControlState().penisSize, -1, 'Use workflow strength until the user chooses a value');
for (const character of names) {
  for (let zoom = -12; zoom <= 0; zoom += .5) {
    const workflow = context.workflowWithPrompt('edited scene', { width: 1400, height: 1050 }, { character, zoom });
    const result = workflow['3'].inputs.loras.__value__;
    assert.deepEqual(Array.from(result.filter(entry => names.includes(entry.name) && entry.active), entry => entry.name), [character]);
    const zoomEntry = result.find(entry => entry.name === 'zoom_krea2_loraholic');
    assert.equal(zoomEntry.strength, zoom);
    assert.equal(zoomEntry.clipStrength, zoom);
    assert.equal(zoomEntry.active, true);
    assert.equal(workflow['5'].inputs.text, 'edited scene');
    assert.equal(workflow['13'].inputs.width, 1400);
    const text = workflow['3'].inputs.text;
    assert(text.includes('<lora:' + character + ':'));
    for (const name of names.filter(name => name !== character)) assert(!text.includes('<lora:' + name + ':'));
    assert(text.includes('<lora:zoom_krea2_loraholic:' + zoom.toFixed(2) + '>'));
    for (const other of entries.filter(entry => !names.includes(entry.name) && entry.name !== 'zoom_krea2_loraholic')) {
      assert.equal(JSON.stringify(result.find(entry => entry.name === other.name)), JSON.stringify(other), 'Other LoRAs remain unchanged');
    }
  }
}
assert.equal(conf.workflow, JSON.stringify(original), 'Saved workflow stays unchanged');
const sizeName = 'penis_size_krea2_v2_loraholic';
for (const character of names) {
  for (let penisSize = -8; penisSize <= 5; penisSize += .5) {
    const workflow = context.workflowWithPrompt('scene', null, { character, penisSize, zoom: -2.5 });
    const result = workflow['3'].inputs.loras.__value__;
    const entry = result.find(item => item.name === sizeName);
    assert.equal(entry.strength, penisSize);
    assert.equal(entry.clipStrength, penisSize);
    assert.equal(entry.active, true);
    assert(workflow['3'].inputs.text.includes('<lora:' + sizeName + ':' + penisSize.toFixed(2) + ':' + penisSize.toFixed(2) + '>'));
    assert.equal(workflow['3'].inputs.text.match(/<lora:penis_size_krea2_v2_loraholic:/g).length, 1);
    assert.equal(result.find(item => item.name === 'zoom_krea2_loraholic').strength, -2.5);
    for (const other of entries.filter(item => !names.includes(item.name) && ![sizeName, 'zoom_krea2_loraholic'].includes(item.name))) {
      assert.equal(JSON.stringify(result.find(item => item.name === other.name)), JSON.stringify(other));
    }
  }
}
assert.equal(conf.workflow, JSON.stringify(original), 'Slider changes only affect the submitted workflow');
conf.lastPenisSizeLora = 0;
assert.equal(context.loraControlState().penisSize, 0, 'Remember zero without replacing it with the default');
conf.lastPenisSizeLora = 3.5;
assert.equal(context.loraControlState().penisSize, 3.5);
conf.lastPenisSizeLora = 'invalid';
assert.equal(context.loraControlState().penisSize, -1);
assert.equal(context.penisSizeLoraValue(-99), -8);
assert.equal(context.penisSizeLoraValue(99), 5);
assert.equal(context.penisSizeLoraValue(2.3), 2.5);
for (const value of [null, undefined, '', NaN, Infinity, 'invalid']) assert.equal(context.penisSizeLoraValue(value), null);
assert.throws(() => context.workflowWithPrompt('scene', null, { penisSize: 'invalid' }), /penis_size LoRA/);
const pathWorkflow = JSON.parse(conf.workflow);
pathWorkflow['3'].inputs.loras.__value__.find(item => item.name === sizeName).name = 'folder\\' + sizeName + '.safetensors';
conf.workflow = JSON.stringify(pathWorkflow);
const sizeOnly = context.workflowWithPrompt('scene', null, { penisSize: 1.5 });
assert.equal(sizeOnly['3'].inputs.loras.__value__.find(item => item.name.includes(sizeName)).strength, 1.5);
conf.workflow = JSON.stringify(original);
conf.lastCharacterLora = names[5]; conf.lastZoomLora = -8.5;
assert.equal(context.loraControlState().character, names[5]);
assert.equal(context.loraControlState().zoom, -8.5);
conf.lastCharacterLora = 'missing'; conf.lastZoomLora = 'invalid';
assert.equal(context.loraControlState().character, names[0]);
assert.equal(context.loraControlState().zoom, 0);
assert.equal(context.zoomLoraValue(-7.3), -7.5);
assert.equal(context.zoomLoraValue(-99), -12);
assert.equal(context.zoomLoraValue(99), 0);
assert.equal(context.zoomLoraValue(null), null);
assert.equal(context.loraName('folder\\LiRuinan_v2.safetensors'), names[0]);
assert.throws(() => context.workflowWithPrompt('scene', null, { character: 'missing', zoom: 0 }), /角色 LoRA/);
const partial = JSON.parse(conf.workflow);
partial['3'].inputs.loras.__value__ = [entries[0]];
conf.workflow = JSON.stringify(partial);
assert.equal(context.loraControlState().characters.length, 3);
assert.equal(context.loraControlState().characters[1].name, 'ZengSiqi_v1');
const upgraded = context.workflowWithPrompt('scene', null, { character: 'ZengSiqi_v1' });
assert.equal(upgraded['3'].inputs.loras.__value__.find(entry => entry.name === 'ZengSiqi_v1').active, true);
assert(!JSON.parse(conf.workflow)['3'].inputs.loras.__value__.some(entry => entry.name === 'ZengSiqi_v1'), 'Saved workflow is not overwritten');
assert.equal(context.loraControlState().characters[2].name, 'ZhangYihuai_v1');
const upgradedZhang = context.workflowWithPrompt('scene', null, { character: 'ZhangYihuai_v1' });
assert.equal(upgradedZhang['3'].inputs.loras.__value__.find(entry => entry.name === 'ZhangYihuai_v1').active, true);
assert(upgradedZhang['3'].inputs.text.includes('<lora:ZhangYihuai_v1:1:1>'));
assert(!JSON.parse(conf.workflow)['3'].inputs.loras.__value__.some(entry => entry.name === 'ZhangYihuai_v1'));
assert.equal(context.loraControlState().zoomSupported, false);
assert.equal(context.loraControlState().penisSizeSupported, false);
assert.throws(() => context.workflowWithPrompt('scene', null, { penisSize: 1 }), /penis_size LoRA/);
assert.doesNotThrow(() => context.workflowWithPrompt('scene', null, { penisSize: null }));
assert.throws(() => context.workflowWithPrompt('scene', null, { character: names[0], zoom: -1 }), /zoom LoRA/);
assert.doesNotThrow(() => context.workflowWithPrompt('scene', null, { character: names[0], zoom: null }));
conf.workflow = '{}';
assert.equal(context.loraControlState().characters.length, 0);
assert.equal(context.loraControlState().zoomSupported, false);
console.log('LoRA controls: 8 characters, saved-workflow compatibility, zoom, size, validation and memory passed.');
