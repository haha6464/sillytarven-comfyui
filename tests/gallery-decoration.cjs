const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../index.js'), 'utf8');
const code = source.slice(source.indexOf('function observeGalleryChanges('), source.indexOf('function showSummaryModal('));
let mutations;
const frames = [], decorated = [], unobserved = [];
const detachedGallery = { isConnected: false };
const deferred = new Map([[detachedGallery, {}]]);
const message = { nodeType: 1, isConnected: true, closest: () => message, matches: () => true, querySelectorAll: () => [] };
const inside = { nodeType: 1, closest: () => message, matches: () => false, querySelectorAll: () => [] };
const unrelated = { nodeType: 1, closest: () => null, matches: () => false, querySelectorAll: () => [] };
const ctx = vm.createContext({
  document: { body: {} },
  MutationObserver: class { constructor(callback) { mutations = callback; } observe() {} },
  requestAnimationFrame: callback => frames.push(callback),
  deferredGalleryImages: deferred,
  galleryImageObserver: { unobserve: target => unobserved.push(target) },
  decorateMessage: target => decorated.push(target),
});
vm.runInContext(code + '\nobserveGalleryChanges();', ctx);
mutations([{ target: unrelated, addedNodes: [unrelated] }]);
assert.equal(frames.length, 0, 'Sidebar/settings mutations cannot schedule a full chat scan');
for (let i = 0; i < 30; i++) mutations([{ target: inside, addedNodes: [] }]);
assert.equal(frames.length, 1, 'Repeated mutations share one frame');
frames.shift()();
assert.deepEqual(decorated, [message], 'Only the changed message is decorated once');
assert.equal(deferred.size, 0, 'Detached deferred images are released');
assert.deepEqual(unobserved, [detachedGallery]);
const newMessage = { ...message };
const wrapper = { ...unrelated, querySelectorAll: () => [newMessage] };
mutations([{ target: unrelated, addedNodes: [wrapper] }]);
frames.shift()();
assert.equal(decorated.at(-1), newMessage, 'Newly inserted nested messages are discovered');
message.isConnected = false;
mutations([{ target: inside, addedNodes: [] }]);
frames.shift()();
assert.equal(decorated.length, 2, 'Removed messages cannot be decorated by a delayed frame');
console.log('Gallery decoration: local mutation updates, frame batching, inserted messages and detached-target cleanup passed.');
