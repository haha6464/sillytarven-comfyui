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
});
vm.runInContext(ratioSource + modalSource, context);
const openModal = (mesId = 0) => {
  context.showSummaryModal(mesId);
  const modal = body.children.at(-1);
  const [title, content, actions] = modal.children[0].children;
  const [ratios, submitControls] = actions.children;
  const [submit, sliderGroup] = submitControls.children;
  const sliders = sliderGroup.children.map(field => field.children[1]);
  const radios = ratios.children.flatMap(row => row.children.slice(1).map(option => option.children[0]));
  const select = ratio => {
    radios.forEach(radio => { radio.checked = false; });
    const radio = radios.find(item => item.value === ratio);
    radio.checked = true;
    radio.events.change();
  };
  return { modal, title, content, actions, ratios, radios, select, submitControls, sliderGroup, sliders, submit };
};
let ui = openModal();
assert.equal(ui.submit.textContent, '提交');
assert.equal(ui.actions.children.length, 2);
assert.equal(ui.submitControls.children.filter(child => child.tag === 'button').length, 1, 'No close button');
assert.equal(ui.submit.type, 'button');
assert.equal(ui.content.value, 'original scene');
assert.equal(ui.sliders.length, 2);
assert.deepEqual(ui.sliders.map(slider => [slider.min, slider.max, slider.step]), [['0', '5', '1'], ['-12', '0', '0.5']]);
assert(ui.sliders.every(slider => !slider.disabled));
assert.deepEqual(ui.sliderGroup.children.map(field => field.children[0].textContent), ['李蕊男', 'zoom 0.0']);
assert(ui.submit.disabled, 'Selection is mandatory with no default');
assert.deepEqual(ui.radios.map(radio => radio.value), ['9:16', '3:4', '16:9', '4:3', '1:1']);
assert(ui.radios.every(radio => radio.required && !radio.checked));
assert.deepEqual(ui.ratios.children.map(row => row.children[0].textContent), ['竖版', '横版', '']);
ui.submit.events.click();
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
ui.submit.events.click();
assert(ui.modal.removed);
assert.equal(generated[0][2], 'edited scene', 'Submit continues with the edited summary');
assert.equal(generated[0][3], '3:4');
ui = openModal();
assert.equal(ui.radios.find(radio => radio.checked).value, '3:4', 'Reopening remembers selection');
assert.equal(ui.submit.disabled, false);
assert(ui.radios.find(radio => radio.checked).focused, 'Focus keeps the remembered ratio');
ui.content.value = '   ';
ui.select('1:1');
ui.submit.events.click();
assert.equal(generated.length, 1, 'Empty prompt is not submitted');
assert(!ui.modal.removed);
assert(ui.content.focused);
assert.equal(notices.at(-1)[0], 'error');
ui.modal.events.click({ target: ui.modal });
assert(ui.modal.removed, 'Backdrop still closes the modal');
ui = openModal();
assert.equal(ui.radios.find(radio => radio.checked).value, '1:1', 'Closing without submitting still remembers selection');
ui.modal.remove();
// Reloaded settings and another message/chat use the same last selected preference.
savedSettings = JSON.parse(JSON.stringify(savedSettings));
context.chat[1] = { extra: { sceneDrawPrompt: 'another chat scene', sceneDrawAspectRatio: '4:3' } };
ui = openModal(1);
assert.equal(ui.radios.find(radio => radio.checked).value, '1:1', 'Another chat defaults to the last selection');
assert.equal(ui.submit.disabled, false);
ui.submit.events.click();
assert.equal(generated.at(-1)[0], 1);
assert.equal(generated.at(-1)[3], '1:1');
for (const ratio of ['9:16', '3:4', '16:9', '4:3', '1:1']) {
  ui = openModal();
  ui.select(ratio);
  ui.submit.events.click();
  assert.equal(generated.at(-1)[3], ratio);
}
ui = openModal();
ui.select('9:16');
context.chat[0] = {};
const beforeSwitch = generated.length;
ui.submit.events.click();
assert.equal(generated.length, beforeSwitch, 'Switching chat blocks stale submissions');
context.chat[0] = message;
ui = openModal();
ui.sliders[0].value = '4';
ui.sliders[0].events.input();
ui.sliders[1].value = '-7.5';
ui.sliders[1].events.input();
assert.equal(savedSettings.lastCharacterLora, 'YinShiyou_v1_9500');
assert.equal(savedSettings.lastZoomLora, -7.5);
assert.deepEqual(ui.sliderGroup.children.map(field => field.children[0].textContent), ['尹施又', 'zoom -7.5']);
ui.modal.events.click({ target: ui.modal });
savedSettings = JSON.parse(JSON.stringify(savedSettings));
ui = openModal(1);
assert.deepEqual(ui.sliders.map(slider => slider.value), ['4', '-7.5'], 'Slider choices survive reload/other chats');
ui.submit.events.click();
assert.equal(generated.at(-1)[4].character, 'YinShiyou_v1_9500');
assert.equal(generated.at(-1)[4].zoom, -7.5);
savedSettings.lastAspectRatio = 'invalid';
ui = openModal();
assert(ui.radios.every(radio => !radio.checked), 'Invalid remembered values are not preselected');
assert(ui.submit.disabled);
const buttons = css.match(/\.scene-draw-summary-submit-controls > button\s*\{([^}]+)\}/)[1];
assert(buttons.includes('white-space: nowrap'));
assert(buttons.includes('writing-mode: horizontal-tb'));
assert(buttons.includes('flex: 0 0 auto'));
assert(buttons.includes('width: auto'));
const actions = css.match(/\.scene-draw-summary-modal-actions\s*\{([^}]+)\}/)[1];
assert(actions.includes('flex-direction: row'));
assert(actions.includes('flex-wrap: wrap'));
assert(actions.includes('justify-content: flex-start'));
assert(actions.includes('align-items: center'));
console.log('Summary modal: remembered ratios across reopening/reloaded settings/other chats, mandatory selection, submit and layout checks passed.');
