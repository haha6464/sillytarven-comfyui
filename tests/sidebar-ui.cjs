const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const controls = source.slice(source.indexOf('function sidebarPresentation('), source.indexOf('function renderSidebar('));
const workflow = source.slice(source.indexOf('function workflowWidget('), source.indexOf('function ensureSidebar('));
const steps = [['summarizing', '总结', '总结场景'], ['completed', '完成', '图片生成完成']];
const busySteps = ['summarizing', 'submitting', 'generating'];
const messageFor = (step) => ({ extra: { sceneDrawState: { step, detail: '测试状态' }, sceneDrawPrompt: step === 'idle' || step === 'summarizing' ? '' : 'scene' } });

// Temporary DOM-only preview on the user's page. No API calls or chat writes.
if (process.argv[2] === '--preview') {
  const step = process.argv[3] === 'sampling' ? 'generating' : process.argv[3] || 'completed';
  assert(['idle', 'reviewing', 'completed', 'failed', 'cancelled', ...busySteps].includes(step));
  console.log(`(() => {
    const sidebar = document.querySelector('#scene-draw-sidebar');
    if (!sidebar) throw new Error('Sidebar is not visible');
    window.__sceneDrawUiOriginal ||= sidebar.innerHTML;
    window.__sceneDrawUiOriginalHidden ??= sidebar.hidden;
    const mesId = sidebar.querySelector('button')?.dataset.sceneDrawMesid || '0';
    sidebar.hidden = false;
    let style = document.querySelector('#scene-draw-ui-preview-style');
    if (!style) { style = document.createElement('style'); style.id = 'scene-draw-ui-preview-style'; document.head.append(style); }
    style.textContent = ${JSON.stringify(css)};
    const message = ${JSON.stringify(messageFor(step))};
    if (${JSON.stringify(process.argv[3])} === 'sampling') message.extra.sceneDrawState.progress = { value: 3, max: 9 };
    const chat = [message];
    const workflowSteps = ${JSON.stringify(steps)};
    ${controls}
    ${workflow}
    sidebar.replaceChildren(sidebarGenerateControl(mesId, message, ${busySteps.includes(step)}));
    if (${JSON.stringify(process.argv[3])} === 'sampling') sidebar.append(sidebarStopControl('-1', { clientId: 'preview-only' }));
    if (${JSON.stringify(step)} !== 'idle') {
      const widget = workflowWidget(0, message.extra.sceneDrawState);
      widget.querySelectorAll('[data-scene-draw-mesid]').forEach(node => node.dataset.sceneDrawMesid = mesId);
      sidebar.append(widget);
    }
    const button = sidebar.querySelector('button');
    const computed = getComputedStyle(button);
    return { state: button.dataset.state, text: sidebar.textContent, border: computed.borderStyle, appearance: computed.appearance, disabled: button.disabled, width: button.offsetWidth };
  })()`);
  process.exit(0);
}
if (process.argv[2] === '--restore') {
  console.log(`(() => { const sidebar = document.querySelector('#scene-draw-sidebar'); if (sidebar && window.__sceneDrawUiOriginal !== undefined) { sidebar.innerHTML = window.__sceneDrawUiOriginal; if (window.__sceneDrawUiOriginalHidden !== undefined) sidebar.hidden = window.__sceneDrawUiOriginalHidden; } document.querySelector('#scene-draw-ui-preview-style')?.remove(); delete window.__sceneDrawUiOriginal; delete window.__sceneDrawUiOriginalHidden; return 'Preview restored'; })()`);
  process.exit(0);
}

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; }
  get classList() { return { add: (name) => { this.className += ' ' + name; }, contains: (name) => this.className.split(' ').includes(name) }; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { this.children.push(...nodes); }
}
const context = vm.createContext({ document: { createElement: tag => new Element(tag) }, chat: [messageFor('completed')], workflowSteps: steps });
vm.runInContext(controls + workflow, context);
for (const step of ['idle', 'reviewing', 'completed', 'failed', ...busySteps]) {
  const busy = busySteps.includes(step);
  const button = context.sidebarGenerateControl('48', messageFor(step), busy);
  assert.equal(button.dataset.sceneDrawMesid, '48');
  assert.equal(button.disabled, busy);
  assert.equal(button.attributes['aria-busy'], String(busy));
  assert(button.innerHTML.includes('<svg'));
  assert(!button.innerHTML.includes('fa-spin'));
  assert(button.attributes['aria-label']);
  assert.equal(button.title, undefined, 'No tooltip explanation');
  assert.equal(button.children.length, step === 'idle' ? 0 : 1);
  if (busy) assert.equal(button.children[0].innerHTML, '<span></span><span></span><span></span>');
  if (step === 'completed') assert.equal(button.children[0].textContent, '✓');
  if (step === 'reviewing') assert.equal(button.children[0].textContent, '✎');
  if (step === 'failed') assert.equal(button.children[0].textContent, '!');
  context.chat[0] = messageFor(step);
  const widget = context.workflowWidget(0, context.chat[0].extra.sceneDrawState);
  assert.equal(widget.children.length, 1, 'No extra status text');
  assert.equal(widget.title, undefined, 'No workflow tooltip explanation');
  assert.equal(widget.children[0].children.length, 2, 'Only summary and completion nodes');
}
assert.equal(context.sidebarPresentation(messageFor('completed'), true).state, 'busy', 'Runtime lock wins while saving');
assert.equal(context.sidebarPresentation(messageFor('generating'), false).state, 'idle', 'Stale persisted state cannot spin');
const stopButton = context.sidebarStopControl('48', { clientId: 'own-job' });
assert.equal(stopButton.disabled, false);
assert.equal(stopButton.dataset.sceneDrawMesid, '48');
assert.equal(stopButton.attributes['aria-label'], '中断本次生图');
assert(stopButton.innerHTML.includes('<svg'));
assert.equal(stopButton.title, undefined, 'No explanatory tooltip or visible text');
assert.equal(context.sidebarStopControl('48', {}).disabled, true, 'Wait until submission has a client ID');
assert.equal(context.sidebarStopControl('48', { clientId: 'own-job', cancelling: true }).disabled, true, 'Prevent duplicate interruption');
context.chat[0] = messageFor('cancelled');
const cancelledWidget = context.workflowWidget(0, context.chat[0].extra.sceneDrawState);
assert(!cancelledWidget.children[0].children[1].classList.contains('active'), 'Cancelled generation is not displayed as running');
assert(!cancelledWidget.children[0].children[1].classList.contains('done'), 'Cancelled generation is not displayed as completed');
const samplingMessage = messageFor('generating');
samplingMessage.extra.sceneDrawState.progress = { value: 3, max: 9 };
const samplingButton = context.sidebarGenerateControl('48', samplingMessage, true);
assert.equal(samplingButton.innerHTML, '', 'Real steps replace the image glyph, with no extra badge');
assert.equal(samplingButton.children.length, 1);
assert.equal(samplingButton.children[0].textContent, '3/9');
assert.equal(samplingButton.children[0].attributes['aria-valuenow'], '3');
assert.equal(samplingButton.children[0].attributes['aria-valuemax'], '9');
assert.equal(samplingButton.children[0].dataset.compact, 'false');
assert(samplingButton.attributes['aria-label'].includes('3/9'));
assert.equal(context.sidebarGenerateControl('48', samplingMessage, false).children.length, 0, 'Reloaded/stale progress is not shown');
samplingMessage.extra.sceneDrawState.progress = { value: 100, max: 100 };
assert.equal(context.sidebarGenerateControl('48', samplingMessage, true).children[0].dataset.compact, 'true');
samplingMessage.extra.sceneDrawState.step = 'completed';
assert(context.sidebarGenerateControl('48', samplingMessage, true).innerHTML.includes('<svg'), 'Saving must not retain a step counter');
assert(css.includes('appearance: none'));
assert(css.includes('border: 0'));
assert(css.includes('prefers-reduced-motion'));
assert(!source.includes('scene-draw-sidebar-label'));
assert(!source.includes('scene-draw-workflow-detail'));
console.log('Sidebar UI: all state, stale-lock, accessibility and compact-layout checks passed.');
