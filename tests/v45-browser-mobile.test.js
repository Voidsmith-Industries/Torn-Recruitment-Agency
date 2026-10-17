const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const MODULES = ['scout-core.js','results-core.js','global-core.js','match-core.js','forum-core.js','v45-runtime.js','v45-candidates.js','v45-discovery.js','v45-messaging.js','v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-operations.js','v46-company-workflow.js','v46-company-workflow-ui.js','v46-company-opportunity-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-operations.js','v47-faction-workflow.js','v47-faction-workflow-ui.js','v47-faction-opportunity-ui.js','v47-faction-platform.js','v45-app.js'];

function chromePath(){
  for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){
    try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
  }
  throw new Error('No Chrome/Chromium executable found.');
}

function serve(){
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/'){
      const scripts=MODULES.map(f=>`<script src="/src/${f}"></script>`).join('');
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#202020;color:#fff;font-family:Arial}.content{padding:12px}</style></head><body><ul class="status-icons"></ul><div class="content"><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></div>${scripts}<script>
        window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;
        (async()=>{try{await RA_V45App.start();window.__raStarted=true}catch(e){window.__raError=String(e&&e.stack||e);window.__raStarted=false}})();
      </script></body></html>`);
      return;
    }
    if(url.pathname.startsWith('/src/')){
      const file=path.basename(url.pathname);
      if(!MODULES.includes(file)){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':'application/javascript; charset=utf-8'});
      res.end(fs.readFileSync(path.join(ROOT,'src',file)));
      return;
    }
    res.writeHead(404);res.end();
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}

async function physicalClick(page,selector){
  await page.waitForSelector(selector,{visible:true});
  await page.waitForFunction(sel=>{
    const el=document.querySelector(sel);if(!el)return false;
    el.scrollIntoView({block:'center',inline:'nearest'});
    const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return hit===el||!!(hit&&el.contains(hit));
  },{timeout:5000},selector);
  const p=await page.$eval(selector,el=>{
    const r=el.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {x,y,ok:hit===el||!!(hit&&el.contains(hit)),hit:hit&&(hit.id||hit.className||hit.tagName),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  });
  assert.equal(p.ok,true,`${selector} is not physically clickable: ${JSON.stringify(p)}`);
  await page.mouse.click(p.x,p.y);
}

test('421px mobile shell keeps hamburger sidebar open and routes Discover by physical click',{timeout:60000},async()=>{
  const server=await serve();
  const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.setViewport({width:421,height:850});
    await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>window.__raStarted===true||window.__raStarted===false);
    assert.equal(await page.evaluate(()=>window.__raError||''),'');
    assert.equal(await page.evaluate(()=>window.__raStarted),true);
    assert.equal(await page.evaluate(()=>window.innerWidth),421);

    const launcher=await page.evaluate(()=>['#ra-status-launcher button'].find(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'})||'');
    assert.ok(launcher,'visible launcher should exist');
    await physicalClick(page,launcher);
    assert.equal(await page.$eval('#ra-app',e=>getComputedStyle(e).display),'block');

    const before=await page.$eval('[data-page="company-candidates"]',e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width}});
    assert.ok(before.right<=60,`mobile nav should begin off-canvas before hamburger: ${JSON.stringify(before)}`);

    await physicalClick(page,'#ra-mobile-menu');
    await page.waitForFunction(()=>document.querySelector('.ra-shell')?.classList.contains('sidebar-open'),{timeout:5000});
    assert.equal(await page.$eval('.ra-shell',e=>e.classList.contains('sidebar-open')),true,'hamburger sidebar class must persist after transition');
    await page.waitForFunction(()=>{
      const e=document.querySelector('[data-page="company-candidates"]');if(!e)return false;
      const r=e.getBoundingClientRect();if(r.x<0||r.width<=0||r.height<=0)return false;
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return hit===e||!!(hit&&e.contains(hit));
    },{timeout:5000});

    const after=await page.$eval('[data-page="company-candidates"]',e=>{const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x:r.x,right:r.right,width:r.width,hit:hit&&(hit.id||hit.className||hit.tagName),clickable:hit===e||!!(hit&&e.contains(hit))}});
    assert.ok(after.x>=0,`Discover should be on-screen after hamburger: ${JSON.stringify(after)}`);
    assert.equal(after.clickable,true,`Discover must receive the physical click after hamburger: ${JSON.stringify(after)}`);

    await physicalClick(page,'[data-page="company-candidates"]');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Company Candidates',{timeout:5000});
    await page.waitForFunction(()=>!document.querySelector('.ra-shell')?.classList.contains('sidebar-open'),{timeout:5000});
    assert.equal(await page.$eval('.ra-shell',e=>e.classList.contains('sidebar-open')),false,'routing should close the mobile sidebar only after navigation');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
