const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const modalSource = source.slice(source.indexOf('function showSummaryModal('), source.indexOf('function showImageViewer('));
const ratioSource = source.slice(source.indexOf('const imageAspectRatios ='), source.indexOf('function workflowVariables('));
const defaultWorkflow = vm.runInNewContext(source.slice(source.indexOf('const defaultWorkflow ='), source.indexOf('const defaults =')) + '; defaultWorkflow');
if (process.argv[2] === '--preview') {
  console.log(`(() => {
    if (document.querySelector('#scene-draw-summary-preview-style')) throw new Error('Preview already open');
    window.__sceneDrawSummaryOriginal = document.querySelector('.scene-draw-summary-modal');
    window.__sceneDrawSummaryOriginal?.remove();
    const style = document.createElement('style');
    style.id = 'scene-draw-summary-preview-style'; style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
    const chat = [{ extra: { sceneDrawPrompt: '场景预览' } }];
    const generateFromSummary = () => {};
    const saveChatConditional = async () => {};
    const getContext = () => ({chatId:'preview',groupId:null,characters:[{avatar:'preview.png'}],characterId:0});
    const headers = () => ({});
    const fetch = async () => ({ok:true,json:async()=>[{},...chat]});
    const notify = () => {};
    const previewSettings = { workflow: ${JSON.stringify(JSON.stringify(defaultWorkflow))} };
    const settings = () => previewSettings;
    const save = () => {};
    ${ratioSource}
    ${modalSource}
    showSummaryModal(0);
    const modal = document.querySelector('.scene-draw-summary-modal');
    const radios = [...modal.querySelectorAll('input[type="radio"]')];
    const button = modal.querySelector('button');
    const panel = modal.querySelector('section').getBoundingClientRect();
    const ratios = modal.querySelector('.scene-draw-aspect-ratios').getBoundingClientRect();
    const submit = button.getBoundingClientRect();
    const sliders = [...modal.querySelectorAll('input[type="range"]')];
    const sliderBounds = sliders.map(slider => slider.getBoundingClientRect());
    const disabledBefore = button.disabled;
    radios[0].checked = true; radios[0].dispatchEvent(new Event('change'));
    const disabledAfter = button.disabled;
    radios[0].checked = false; button.disabled = true;
    return { viewport: [innerWidth, innerHeight], radioValues: radios.map(radio => radio.value), disabledBefore, disabledAfter, buttons: modal.querySelectorAll('button').length, submitText: button.textContent, fitsPanel: ratios.left >= panel.left && submit.right <= panel.right && sliderBounds.every(rect => rect.right <= panel.right && rect.width > 50), slidersRightOfSubmit: sliderBounds.every(rect => rect.left > submit.right), sliders: sliders.map(slider => ({ min: slider.min, max: slider.max, step: slider.step, value: slider.value, disabled: slider.disabled })) };
  })()`);
  process.exit(0);
}
if (process.argv[2] === '--restore') {
  console.log(`(() => { document.querySelector('.scene-draw-summary-modal')?.remove(); document.querySelector('#scene-draw-summary-preview-style')?.remove(); if (window.__sceneDrawSummaryOriginal) document.body.append(window.__sceneDrawSummaryOriginal); delete window.__sceneDrawSummaryOriginal; return 'Preview restored'; })()`);
  process.exit(0);
}
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  addEventListener(event, handler) { this.events[event] = handler; }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
}
const body = new Element('body');
const message = { extra: { sceneDrawPrompt: 'original scene' } };
const generated = [];
const notices = [];
let savedSettings = { lastAspectRatio: '', workflow: JSON.stringify(defaultWorkflow), lastCharacterLora: '', lastZoomLora: null };
let saveCount = 0;
const context = vm.createContext({
  chat: [message],
  settings: () => savedSettings,
  save: () => { saveCount += 1; },
  document: { body, querySelector: () => null, createElement: tag => new Element(tag) },
  notify: (...args) => notices.push(args),
  generateFromSummary: (...args) => generated.push(args),
  saveChatConditional: async () => {},
  getContext: () => ({chatId:'fixture-chat',groupId:null,characters:[{avatar:'fixture.png'}],characterId:0}),
  headers: () => ({}),
});
context.fetch = async () => ({ok:true,json:async()=>[{},...context.chat]});
vm.runInContext(ratioSource + modalSource, context);
const openModal = (mesId = 0) => {
  context.showSummaryModal(mesId);
  const modal = body.children.at(-1);
  const [title, content, actions] = modal.children[0].children;
  const [ratios, submitControls] = actions.children;
  const [buttons, sliderGroup] = submitControls.children;
  const [submit, saveButton] = buttons.children;
  const sliders = sliderGroup.children.map(field => field.children[1]);
  const radios = ratios.children.flatMap(row => row.children.slice(1).map(option => option.children[0]));
  const select = ratio => {
    radios.forEach(radio => { radio.checked = false; });
    const radio = radios.find(item => item.value === ratio);
    radio.checked = true;
    radio.events.change();
  };
  return { modal, title, content, actions, ratios, radios, select, submitControls, sliderGroup, sliders, submit, saveButton, buttons };
};
(async () => {
let ui = openModal();
assert.equal(ui.submit.textContent, '提交');
assert.equal(ui.actions.children.length, 2);
assert.deepEqual(ui.buttons.children.map(button => button.textContent), ['提交', '保存']);
assert.equal(ui.submit.type, 'button');
assert.equal(ui.content.value, 'original scene');
assert.equal(ui.sliders.length, 3);
assert.deepEqual(ui.sliders.map(slider => [slider.min, slider.max, slider.step]), [['0', '7', '1'], ['-8', '5', '0.5'], ['0', '12', '0.5']]);
assert(ui.sliders.every(slider => !slider.disabled));
assert.deepEqual(ui.sliderGroup.children.map(field => field.children[0].textContent), ['李蕊男', 'penis_size -1.0', 'zoom 0.0']);
assert(ui.submit.disabled, 'Selection is mandatory with no default');
assert.deepEqual(ui.radios.map(radio => radio.value), ['9:16', '3:4', '16:9', '4:3', '1:1']);
assert(ui.radios.every(radio => radio.required && !radio.checked));
assert.deepEqual(ui.ratios.children.map(row => row.children[0].textContent), ['竖版', '横版', '']);
await ui.submit.events.click();
assert.equal(generated.length, 0, 'Missing ratio cannot submit');
ui.modal.events.click({ target: ui.content });
assert(!ui.modal.removed, 'Inside clicks do not close');
ui.modal.events.click({ target: ui.modal });
assert(ui.modal.removed);
assert.equal(generated.length, 0, 'Closing does not submit');
ui = openModal();
ui.content.value = '  edited scene  ';
ui.select('3:4');
assert.equal(ui.submit.disabled, false);
assert.equal(savedSettings.lastAspectRatio, '3:4');
assert.equal(saveCount, 1, 'Selection is saved immediately');
await ui.submit.events.click();
assert(ui.modal.removed);
assert.equal(generated[0][2], 'edited scene', 'Submit continues with the edited summary');
assert.equal(generated[0][3], '3:4');
ui = openModal();
assert.equal(ui.radios.find(radio => radio.checked).value, '3:4', 'Reopening remembers selection');
assert.equal(ui.submit.disabled, false);
assert(ui.radios.find(radio => radio.checked).focused, 'Focus keeps the remembered ratio');
ui.content.value = '   ';
ui.select('1:1');
await ui.submit.events.click();
assert.equal(generated.length, 1, 'Empty prompt is not submitted');
assert(!ui.modal.removed);
assert(ui.content.focused);
assert.equal(notices.at(-1)[0], 'error');
ui.modal.events.click({ target: ui.modal });
assert(ui.modal.removed, 'Backdrop still closes the modal');
ui = openModal();
assert.equal(ui.radios.find(radio => radio.checked).value, '3:4', 'Closing without saving keeps the message configuration');
ui.modal.remove();
// Reloaded settings and another message/chat use the same last selected preference.
savedSettings = JSON.parse(JSON.stringify(savedSettings));
context.chat[1] = { extra: { sceneDrawPrompt: 'another chat scene', sceneDrawAspectRatio: '4:3' } };
ui = openModal(1);
assert.equal(ui.radios.find(radio => radio.checked).value, '1:1', 'Another chat defaults to the last selection');
assert.equal(ui.submit.disabled, false);
await ui.submit.events.click();
assert.equal(generated.at(-1)[0], 1);
assert.equal(generated.at(-1)[3], '1:1');
for (const ratio of ['9:16', '3:4', '16:9', '4:3', '1:1']) {
  ui = openModal();
  ui.select(ratio);
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[3], ratio);
}
ui = openModal();
ui.select('9:16');
context.chat[0] = {};
const beforeSwitch = generated.length;
await ui.submit.events.click();
assert.equal(generated.length, beforeSwitch, 'Switching chat blocks stale submissions');
context.chat[0] = message;
ui = openModal();
ui.sliders[0].value = '4';
ui.sliders[0].events.input();
ui.sliders[1].value = '2.5';
ui.sliders[1].events.input();
ui.sliders[2].value = '7.5';
ui.sliders[2].events.input();
assert.equal(savedSettings.lastCharacterLora, 'YinShiyou_v1_9500');
assert.equal(savedSettings.lastPenisSizeLora, 2.5);
assert.equal(savedSettings.lastZoomLora, -7.5);
assert.deepEqual(ui.sliderGroup.children.map(field => field.children[0].textContent), ['尹施又', 'penis_size 2.5', 'zoom -7.5']);
ui.modal.events.click({ target: ui.modal });
savedSettings = JSON.parse(JSON.stringify(savedSettings));
context.chat[2] = { extra: { sceneDrawPrompt: 'fresh unconfigured message' } };
ui = openModal(2);
assert.deepEqual(ui.sliders.map(slider => slider.value), ['4', '2.5', '7.5'], 'All sliders restore after reload and in another chat');
await ui.submit.events.click();
assert.equal(generated.at(-1)[4].character, 'YinShiyou_v1_9500');
assert.equal(generated.at(-1)[4].penisSize, 2.5);
assert.equal(generated.at(-1)[4].zoom, -7.5);
for (const position of [0, .5, 12]) {
  ui = openModal();
  ui.sliders[2].value = String(position);
  ui.sliders[2].events.input();
  const expectedZoom = position === 0 ? 0 : -position;
  assert.equal(savedSettings.lastZoomLora, expectedZoom, 'Left is 0, right is -12');
  assert.equal(ui.sliderGroup.children[2].children[0].textContent, 'zoom ' + expectedZoom.toFixed(1));
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[4].zoom, expectedZoom, 'Submit uses the real negative zoom value');
}
for (let value = -8; value <= 5; value += .5) {
  ui = openModal();
  ui.sliders[1].value = String(value);
  ui.sliders[1].events.input();
  assert.equal(savedSettings.lastPenisSizeLora, value);
  assert.equal(ui.sliderGroup.children[1].children[0].textContent, 'penis_size ' + value.toFixed(1));
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[4].penisSize, value);
}
savedSettings.workflow = '{}';
ui = openModal();
assert(ui.sliders.every(slider => slider.disabled), 'Missing workflow LoRAs disable their sliders');
await ui.submit.events.click();
assert.equal(generated.at(-1)[4].penisSize, null, 'Unsupported LoRA is not sent');
savedSettings.workflow = JSON.stringify(defaultWorkflow);
ui = openModal();
ui.sliders[0].value = '6';
ui.sliders[0].events.input();
assert.equal(ui.sliderGroup.children[0].children[0].textContent, '曾思齐');
assert.equal(savedSettings.lastCharacterLora, 'ZengSiqi_v1');
await ui.submit.events.click();
assert.equal(generated.at(-1)[4].character, 'ZengSiqi_v1');
context.chat[4] = { extra: { sceneDrawPrompt: 'new role memory test' } };
ui = openModal(4);
assert.equal(ui.sliders[0].value, '6');
ui.sliders[0].value = '7';
ui.sliders[0].events.input();
assert.equal(ui.sliderGroup.children[0].children[0].textContent, '张艺怀');
assert.equal(savedSettings.lastCharacterLora, 'ZhangYihuai_v1');
await ui.submit.events.click();
assert.equal(generated.at(-1)[4].character, 'ZhangYihuai_v1');
ui = openModal(4);
assert.equal(ui.sliders[0].value, '7');
savedSettings.lastAspectRatio = 'invalid';
context.chat[5] = { extra: { sceneDrawPrompt: 'invalid ratio test' } };
ui = openModal(5);
assert(ui.radios.every(radio => !radio.checked), 'Invalid remembered values are not preselected');
assert(ui.submit.disabled);
const buttons = css.match(/\.scene-draw-summary-buttons > button\s*\{([^}]+)\}/)[1];
assert(buttons.includes('white-space: nowrap'));
assert(buttons.includes('writing-mode: horizontal-tb'));
assert(buttons.includes('flex: 0 0 auto'));
assert(buttons.includes('width: auto'));
const actions = css.match(/\.scene-draw-summary-modal-actions\s*\{([^}]+)\}/)[1];
assert(actions.includes('flex-direction: row'));
assert(actions.includes('flex-wrap: wrap'));
assert(actions.includes('justify-content: flex-start'));
assert(actions.includes('align-items: center'));
  let chatSaves = 0;
  let failSave = false;
  context.saveChatConditional = async () => { chatSaves++; if (failSave) throw new Error('disk full'); };
  savedSettings.lastAspectRatio = '1:1';
  ui = openModal();
  ui.content.value = '  local prompt  ';
  ui.select('4:3');
  ui.sliders[0].value = '2'; ui.sliders[0].events.input();
  ui.sliders[1].value = '0'; ui.sliders[1].events.input();
  ui.sliders[2].value = '0'; ui.sliders[2].events.input();
  const beforeSave = generated.length;
  await ui.saveButton.events.click();
  assert.equal(chatSaves, 1);
  assert.equal(generated.length, beforeSave, 'Save never generates an image');
  assert(!ui.modal.removed, 'Save keeps the editor open');
  assert.equal(message.extra.sceneDrawConfig.prompt, 'local prompt');
  assert.equal(message.extra.sceneDrawConfig.aspectRatio, '4:3');
  // Another chat changes all global preferences, but this message retains its snapshot.
  savedSettings.lastAspectRatio = '9:16';
  savedSettings.lastCharacterLora = 'ZhangYihuai_v1';
  savedSettings.lastPenisSizeLora = 5; savedSettings.lastZoomLora = -12;
  context.chat[0] = JSON.parse(JSON.stringify(message));
  ui = openModal();
  assert.equal(ui.content.value, 'local prompt');
  assert.equal(ui.radios.find(r => r.checked).value, '4:3');
  assert.deepEqual(ui.sliders.map(s => s.value), ['2', '0', '0'], 'Zero strengths survive global changes and reload');
  ui.content.value = 'discard this edit';
  ui.select('16:9');
  ui.modal.events.click({ target: ui.modal });
  ui = openModal();
  assert.equal(ui.content.value, 'local prompt');
  assert.equal(ui.radios.find(r => r.checked).value, '4:3', 'Unsaved edits cannot replace message configuration');
  failSave = true;
  ui.content.value = 'failed edit';
  await ui.saveButton.events.click();
  assert.equal(context.chat[0].extra.sceneDrawConfig.prompt, 'local prompt', 'Save errors restore the previous configuration');
  assert.equal(ui.saveButton.disabled, false);
  context.chat[2] = { extra: { sceneDrawPrompt: 'new message' } };
  ui = openModal(2);
  assert.equal(ui.radios.find(r => r.checked).value, '16:9', 'Unconfigured new messages still use the global last choice');
  const savesBeforeSwitch = chatSaves;
  context.chat[2] = {};
  await ui.saveButton.events.click();
  assert.equal(chatSaves, savesBeforeSwitch, 'Stale editors cannot save to a different chat');
  context.chat[3] = { extra: { sceneDrawPrompt: 'legacy', sceneDrawImage: '/old.png', sceneDrawAspectRatio: '3:4' } };
  ui = openModal(3);
  assert.equal(ui.radios.find(r => r.checked).value, '16:9', 'Legacy messages are not migrated');
  context.chat[6] = { extra: { sceneDrawPrompt: 'before submit' } };
  savedSettings.lastAspectRatio = '1:1';
  let releaseSave, pendingSaves = 0;
  context.saveChatConditional = () => {
    pendingSaves++;
    assert.equal(context.chat[6].extra.sceneDrawConfig.prompt, 'saved before generating');
    return new Promise(resolve => { releaseSave = resolve; });
  };
  ui = openModal(6);
  ui.content.value = 'saved before generating';
  ui.select('3:4');
  const beforeSubmit = generated.length;
  const pendingSubmit = ui.submit.events.click();
  assert.equal(generated.length, beforeSubmit, 'ComfyUI must wait until configuration persistence finishes');
  assert(!ui.modal.removed, 'Keep the editor until save succeeds');
  assert(ui.submit.disabled && ui.saveButton.disabled);
  await ui.submit.events.click();
  await ui.saveButton.events.click();
  assert.equal(pendingSaves, 1, 'Repeated clicks share one pending save');
  releaseSave(); await pendingSubmit;
  assert.equal(generated.length, beforeSubmit+1);
  assert(ui.modal.removed);
  assert.equal(generated.at(-1)[2], 'saved before generating');
  context.saveChatConditional = async () => { throw new Error('storage unavailable'); };
  ui = openModal(6); ui.content.value = 'unsaved change';
  const beforeFailedSubmit = generated.length;
  await ui.submit.events.click();
  assert.equal(generated.length, beforeFailedSubmit, 'A failed save cannot start generation');
  assert(!ui.modal.removed);
  assert(!ui.submit.disabled && !ui.saveButton.disabled);
  assert.equal(context.chat[6].extra.sceneDrawConfig.prompt, 'saved before generating');
  const persistedMessage = JSON.parse(JSON.stringify(context.chat[6]));
  context.saveChatConditional = async () => {};
  context.fetch = async () => ({ok:true,json:async()=>[{},persistedMessage]});
  ui = openModal(6); ui.content.value = 'silently unsaved edit';
  await ui.submit.events.click();
  assert.equal(generated.length, beforeFailedSubmit, 'A swallowed save error is detected by reading the stored configuration');
  assert(!ui.modal.removed);
  assert.equal(context.chat[6].extra.sceneDrawConfig.prompt, 'saved before generating');
  context.getContext = () => ({chatId:'group-archive',groupId:'group-id',characters:[],characterId:undefined});
  context.fetch = async (url, options) => {
    assert.equal(url, '/api/chats/group/get');
    assert.equal(JSON.parse(options.body).id, 'group-archive');
    return {ok:true,json:async()=>[{},...context.chat]};
  };
  ui = openModal(6);
  await ui.saveButton.events.click();
  assert.equal(notices.at(-1)[0], 'success', 'Group chat configurations are also verified');
  context.fetch = async () => ({ok:true,json:async()=>[{},...context.chat]});
  context.saveChatConditional = () => new Promise(resolve => { releaseSave = resolve; });
  ui = openModal(6);
  const switchingSubmit = ui.submit.events.click();
  context.chat[6] = { extra: { sceneDrawPrompt: 'different chat' } };
  releaseSave(); await switchingSubmit;
  assert.equal(generated.length, beforeFailedSubmit, 'Switching chats while saving prevents generation in the wrong chat');
  context.saveChatConditional = async () => {};
  const namePrompt = '李蕊男站在窗边，张艺怀在远处，李蕊男转身。';
  context.chat[7] = { extra: { sceneDrawPrompt: namePrompt, sceneDrawConfig: {
    prompt: namePrompt, aspectRatio: '1:1', loraControls: {character:'LiRuinan_v4',penisSize:0,zoom:0}
  } } };
  const storedNameConfig = JSON.stringify(context.chat[7].extra);
  ui = openModal(7);
  ui.content.value += ' 灯光柔和。';
  ui.sliders[0].value = '1'; ui.sliders[0].events.input();
  assert.equal(ui.content.value, '杨玛果站在窗边，张艺怀在远处，杨玛果转身。 灯光柔和。', 'Replace all old-role names while preserving other people and manual edits');
  ui.sliders[0].value = '2'; ui.sliders[0].events.input();
  assert.equal(ui.content.value, '牟纭萱站在窗边，张艺怀在远处，牟纭萱转身。 灯光柔和。', 'Sequential slider changes use the previous selected role');
  assert.equal(JSON.stringify(context.chat[7].extra), storedNameConfig, 'Slider edits do not save message configuration');
  ui.modal.events.click({target:ui.modal});
  ui = openModal(7);
  assert.equal(ui.content.value, namePrompt, 'Closing without saving discards automatic replacements');
  ui.sliders[0].value = '1'; ui.sliders[0].events.input();
  await ui.saveButton.events.click();
  assert.equal(context.chat[7].extra.sceneDrawConfig.prompt, namePrompt.replaceAll('李蕊男','杨玛果'));
  ui = openModal(7);
  assert.equal(ui.sliders[0].value, '1');
  ui.sliders[0].value = '7'; ui.sliders[0].events.input();
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[2], namePrompt.replaceAll('李蕊男','张艺怀'));
  assert.equal(context.chat[7].extra.sceneDrawConfig.loraControls.character, 'ZhangYihuai_v1');
  ui = openModal(7);
  ui.content.value = 'An empty landscape with warm lighting.';
  ui.sliders[0].value = '0'; ui.sliders[0].events.input();
  assert.equal(ui.content.value, 'An empty landscape with warm lighting.', 'No matching full name leaves the prompt unchanged');
  context.chat[8] = { extra: { sceneDrawPrompt: '李蕊男站在窗边。', sceneDrawConfig: {
    prompt: '李蕊男站在窗边。', aspectRatio: '1:1', loraControls: {character:'LiRuinan_v4',penisSize:0,zoom:0}
  } } };
  ui = openModal(8);
  assert.equal(ui.sliders[0].value, '0', 'Saved role follows the version present in the workflow');
  assert.equal(ui.sliderGroup.children[0].children[0].textContent, '李蕊男');
  await ui.saveButton.events.click();
  assert.equal(context.chat[8].extra.sceneDrawConfig.loraControls.character, 'LiRuinan_v2');
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[4].character, 'LiRuinan_v2', 'Current v2 workflow wins over an old v4 saved selection');
  savedSettings.workflow = JSON.stringify(defaultWorkflow).replaceAll('LiRuinan_v2','LiRuinan_v4');
  ui = openModal(8);
  assert.equal(ui.sliders[0].value,'0');
  assert.equal(ui.sliderGroup.children[0].children[0].textContent,'李蕊男');
  await ui.saveButton.events.click();
  assert.equal(context.chat[8].extra.sceneDrawConfig.loraControls.character,'LiRuinan_v4','An existing v2 selection follows a newly configured v4 workflow');
  await ui.submit.events.click();
  assert.equal(generated.at(-1)[4].character,'LiRuinan_v4');
  console.log('Summary modal: save without generation, per-message snapshots, reload, global fallback, zero values, discarded edits, save failures and chat switches passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
