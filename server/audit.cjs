// Read-only: node server/audit.cjs /absolute/SillyTavern/data/account
const path = require('node:path');
const { run, workflowMatch } = require('./index.cjs');
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('请提供酒馆账号目录的绝对路径。');
run({ root, userImages: path.join(root,'user/images'), chats: path.join(root,'chats'), groupChats: path.join(root,'group chats') }, 'report')
  .then(async report => {
    for (const file of report.unclassified) file.workflowMatchesPlugin = await workflowMatch(file.absolutePath);
    console.log(JSON.stringify({ readOnly: true, accountDirectory: root, ...report }, null, 2));
  })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
