// Local-only transfer bridge. Use `adb reverse tcp:27866 tcp:27866`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const reportFile = path.resolve(__dirname, '../artifacts/phone-audit/report.json');
const core = fs.readFileSync(path.resolve(__dirname, '../server/index.cjs'),'utf8');
const audit = core + `\n(async()=>{
  const root = path.resolve('data/default-user');
  const report = await exports.run({root,userImages:path.join(root,'user/images'),chats:path.join(root,'chats'),groupChats:path.join(root,'group chats')},'report');
  for (const file of report.unclassified) file.workflowMatchesPlugin = await exports.workflowMatch(file.absolutePath);
  const response = await fetch('http://127.0.0.1:27866/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readOnly:true,accountDirectory:root,...report})});
  if(!response.ok)throw new Error('Report transfer failed');
  console.log('Read-only report transferred. No images deleted.');
})().catch(console.error);`;
http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/audit.cjs') { res.end(audit); return; }
  if(req.method==='POST' && req.url==='/report') {
    try {
      const chunks=[]; let bytes=0;
      for await(const chunk of req) {bytes+=chunk.length;if(bytes>20000000)throw new Error('Report too large');chunks.push(chunk);}
      const report=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(report.readOnly!==true)throw new Error('Not an audit report');
      fs.mkdirSync(path.dirname(reportFile),{recursive:true});
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
      console.log('Report saved:',reportFile); res.end('OK');
    }catch(error){res.statusCode=400;res.end(error.message);}return;
  }
  res.statusCode=404;res.end();
}).listen(27866,'127.0.0.1',()=>console.log('Read-only phone audit bridge: 127.0.0.1:27866'));
