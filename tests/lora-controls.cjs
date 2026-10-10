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
const names = ['LiRuinan_v2', 'YangMaguo_v1_7500', 'MouYunxuan_v1', 'LanXidan_v1', 'YinShiyou_v1_9500', 'ZhouXinyi_v1'];
const original = JSON.parse(conf.workflow);
const entries = original['3'].inputs.loras.__value__;
assert.deepEqual(entries.slice(0, 6).map(entry => entry.name), names);
assert.equal(entries.find(entry => entry.name === 'SNOFS_krea_v1_5').strength, .8);
assert(original['3'].inputs.text.includes('<lora:SNOFS_krea_v1_5:0.80>'));
assert.equal(entries.find(entry => entry.name.startsWith('breast_size')).strength, '-1.00');
assert.equal(entries.find(entry => entry.name.startsWith('penis_size')).strength, '-1.00');
assert.equal(context.loraControlState().character, names[0]);
assert.equal(context.loraControlState().zoom, 0);
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
assert.equal(context.loraControlState().characters.length, 1);
assert.equal(context.loraControlState().zoomSupported, false);
assert.throws(() => context.workflowWithPrompt('scene', null, { character: names[0], zoom: -1 }), /zoom LoRA/);
assert.doesNotThrow(() => context.workflowWithPrompt('scene', null, { character: names[0], zoom: null }));
conf.workflow = '{}';
assert.equal(context.loraControlState().characters.length, 0);
assert.equal(context.loraControlState().zoomSupported, false);
console.log('LoRA controls: all 6 characters x 25 zoom values, synchronized text/entries, preserved other LoRAs, defaults and memory passed.');
