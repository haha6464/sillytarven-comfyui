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
    const headers = () => ({}); const fetch = async () => ({ok:true,json:async()=>({retained:[]})});
    const imageSizeForRatio = () => ({width:600,height:500});
    ${code}
    for (const color of ['#637b92','#84748e','#729481']) appendGalleryImage(chat[0], 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="'+color+'"/></svg>'), '图集预览');
    renderImage(0);
    document.addEventListener('click', e => { const b=e.target.closest('[data-gallery-action]'); if(b) {e.preventDefault(); void changeGallery(0,b.dataset.galleryAction,b.dataset.galleryUrl);} });
    return 'Local gallery preview';
  })()`);
  process.exit(0);
}
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.style = {}; this.events = {}; this.isConnected = true; }
  get classList() { return { add: name => { this.className += ' ' + name; }, remove: name => { this.className = this.className.split(' ').filter(x=>x!==name).join(' '); } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  removeEventListener(name, callback) { if(this.events[name]===callback)delete this.events[name]; }
  getAttribute(key) { return key === 'src' ? this.src : this.attrs[key]; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attrs[key] = value; }
  remove() { this.removed = true; this.isConnected = false; }
  querySelector(selector) { return selector === '.scene-draw-result' ? this.children.findLast(x => x.className?.split(' ').includes('scene-draw-result') && !x.removed) : null; }
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
  headers: () => ({}), fetch: async () => ({ ok: true, json: async () => ({ retained: [] }) }),
  imageSizeForRatio: () => null,
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
  ctx.fetch = async () => ({ok:true,json:async()=>({retained:['user/images/unrelated.png']})});
  const noticesBeforeDelete = notices.length;
  await ctx.changeGallery(0, 'delete', '/new.png');
  assert.equal(notices.length, noticesBeforeDelete, 'References to unrelated images cannot trigger a retained-file warning');
  assert.equal(message.extra.sceneDrawImages.length, 1);
  assert.equal(node('scene-draw-result-image').src, '/old.png');
  assert.equal(node('scene-draw-gallery-counter').textContent, '1/1');
  ctx.fetch = async () => ({ok:true,json:async()=>({retained:['old.png']})});
  await ctx.changeGallery(0, 'delete', '/old.png');
  assert.equal(notices.at(-1)[0], 'info', 'A retained reference to the selected image still gets a warning');
  assert.equal(message.extra.sceneDrawImages.length, 0);
  assert.equal(message.extra.sceneDrawImage, undefined);
  assert(!result(), 'Deleting the last image removes the gallery');
  ctx.renderImage(0);
  assert(!result(), 'Legacy fallback cannot resurrect deleted images');
  ctx.appendGalleryImage(message, '/again.png', 'again'); ctx.renderImage(0);
  assert.equal(node('scene-draw-result-image').src, '/again.png');
  ctx.fetch = async () => ({ ok: false, status: 404 });
  const beforeUnavailable = saves;
  await ctx.changeGallery(0, 'delete', '/again.png');
  assert.equal(message.extra.sceneDrawImages.length, 1, 'Missing backend cannot silently delete only the reference');
  assert.equal(saves, beforeUnavailable);
  assert(saves >= 5);
  // A long chat containing 100 galleries of eight images must not request 800 originals on render.
  const requests = [], targets = new Set();
  let observer;
  class LazyElement extends Element {
    set src(value) { this.imageSource = value; requests.push(value); }
    get src() { return this.imageSource; }
  }
  ctx.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; observer = this; assert.equal(options.rootMargin,'150px 0px'); }
    observe(target) { targets.add(target); }
    unobserve(target) { targets.delete(target); }
  };
  const lazyMessages = Array.from({length:100}, (_,i) => ({extra:{sceneDrawImages:Array.from({length:8},(_,j)=>({url:`/original-${i}-${j}.png`,prompt:'scene'})),sceneDrawImageIndex:0}}));
  const lazyElements = lazyMessages.map(()=>new Element('div'));
  ctx.chat = lazyMessages;
  ctx.document.createElement = tag => new LazyElement(tag);
  ctx.document.querySelector = selector => lazyElements[Number(selector.match(/mesid="(\d+)"/)[1])];
  for(let i=0;i<100;i++)ctx.renderImage(i);
  assert.equal(requests.length,0,'Rendering offscreen galleries sets no original image URLs');
  assert.equal(targets.size,100);
  const gallery50=lazyElements[50].querySelector('.scene-draw-result');
  observer.callback([{target:gallery50,isIntersecting:false}]);
  assert.equal(requests.length,0);
  observer.callback([{target:gallery50,isIntersecting:true}]);
  assert.deepEqual(requests,['/original-50-0.png'],'Visibility loads only the selected original, not all eight');
  const visibleImage=gallery50.children.find(x=>x.className==='scene-draw-result-image');
  ctx.deferGalleryImages(gallery50,lazyMessages[50],visibleImage,visibleImage.src);
  assert(!targets.has(gallery50),'In-flight loads cannot be queued again by message decoration');
  visibleImage.events.load();
  assert.equal(visibleImage.hidden,false);
  await ctx.changeGallery(50,'next','/original-50-0.png');
  const nextGallery=lazyElements[50].querySelector('.scene-draw-result');
  assert.equal(requests.length,1,'Flipping a page is still deferred until its gallery is visible');
  observer.callback([{target:nextGallery,isIntersecting:true}]);
  assert.deepEqual(requests,['/original-50-0.png','/original-50-1.png']);
  const staleGallery=lazyElements[60].querySelector('.scene-draw-result');
  ctx.chat[60]={extra:{}};
  observer.callback([{target:staleGallery,isIntersecting:true}]);
  assert.equal(requests.length,2,'Changing chats before visibility cannot load the old chat image');
  const removedGallery=lazyElements[61].querySelector('.scene-draw-result');
  removedGallery.isConnected=false;
  observer.callback([{target:removedGallery,isIntersecting:true}]);
  assert.equal(requests.length,2,'Detached galleries cannot start downloads');
  const cloningGallery = lazyElements[51].querySelector('.scene-draw-result');
  observer.callback([{target:cloningGallery,isIntersecting:true}]);
  const originalImage = cloningGallery.children.find(x=>x.className==='scene-draw-result-image');
  const staleLoad = originalImage.events.load;
  const clonedImage = new LazyElement('img');
  clonedImage.className = 'scene-draw-result-image'; clonedImage.hidden = true;
  clonedImage.imageSource = originalImage.src; clonedImage.complete = true; clonedImage.naturalWidth = 600; clonedImage.naturalHeight = 450;
  cloningGallery.children[cloningGallery.children.indexOf(originalImage)] = clonedImage;
  originalImage.isConnected = false;
  ctx.deferGalleryImages(cloningGallery,lazyMessages[51],clonedImage,clonedImage.src);
  assert(targets.has(cloningGallery),'Replacing the img re-arms observation even though its gallery was already loading');
  const requestsBeforeCache = requests.length;
  observer.callback([{target:cloningGallery,isIntersecting:true}]);
  assert.equal(clonedImage.hidden,false,'Cached cloned images are revealed without waiting for an event that already fired');
  assert.equal(requests.length,requestsBeforeCache,'Cached restoration does not reassign src or refetch');
  staleLoad();
  assert.equal(clonedImage.hidden,false,'Stale callbacks cannot change the replacement image state');
  console.log('Viewport loading: 100 galleries x 8 originals, no offscreen requests, selected-image-only loading, page flips and stale targets passed.');
  console.log('Gallery: legacy migration, append, paging, prompts/downloads, persistence, stale controls, deletion, empty gallery and save rollback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
