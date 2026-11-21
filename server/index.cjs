const fs = require('node:fs/promises');
const path = require('node:path');

exports.info = { id: 'scene-draw-files', name: 'Scene Draw file cleanup', description: 'Reference-aware cleanup of Scene Draw images' };

async function filesIn(directory) {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('扫描目录中存在符号链接，已停止清理。');
    const file = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesIn(file));
    else if (item.isFile()) result.push(file);
  }
  return result;
}
function imagePath(value) {
  if (typeof value !== 'string') return null;
  try {
    const relative = decodeURIComponent(value.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, ''));
    if (!relative.startsWith('user/images/') || relative.includes('\\') || relative.split('/').some(x => x === '..' || x === '.')) return null;
    return relative;
  } catch { return null; }
}
function visit(value, callback) {
  callback(value);
  if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child, callback);
}
async function scan(dirs) {
  const images = await filesIn(dirs.userImages);
  const references = new Map();
  const owned = new Set();
  const records = [];
  for (const absolute of images) {
    const relative = path.relative(dirs.root, absolute).split(path.sep).join('/');
    references.set(relative, []);
    const stat = await fs.stat(absolute);
    records.push({ path: relative, absolutePath: absolute, bytes: stat.size, references: 0 });
  }
  // Failure to read/parse any active chat aborts deletion rather than assuming it has no references.
  for (const folder of [dirs.chats, dirs.groupChats]) {
    for (const file of await filesIn(folder)) {
      if (!file.endsWith('.jsonl')) continue;
      const values = (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x));
      let strings = '';
      visit(values, value => {
        if (typeof value === 'string') {
          strings += '\n' + value;
          try { strings += '\n' + decodeURIComponent(value); } catch { /* Keep original string. */ }
        }
        if (value && typeof value === 'object') {
          const urls = [value.sceneDrawImage, ...(Array.isArray(value.sceneDrawImages) ? value.sceneDrawImages.map(x => x?.url) : [])];
          for (const url of urls) { const relative = imagePath(url); if (relative) owned.add(relative); }
        }
      });
      for (const item of records) if (strings.includes(item.path)) references.get(item.path).push(file);
    }
  }
  for (const item of records) item.references = references.get(item.path).length;
  return { records, references, owned };
}
async function readLedger(dirs) {
  try { return JSON.parse(await fs.readFile(path.join(dirs.root, 'scene-draw-files.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function run(dirs, mode, requested = []) {
  const ledger = await readLedger(dirs);
  const state = await scan(dirs);
  for (const file of state.owned) ledger[file] ||= { referenced: true };
  for (const item of state.records) {
    if (item.path.startsWith('user/images/scene-draw/')) ledger[item.path] ||= { referenced: false };
  }
  const deleted = [], retained = [];
  if (mode === 'cleanup') {
    for (const item of state.records) {
      // Targeted gallery removal, or a previously referenced image whose last chat/message was removed.
      if (!ledger[item.path] || (requested.length ? !requested.includes(item.path) : !ledger[item.path].referenced)) continue;
      if (item.references) { retained.push(item.path); continue; }
      // Recheck all chats immediately before unlinking each exact image file.
      const fresh = await scan(dirs);
      if (fresh.references.get(item.path)?.length) { retained.push(item.path); continue; }
      const realRoot = await fs.realpath(dirs.userImages);
      const realFile = await fs.realpath(item.absolutePath);
      const relative = path.relative(realRoot, realFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('图片不在当前用户图片目录内。');
      await fs.unlink(realFile);
      deleted.push(item.path);
      delete ledger[item.path];
    }
  }
  if (mode !== 'report') {
    for (const item of state.records) if (ledger[item.path] && !deleted.includes(item.path)) ledger[item.path].referenced = item.references > 0;
    const destination = path.join(dirs.root, 'scene-draw-files.json');
    await fs.writeFile(destination + '.tmp', JSON.stringify(ledger, null, 2));
    await fs.rename(destination + '.tmp', destination);
  }
  return { deleted, retained, candidates: state.records.filter(x => !x.references && ledger[x.path]), unclassified: state.records.filter(x => !x.references && !ledger[x.path] && !deleted.includes(x.path)) };
}
exports.scan = scan;
exports.run = run;
exports.workflowMatch = async file => {
  const handle = await fs.open(file, 'r');
  try {
    const signature = Buffer.alloc(8);
    await handle.read(signature,0,8,0);
    if (signature.toString('hex') !== '89504e470d0a1a0a') return false;
    const size = (await handle.stat()).size;
    for (let offset=8; offset+12<=size;) {
      const header=Buffer.alloc(8); await handle.read(header,0,8,offset);
      const length=header.readUInt32BE(0), type=header.toString('ascii',4,8);
      if (offset+12+length>size) return false;
      if(type==='tEXt' && length<2000000) {
        const data=Buffer.alloc(length); await handle.read(data,0,length,offset+8);
        if(data.subarray(0,7).toString()==='prompt\0') {
          try {
            const workflow=JSON.parse(data.subarray(7).toString('utf8'));
            return workflow['3']?.class_type==='Lora Loader (LoraManager)' && workflow['5']?.class_type==='CLIPTextEncode'
              && workflow['14']?.class_type==='KSampler' && workflow['15']?.class_type==='SaveImage'
              && /^Krea/.test(workflow['15'].inputs?.filename_prefix || '');
          } catch { return false; }
        }
      }
      offset+=12+length;
    }
    return false;
  } finally { await handle.close(); }
};
exports.init = async router => {
  let queue = Promise.resolve();
  for (const mode of ['track', 'report', 'cleanup']) router.post('/' + mode, (req, res) => {
    const task = async () => {
      if (!req.user?.directories) return res.sendStatus(403);
      try { res.json(await run(req.user.directories, mode, Array.isArray(req.body?.paths) ? req.body.paths.map(imagePath).filter(Boolean) : [])); }
      catch (error) { console.error('[Scene Draw cleanup]', error); res.status(500).json({ error: '无法完整检查聊天引用，未继续清理：' + error.message }); }
    };
    queue = queue.then(task, task);
  });
};
