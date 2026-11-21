// Run in Termux: node /path/to/extension/server/install.cjs /absolute/SillyTavern
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
if (!root || !path.isAbsolute(root) || !fs.existsSync(path.join(root,'src/plugin-loader.js'))) throw new Error('请提供 SillyTavern 安装目录的绝对路径。');
const configPath = path.join(root,'config.yaml');
const config = fs.readFileSync(configPath,'utf8');
const destination = path.join(root,'plugins/scene-draw-files');
if (fs.existsSync(destination) && fs.realpathSync(destination) !== fs.realpathSync(__dirname)) throw new Error('服务端插件目标目录已存在，请检查：' + destination);
fs.mkdirSync(path.dirname(destination),{recursive:true});
if (!fs.existsSync(destination)) fs.symlinkSync(__dirname,destination,'dir');
if (!fs.existsSync(configPath+'.scene-draw-backup')) fs.copyFileSync(configPath,configPath+'.scene-draw-backup');
const updated = /^enableServerPlugins:.*$/m.test(config)
  ? config.replace(/^enableServerPlugins:.*$/m,'enableServerPlugins: true')
  : config + '\nenableServerPlugins: true\n';
fs.writeFileSync(configPath,updated);
console.log('图片清理模块已安装，请重启酒馆。配置备份：' + configPath+'.scene-draw-backup');
