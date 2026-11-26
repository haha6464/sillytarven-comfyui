// Manual browser regression fixture: node tests/gallery-browser-fixture.mjs
// /?case=clone replaces an in-flight image the way message beautifiers can.
import fs from 'node:fs';
import http from 'node:http';
const source = fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const css = fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
const gallery = source.slice(source.indexOf('function galleryImages('),source.indexOf('async function generateFromSummary('));
const decoration = source.slice(source.indexOf('function decorateMessage('),source.indexOf('function showSummaryModal('));
const requests=[];
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://127.0.0.1:27869');
  if(url.pathname==='/requests'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
  if(url.pathname.startsWith('/original/')){
    requests.push(url.pathname);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#718f83"/><text x="20" y="60" font-size="24" fill="white">'+url.pathname+'</text></svg>';
    setTimeout(()=>{res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','max-age=3600');res.end(svg);},400);
    return;
  }
  res.setHeader('Content-Type','text/html;charset=utf-8');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gallery loading regression fixture</title><style>${css}
    body{margin:0;background:#191919;color:#ddd;font:16px sans-serif}#chat{height:90vh;overflow:auto;padding:12px}.mes{margin-bottom:30px}.mes_text{padding:10px}
  </style><div id="chat"></div><script>
    const fixtureRun=${JSON.stringify(url.searchParams.get('revision') || 'default')};
    const chat=Array.from({length:100},(_,i)=>({extra:{sceneDrawImages:Array.from({length:8},(_,j)=>({url:'/original/'+i+'-'+j+'.svg?run='+encodeURIComponent(fixtureRun),prompt:'fixture'})),sceneDrawImageIndex:0,sceneDrawAspectRatio:'4:3'}}));
    const imageSizeForRatio=()=>({width:600,height:450}); const saveChatConditional=async()=>{}; const headers=()=>({});const notify=()=>{};
    ${gallery}
    ${decoration}
    const container=document.querySelector('#chat');
    for(let i=0;i<100;i++){const mes=document.createElement('div');mes.className='mes';mes.setAttribute('mesid',i);const text=document.createElement('div');text.className='mes_text';text.textContent='AI message '+i;mes.append(text);container.append(mes);}
    let cloned=false;
    new MutationObserver(()=>{
      const image=container.querySelector('.scene-draw-result-image[src]');
      if(${JSON.stringify(url.searchParams.get('case'))}==='clone'&&!cloned&&image){cloned=true;image.replaceWith(image.cloneNode(true));}
      decorateMessages();
    }).observe(container,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
    decorateMessages();
    document.addEventListener('click',event=>{const b=event.target.closest('[data-gallery-action]');if(b){event.preventDefault();void changeGallery(b.closest('.scene-draw-result').dataset.sceneDrawMesid,b.dataset.galleryAction,b.dataset.galleryUrl);}});
    window.fixture={chat,scrollTo:id=>container.querySelector('.mes[mesid="'+id+'"]').scrollIntoView(),cloneFirst:()=>{const image=container.querySelector('.scene-draw-result-image[src]');image.replaceWith(image.cloneNode(true));}};
  </script>`);
}).listen(27869,'127.0.0.1',()=>console.log('Gallery browser fixture: http://127.0.0.1:27869/?case=clone'));
