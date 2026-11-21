const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname,'../artifacts/phone-audit');
const report = JSON.parse(fs.readFileSync(path.join(directory,'report.json'),'utf8'));
const matches = report.unclassified.filter(x=>x.workflowMatchesPlugin);
const other = report.unclassified.filter(x=>!x.workflowMatchesPlugin);
for (const [name, items] of [['plugin-workflow-candidates',matches],['unconfirmed-origin',other]]) {
  const bytes=items.reduce((sum,item)=>sum+item.bytes,0);
  const header = ['READ-ONLY REPORT. NO IMAGES DELETED.',
    name==='plugin-workflow-candidates'?'Workflow matches plugin defaults; historical origin is probable, not provable.':'Origin could not be confirmed. Do not assume these belong to the plugin.',
    'No references found in current single/group chat archives. Backups/exports are not counted.',
    `Files: ${items.length}; bytes: ${bytes}; GiB: ${(bytes/2**30).toFixed(3)}`,''];
  fs.writeFileSync(path.join(directory,name+'.txt'),header.concat(items.map((item,index)=>`${index+1}. ${item.absolutePath}\n   ${item.bytes} bytes`)).join('\n'));
}
console.log(JSON.stringify({candidates:matches.length,bytes:matches.reduce((a,x)=>a+x.bytes,0),unconfirmed:other.length,first:matches[0]?.absolutePath,last:matches.at(-1)?.absolutePath},null,2));
