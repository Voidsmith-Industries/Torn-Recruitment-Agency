// Complaint (4): the app is hard to open and its launcher/overlays get in the way of Torn.
// These browser checks pin the launcher placement, the close paths and the absence of
// invisible click blockers on desktop and mobile widths.
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
const DESKTOP = {width:1440,height:900};
const MOBILE = {width:390,height:844,isMobile:true,deviceScaleFactor:1};

function chromePath(){
  for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){
    try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
  }
  throw new Error('No Chrome/Chromium executable found.');
}

// Torn-like host: optional header status icons, optional sidebar "Information" block and a chat
// dock (desktop: open chat window at bottom-right; mobile: full-width bottom chat bar).
function hostHtml(variant){
  const header = variant.header ? `<div id="header-root" style="height:40px;background:#333;display:flex;align-items:center;justify-content:flex-end;padding:0 10px"><ul class="status-icons___gPkXF" style="display:flex;gap:4px;list-style:none;margin:0;padding:0"><li><a href="#" class="torn-icon" style="display:block;width:17px;height:17px;background:#6a6"></a></li></ul></div>` : '';
  const sidebar = variant.sidebar ? `<div id="sidebarroot" style="width:170px;float:left"><section><h2>Information</h2><div><a href="#">Money</a> <a href="#">Points</a></div></section></div>` : '';
  const chat = variant.mobile
    ? `<div id="chatRoot" style="position:fixed;left:0;right:0;bottom:0;height:48px;background:#222;display:flex;justify-content:space-around;align-items:center;z-index:9000"><button class="torn-chat">Chat</button><button class="torn-chat">People</button><button class="torn-chat">Settings</button></div>`
    : `<div id="chatRoot"><div style="position:fixed;right:0;bottom:39px;width:290px;height:380px;background:#2b2b2b;z-index:9000"><textarea class="torn-chat" style="position:absolute;left:6px;right:6px;bottom:6px;height:30px"></textarea><button class="torn-chat" style="position:absolute;right:8px;bottom:62px">Send</button><button class="torn-chat" style="position:absolute;right:8px;bottom:96px;width:60px;height:40px">Older</button></div><div style="position:fixed;right:0;bottom:0;height:39px;width:290px;background:#222;display:flex;gap:6px;justify-content:flex-end;align-items:center;z-index:9000"><button class="torn-chat">Fac</button><button class="torn-chat">Co</button></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#202020;color:#fff;font-family:Arial}</style></head><body>${header}${sidebar}<div class="content-wrapper" style="height:2000px"><button id="torn-btn">Torn button</button><input id="torn-input"></div>${chat}<script>window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;</script></body></html>`;
}

