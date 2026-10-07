const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const modalSource = source.slice(source.indexOf('function showSummaryModal('), source.indexOf('function showImageViewer('));
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
const context = vm.createContext({
  chat: [message],
  document: { body, querySelector: () => null, createElement: tag => new Element(tag) },
  notify: (...args) => notices.push(args),
  generateFromSummary: (...args) => generated.push(args),
});
vm.runInContext(modalSource, context);
const openModal = () => {
  context.showSummaryModal(0);
  const modal = body.children.at(-1);
  const [title, content, actions] = modal.children[0].children;
  const [close, submit] = actions.children;
  return { modal, title, content, actions, close, submit };
};
let ui = openModal();
assert.equal(ui.close.textContent, '关闭');
assert.equal(ui.submit.textContent, '提交');
assert.equal(ui.actions.children.length, 2);
assert.equal(ui.submit.type, 'button');
assert.equal(ui.content.value, 'original scene');
ui.close.events.click();
assert(ui.modal.removed);
assert.equal(generated.length, 0, 'Closing does not submit');
ui = openModal();
ui.content.value = '  edited scene  ';
ui.submit.events.click();
assert(ui.modal.removed);
assert.equal(generated[0][2], 'edited scene', 'Submit continues with the edited summary');
ui = openModal();
ui.content.value = '   ';
ui.submit.events.click();
assert.equal(generated.length, 1, 'Empty prompt is not submitted');
assert(!ui.modal.removed);
assert(ui.content.focused);
assert.equal(notices.at(-1)[0], 'error');
ui.modal.events.click({ target: ui.modal });
assert(ui.modal.removed, 'Backdrop still closes the modal');
const buttons = css.match(/\.scene-draw-summary-modal-actions > button\s*\{([^}]+)\}/)[1];
assert(buttons.includes('white-space: nowrap'));
assert(buttons.includes('writing-mode: horizontal-tb'));
assert(buttons.includes('flex: 0 0 auto'));
assert(buttons.includes('width: auto'));
const actions = css.match(/\.scene-draw-summary-modal-actions\s*\{([^}]+)\}/)[1];
assert(actions.includes('flex-direction: row'));
assert(actions.includes('flex-wrap: nowrap'));
console.log('Summary modal: horizontal button styling, labels, close, edited submit and empty prompt checks passed.');
