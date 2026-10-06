const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

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
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#202020;color:#fff;font-family:Arial}.content{padding:20px}</style></head><body><div class="content"><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></div><script>
        window.__blockedClicks=0;
        document.addEventListener('click',event=>{
          if(event.target && event.target.closest && event.target.closest('#ra-app')){
            window.__blockedClicks++;
            event.stopImmediatePropagation();
          }
        },true);
        window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;
      </script></body></html>`);
      return;
    }
    res.writeHead(404);res.end();
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}

async function physicalClick(page,selector){
  await page.waitForSelector(selector,{visible:true});
  const point=await page.$eval(selector,el=>{el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.mouse.click(point.x,point.y);
}

test('primary navigation and in-page controls survive a hostile document-capture click blocker',{timeout:60000},async()=>{
  const server=await serve();
  const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1440,height:900});
    await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'load'});

    for(const file of MODULES){
      await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
    }
    await page.addScriptTag({content:sourceCompatibleBoot(ROOT)});
    await page.waitForFunction(()=>{
      if(!document.getElementById('ra-app')) return false;
      return ['#ra-sidebar-launcher','#ra-launch'].some(s=>{
        const e=document.querySelector(s);
        return e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
      });
    },{timeout:5000});

    const launcher=await page.evaluate(()=>['#ra-sidebar-launcher','#ra-launch'].find(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'})||'');
    assert.ok(launcher,'visible launcher should exist');
    await physicalClick(page,launcher);
    assert.equal(await page.$eval('#ra-app',e=>getComputedStyle(e).display),'block');

    await physicalClick(page,'[data-page="company-candidates"]');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Company Candidates',{timeout:5000});
    await page.waitForSelector('#ra-company-filter-search',{visible:true});
    await physicalClick(page,'#ra-company-search-apply');
    assert.equal(await page.$eval('#ra-page-title',e=>e.textContent),'Company Candidates','core Company search control must not change route');

    await physicalClick(page,'#ra-workspace-toggle');
    await physicalClick(page,'[data-workspace-domain="faction"]');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Faction Candidates',{timeout:5000});
    await page.waitForSelector('#ra-faction-filter-search',{visible:true});
    await physicalClick(page,'#ra-faction-search-apply');
    assert.equal(await page.$eval('#ra-page-title',e=>e.textContent),'Faction Candidates','core Faction search control must survive capture blocker');

    await physicalClick(page,'#ra-settings-button');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Settings',{timeout:5000});
    await physicalClick(page,'#ra-close');
    assert.equal(await page.$eval('#ra-app',e=>getComputedStyle(e).display),'none');

    assert.equal(await page.evaluate(()=>window.__blockedClicks),0,'window capture shield should handle RA actions before document capture blocker');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});