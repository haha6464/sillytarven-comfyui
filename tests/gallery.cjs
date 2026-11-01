const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../index.js'), 'utf8');
const code = source.slice(source.indexOf('function galleryImages('), source.indexOf('async function generateFromSummary('));
if (process.argv[2] === '--preview') {
  const css = fs.readFileSync(require('node:path').resolve(__dirname, '../style.css'), 'utf8');
  console.log(`(() => {
    document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} }));
    document.body.style.cssText = 'margin:16px;background:#191919;color:white;font:16px sans-serif';
    const mes = document.createElement('div'); mes.className = 'mes'; mes.setAttribute('mesid', '0'); document.body.append(mes);
    const chat = [{extra:{}}]; const saveChatConditional = async () => {}; const notify = () => {};
    ${code}
    for (const color of ['#637b92','#84748e','#729481']) appendGalleryImage(chat[0], 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="'+color+'"/></svg>'), '图集预览');
    renderImage(0);
    document.addEventListener('click', e => { const b=e.target.closest('[data-gallery-action]'); if(b) {e.preventDefault(); void changeGallery(0,b.dataset.galleryAction,b.dataset.galleryUrl);} });
    return 'Local gallery preview';
  })()`);
  process.exit(0);
}
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attrs[key] = value; }
  remove() { this.removed = true; }
  querySelector(selector) { return selector === '.scene-draw-result' ? this.children.findLast(x => x.className === 'scene-draw-result' && !x.removed) : null; }
}
const mes = new Element('div');
let message = { extra: { sceneDrawImage: '/old.png', sceneDrawPrompt: 'old scene' } };
let saves = 0, rejectSave = false;
const notices = [];
const ctx = vm.createContext({
  chat: [message], CSS: { escape: x => x },
  document: { querySelector: () => mes, createElement: tag => new Element(tag) },
  saveChatConditional: async () => { saves++; if (rejectSave) throw new Error('disk full'); },
  notify: (...args) => notices.push(args),
});
vm.runInContext(code, ctx);
const result = () => mes.querySelector('.scene-draw-result');
const node = className => result().children.find(x => x.className === className);
(async () => {
  ctx.renderImage(0);
  assert.equal(node('scene-draw-result-image').src, '/old.png');
  ctx.appendGalleryImage(message, '/new.png', 'new scene');
  ctx.renderImage(0);
  assert.equal(message.extra.sceneDrawImages.length, 2);
  assert.equal(node('scene-draw-result-image').src, '/new.png');
  assert.equal(node('scene-draw-gallery-counter').textContent, '2/2');
  await ctx.changeGallery(0, 'previous', '/new.png');
  assert.equal(node('scene-draw-result-image').alt, 'old scene');
  assert.equal(node('scene-draw-result-download').href, '/old.png');
  await ctx.changeGallery(0, 'previous', '/old.png');
  assert.equal(node('scene-draw-result-image').src, '/new.png', 'Navigation wraps');
  // Simulate chat reload: the array, image prompts and selected page survive JSON persistence.
  message = JSON.parse(JSON.stringify(message)); ctx.chat[0] = message; ctx.renderImage(0);
  assert.equal(node('scene-draw-gallery-counter').textContent, '2/2');
  await ctx.changeGallery(0, 'delete', '/stale.png');
  assert.equal(message.extra.sceneDrawImages.length, 2, 'Stale cloned controls cannot delete a different image');
  rejectSave = true;
  await ctx.changeGallery(0, 'delete', '/new.png');
  assert.equal(message.extra.sceneDrawImages.length, 2, 'Failed save restores the removed image');
  assert.equal(notices.at(-1)[0], 'error');
  rejectSave = false;
  await ctx.changeGallery(0, 'next', message.extra.sceneDrawImage);
  await ctx.changeGallery(0, 'delete', '/new.png');
  assert.equal(message.extra.sceneDrawImages.length, 1);
  assert.equal(node('scene-draw-result-image').src, '/old.png');
  assert.equal(node('scene-draw-gallery-counter').textContent, '1/1');
  await ctx.changeGallery(0, 'delete', '/old.png');
  assert.equal(message.extra.sceneDrawImages.length, 0);
  assert.equal(message.extra.sceneDrawImage, undefined);
  assert(!result(), 'Deleting the last image removes the gallery');
  ctx.renderImage(0);
  assert(!result(), 'Legacy fallback cannot resurrect deleted images');
  ctx.appendGalleryImage(message, '/again.png', 'again'); ctx.renderImage(0);
  assert.equal(node('scene-draw-result-image').src, '/again.png');
  assert(saves >= 5);
  console.log('Gallery: legacy migration, append, paging, prompts/downloads, persistence, stale controls, deletion, empty gallery and save rollback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