async function withPage(variant, viewport, fn){
  const server = http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(hostHtml(variant));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.php`,{waitUntil:'load'});
    if(variant.beforeBoot) await page.evaluate(variant.beforeBoot);
    for(const file of MODULES) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
    await page.addScriptTag({content:sourceCompatibleBoot(ROOT)});
    await page.waitForFunction(()=>window.RA_V45App?._test?.state?.mounted===true && !!document.getElementById('ra-app'),{timeout:15000});
    await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
    await fn(page);
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

const shown = (page, selector) => page.evaluate(sel=>{const el=document.querySelector(sel);if(!el)return false;const cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;},selector);
const appOpen = page => page.$eval('#ra-app',el=>getComputedStyle(el).display!=='none');

async function physicalClick(page, selector){
  const p = await page.$eval(selector,el=>{const r=el.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return{x,y,ok:hit===el||!!(hit&&el.contains(hit)),hit:hit&&(hit.id||hit.className||hit.tagName)};});
  assert.equal(p.ok,true,`${selector} is not physically clickable (hit ${p.hit})`);
  await page.mouse.click(p.x,p.y);
}

// Every Torn control on the page must receive its own click (no RA element on top of it).
function coveredTornControls(page){
  return page.evaluate(()=>[...document.querySelectorAll('.torn-chat,.torn-icon,#torn-btn,#torn-input,#sidebarroot a')].filter(el=>{
    const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;
    return [[r.left+r.width/2,r.top+r.height/2],[r.left+2,r.top+2],[r.right-2,r.bottom-2]].some(([x,y])=>{const hit=document.elementFromPoint(x,y);return hit&&hit!==el&&!el.contains(hit)&&!!hit.closest('[id^="ra-"]');});
  }).map(el=>el.textContent||el.className||el.id));
}

// Sample the viewport for any RA node that would intercept a click when the app is closed.
function raHitTargets(page){
  return page.evaluate(()=>{const out=new Set();for(let x=4;x<innerWidth;x+=24)for(let y=4;y<innerHeight;y+=24){const hit=document.elementFromPoint(x,y);const ra=hit&&hit.closest('[id^="ra-"]');if(ra)out.add(ra.id);}return [...out];});
}

test('desktop: launcher lives in the Torn header status icons and toggles the app', {timeout:90000}, async()=>{
  await withPage({header:true}, DESKTOP, async page=>{
    await page.waitForFunction(()=>!!document.querySelector('ul[class*="status-icons"] #ra-status-launcher button'),{timeout:5000});
    assert.equal(await shown(page,'#ra-status-launcher button'),true,'header launcher must be visible');
    assert.equal(await shown(page,'#ra-launch'),false,'floating fallback must stay hidden when Torn header entry exists');
    assert.deepEqual(await coveredTornControls(page),[]);
    assert.deepEqual((await raHitTargets(page)).filter(id=>id!=='ra-status-launcher'),[],'nothing but the header icon may take clicks');
    await physicalClick(page,'#ra-status-launcher button');
    assert.equal(await appOpen(page),true,'header launcher opens the app');
    await physicalClick(page,'#ra-status-launcher button');
    assert.equal(await appOpen(page),false,'header launcher toggles the app closed');
  });
});

test('desktop without Torn chrome: fallback launcher does not cover the Torn chat dock and hides while open', {timeout:90000}, async()=>{
  await withPage({}, DESKTOP, async page=>{
    assert.equal(await shown(page,'#ra-launch'),true,'fallback launcher must exist when no Torn entry exists');
    assert.deepEqual(await coveredTornControls(page),[],'fallback launcher must not cover Torn chat controls');
    const r = await page.$eval('#ra-launch',el=>{const b=el.getBoundingClientRect();return{w:b.width,h:b.height};});
    assert.ok(r.w*r.h<=40*48,`fallback launcher should be small, got ${r.w}x${r.h}`);
    await physicalClick(page,'#ra-launch');
    assert.equal(await appOpen(page),true);
    assert.equal(await shown(page,'#ra-launch'),false,'fallback launcher must not float over the open app');
    await physicalClick(page,'#ra-close');
    assert.equal(await appOpen(page),false);
    assert.equal(await shown(page,'#ra-launch'),true,'fallback launcher returns after closing');
  });
});

test('mobile: header launcher is used and nothing of RA floats over Torn content or the bottom chat bar', {timeout:90000}, async()=>{
  await withPage({header:true,mobile:true}, MOBILE, async page=>{
    await page.waitForFunction(()=>!!document.querySelector('#ra-status-launcher button'),{timeout:5000});
    assert.equal(await shown(page,'#ra-launch'),false);
    assert.deepEqual(await coveredTornControls(page),[]);
    assert.deepEqual((await raHitTargets(page)).filter(id=>id!=='ra-status-launcher'),[]);
    await physicalClick(page,'#ra-status-launcher button');
    assert.equal(await appOpen(page),true);
    await physicalClick(page,'#ra-close');
    assert.equal(await appOpen(page),false);
    assert.deepEqual((await raHitTargets(page)).filter(id=>id!=='ra-status-launcher'),[]);
  });
});

test('mobile without Torn chrome: fallback does not cover the bottom chat bar or float over the open app', {timeout:90000}, async()=>{
  await withPage({mobile:true}, MOBILE, async page=>{
    assert.equal(await shown(page,'#ra-launch'),true);
    assert.deepEqual(await coveredTornControls(page),[]);
    await physicalClick(page,'#ra-launch');
    assert.equal(await appOpen(page),true);
    assert.equal(await shown(page,'#ra-launch'),false);
  });
});

test('Escape closes inner popovers first, then the app; it never fires while the app is closed', {timeout:90000}, async()=>{
  await withPage({header:true}, DESKTOP, async page=>{
    await page.waitForSelector('#ra-status-launcher button');
    await physicalClick(page,'#ra-status-launcher button');
    await physicalClick(page,'#ra-settings-button');
    await page.waitForSelector('#ra-app .ra-help',{visible:true,timeout:5000});
    await page.$eval('#ra-app .ra-help',el=>el.scrollIntoView({block:'center'}));
    await physicalClick(page,'#ra-app .ra-help');
    assert.equal(await shown(page,'#ra-help-popover'),true,'help pinned');
    await page.keyboard.press('Escape');
    assert.equal(await shown(page,'#ra-help-popover'),false,'first Escape closes the pinned help');
    assert.equal(await appOpen(page),true,'first Escape keeps the app open');
    await page.keyboard.press('Escape');
    assert.equal(await appOpen(page),false,'second Escape closes the app');
    // Escape typed into a Torn field while closed must not reopen anything.
    await page.focus('#torn-input');
    await page.keyboard.press('Escape');
    assert.equal(await appOpen(page),false);
  });
});

test('closing the app clears pinned help, context menu and hover so no invisible RA layer intercepts Torn clicks', {timeout:90000}, async()=>{
  await withPage({header:true}, DESKTOP, async page=>{
    await page.waitForSelector('#ra-status-launcher button');
    await physicalClick(page,'#ra-status-launcher button');
    await physicalClick(page,'#ra-settings-button');
    await page.waitForSelector('#ra-app .ra-help',{visible:true,timeout:5000});
    await page.$eval('#ra-app .ra-help',el=>el.scrollIntoView({block:'center'}));
    await physicalClick(page,'#ra-app .ra-help');
    assert.equal(await shown(page,'#ra-help-popover'),true);
    await page.evaluate(()=>{for(const id of ['ra-context','ra-hover']){const el=document.getElementById(id);el.textContent='x';el.style.left='600px';el.style.top='400px';el.hidden=false;}});
    await physicalClick(page,'#ra-close');
    assert.equal(await appOpen(page),false);
    for(const id of ['#ra-help-popover','#ra-context','#ra-hover']) assert.equal(await shown(page,id),false,`${id} must close with the app`);
    assert.deepEqual((await raHitTargets(page)).filter(id=>id!=='ra-status-launcher'),[],'no RA layer may intercept clicks after closing');
  });
});

test('disabling the launcher setting hides only the floating button, never the Torn header entry', {timeout:90000}, async()=>{
  await withPage({header:true}, DESKTOP, async page=>{
    await page.waitForSelector('#ra-status-launcher button');
    await page.evaluate(()=>{RA_V45App._test.state.settings.launcherEnabled=false;});
    // A Torn re-render triggers the launcher sync; the header icon must remain reachable.
    await page.evaluate(()=>document.body.appendChild(document.createElement('div')));
    await page.evaluate(()=>new Promise(r=>setTimeout(r,800)));
    assert.equal(await shown(page,'#ra-status-launcher button'),true,'header icon must stay so the app can always be opened');
    assert.equal(await shown(page,'#ra-launch'),false);
  });
});

test('header launcher is re-attached when Torn replaces its header', {timeout:90000}, async()=>{
  await withPage({header:true}, DESKTOP, async page=>{
    await page.waitForSelector('#ra-status-launcher button');
    await page.evaluate(()=>{const old=document.querySelector('ul[class*="status-icons"]');const fresh=document.createElement('ul');fresh.className='status-icons___new';old.replaceWith(fresh);});
    await page.waitForFunction(()=>!!document.querySelector('ul.status-icons___new #ra-status-launcher button'),{timeout:3000});
    assert.equal(await shown(page,'#ra-launch'),false);
  });
});

test('Torn DOM churn does not trigger a full-document launcher scan per mutation', {timeout:90000}, async()=>{
  await withPage({beforeBoot:()=>{
    window.__raScans=0;
    const native=Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll=function(sel){if(sel==='h1,h2,h3,h4,h5,h6,div,span')window.__raScans++;return native.call(this,sel);};
  }}, DESKTOP, async page=>{
    await page.evaluate(()=>{window.__raScans=0;});
    await page.evaluate(async()=>{const box=document.querySelector('.content-wrapper');for(let i=0;i<200;i++){box.appendChild(document.createElement('span'));await new Promise(r=>setTimeout(r,2));}});
    await page.evaluate(()=>new Promise(r=>setTimeout(r,800)));
    const scans = await page.evaluate(()=>window.__raScans);
    assert.ok(scans<=5,`expected throttled launcher scans, got ${scans}`);
  });
});
