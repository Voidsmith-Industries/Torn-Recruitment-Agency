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
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#202020;color:#fff;font-family:Arial}</style></head><body><ul class="status-icons"></ul><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section><script>
      window.__blockedClicks=0;
      document.addEventListener('click',event=>{
        if(event.target && event.target.closest && event.target.closest('#ra-app')){
          window.__blockedClicks++;
          event.stopImmediatePropagation();
        }
      },true);
      window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;
    </script></body></html>`);
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}

async function physicalClick(page,selector){
  await page.waitForSelector(selector,{visible:true});
  const point=await page.$eval(selector,el=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  const hit=await page.evaluate(({x,y,selector})=>{
    const found=document.elementFromPoint(x,y);
    return !!(found && (found.matches(selector)||found.closest(selector)));
  },{...point,selector});
  assert.equal(hit,true,`${selector} must be physically hittable`);
  await page.mouse.click(point.x,point.y);
}

function closeTo(actual,expected,tolerance=1.1){return Math.abs(Number(actual)-Number(expected))<=tolerance;}
function clampGeometry(g,width,height){
  const maxWidth=Math.max(0,width-8),maxHeight=Math.max(0,height-8);
  const minWidth=Math.min(560,maxWidth),minHeight=Math.min(420,maxHeight);
  const w=Math.max(minWidth,Math.min(Number(g.width)||900,maxWidth));
  const h=Math.max(minHeight,Math.min(Number(g.height)||650,maxHeight));
  return {
    x:Math.max(4,Math.min(Number(g.x)||20,Math.max(4,width-w-4))),
    y:Math.max(4,Math.min(Number(g.y)||50,Math.max(4,height-h-4))),
    width:w,height:h
  };
}

async function readPersistedGeometry(page){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    try{
      const db=window.RA_V45App?._test?.state?.db;
      if(!db)return reject(new Error('RA database unavailable'));
      const request=db.transaction('meta','readonly').objectStore('meta').get('global');
      request.onsuccess=()=>resolve(request.result?.ui?.windowGeometry?.main||null);
      request.onerror=()=>reject(request.error||new Error('geometry read failed'));
    }catch(error){reject(error);}
  }));
}

test('v4.5.4 shell scrolls, hides duplicate Settings and safely maximizes/restores',{timeout:60000},async()=>{
  const server=await serve();
  const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1440,height:900});
    await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'load'});

    for(const file of MODULES) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
    await page.addScriptTag({content:sourceCompatibleBoot(ROOT)});

    await page.waitForSelector('#ra-maximize',{timeout:10000});
    await page.waitForFunction(()=>!document.querySelector('#ra-nav [data-page="settings"]'),{timeout:5000});
    assert.equal(await page.$('[data-page="settings"]'),null,'Settings must not be duplicated in sidebar navigation');
    assert.ok(await page.$('#ra-settings-button'),'title-bar Settings must remain');

    const launcher=await page.evaluate(()=>['#ra-status-launcher button'].find(selector=>{const el=document.querySelector(selector);return el&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'})||'');
    assert.ok(launcher,'visible launcher should exist');
    await physicalClick(page,launcher);
    assert.equal(await page.$eval('#ra-app',el=>getComputedStyle(el).display),'block');

    await physicalClick(page,'#ra-settings-button');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Settings',{timeout:5000});
    await page.waitForFunction(()=>!document.querySelector('#ra-nav [data-page="settings"]'),{timeout:5000});

    const scroll=await page.$eval('#ra-content',el=>{
      const probe=document.createElement('div');
      probe.id='ra-scroll-probe';
      probe.style.height='2400px';
      probe.textContent='scroll probe';
      el.appendChild(probe);
      const before={clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflowY:getComputedStyle(el).overflowY};
      el.scrollTop=el.scrollHeight;
      return {...before,scrollTop:el.scrollTop};
    });
    assert.ok(scroll.scrollHeight>scroll.clientHeight,'routed content should overflow its own viewport');
    assert.ok(scroll.scrollTop>0,'routed content should scroll to the bottom');
    assert.ok(['auto','scroll'].includes(scroll.overflowY),'routed content owns vertical scrolling');

    await page.$eval('#ra-content',el=>{el.scrollTop=0;document.getElementById('ra-scroll-probe')?.remove();});
    await new Promise(resolve=>setTimeout(resolve,450));
    const normal=await page.$eval('#ra-app',el=>{const r=el.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,leftStyle:el.style.left,topStyle:el.style.top};});
    const beforePersist=await readPersistedGeometry(page);
    assert.ok(beforePersist,'normal geometry should be persisted before maximize');

    await physicalClick(page,'#ra-maximize');
    await page.waitForFunction(()=>document.getElementById('ra-app')?.classList.contains('ra-maximized'),{timeout:5000});
    assert.equal(await page.evaluate(()=>window.__blockedClicks),0,'Maximize should execute before hostile document capture');
    const maximized=await page.$eval('#ra-app',el=>{const r=el.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,resize:getComputedStyle(el).resize,radius:getComputedStyle(el).borderRadius};});
    assert.ok(closeTo(maximized.x,0));assert.ok(closeTo(maximized.y,0));
    assert.ok(closeTo(maximized.width,1440));assert.ok(closeTo(maximized.height,900));
    assert.equal(maximized.resize,'none');
    assert.equal(await page.$eval('#ra-maximize',el=>el.textContent),'Restore');
    assert.equal(await page.$eval('#ra-maximize',el=>el.getAttribute('aria-label')),'Restore');

    const titlePoint=await page.$eval('#ra-titlebar',el=>{const r=el.getBoundingClientRect();return{x:r.left+Math.min(220,r.width/3),y:r.top+r.height/2};});
    await page.mouse.move(titlePoint.x,titlePoint.y);await page.mouse.down();await page.mouse.move(260,160,{steps:4});await page.mouse.up();
    const afterDrag=await page.$eval('#ra-app',el=>({left:el.style.left,top:el.style.top}));
    assert.equal(afterDrag.left,normal.leftStyle,'maximized titlebar drag must not alter inline left');
    assert.equal(afterDrag.top,normal.topStyle,'maximized titlebar drag must not alter inline top');

    await new Promise(resolve=>setTimeout(resolve,500));
    const duringPersist=await readPersistedGeometry(page);
    for(const key of ['x','y','width','height']) assert.ok(closeTo(duringPersist[key],normal[key],1.5),`maximized state must not persist ${key}`);

    // A mouse drag can synthesize a non-action click on the titlebar. The input shield
    // deliberately protects actionable controls, not inert titlebar clicks, so reset the
    // hostile-capture counter before validating the Restore control itself.
    await page.evaluate(()=>{window.__blockedClicks=0;});

    await page.setViewport({width:1280,height:720});
    await page.waitForFunction(()=>{const r=document.getElementById('ra-app')?.getBoundingClientRect();return r&&Math.abs(r.width-innerWidth)<1.1&&Math.abs(r.height-innerHeight)<1.1;},{timeout:5000});
    const resizedMax=await page.$eval('#ra-app',el=>{const r=el.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height};});
    assert.ok(closeTo(resizedMax.x,0));assert.ok(closeTo(resizedMax.y,0));
    assert.ok(closeTo(resizedMax.width,1280));assert.ok(closeTo(resizedMax.height,720));

    const expected=clampGeometry(normal,1280,720);
    await physicalClick(page,'#ra-maximize');
    await page.waitForFunction(()=>!document.getElementById('ra-app')?.classList.contains('ra-maximized'),{timeout:5000});
    assert.equal(await page.evaluate(()=>window.__blockedClicks),0,'Restore should execute before hostile document capture');
    const restored=await page.$eval('#ra-app',el=>{const r=el.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,resize:getComputedStyle(el).resize};});
    for(const key of ['x','y','width','height']) assert.ok(closeTo(restored[key],expected[key],1.5),`restored ${key} should match clamped normal geometry`);
    assert.notEqual(restored.resize,'none','manual resize should return after restore');
    assert.equal(await page.$eval('#ra-maximize',el=>el.textContent),'Maximize');

    await page.waitForFunction(expected=>new Promise(resolve=>{
      const db=window.RA_V45App?._test?.state?.db;
      if(!db)return resolve(false);
      const request=db.transaction('meta','readonly').objectStore('meta').get('global');
      request.onsuccess=()=>{const g=request.result?.ui?.windowGeometry?.main;resolve(!!g&&['x','y','width','height'].every(k=>Math.abs(Number(g[k])-Number(expected[k]))<=1.5));};
      request.onerror=()=>resolve(false);
    }),{timeout:5000},expected);
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
