// Owner request: Recruitment Agency docks on Torn's sidebar directly underneath ReviveRelay, takes ReviveRelay's
// slot when RR is absent, and shares the Voidsmith dock stack (contract v1, docs/voidsmith-dock.md).
// RR cases run a faithful stub of ReviveRelay 1.0.5's docking by default (RR's source is not part of this public repo);
// set RR_USERSCRIPT=/path/to/reviverelay.user.js to run the same cases against the real script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

const ROOT = path.join(__dirname, '..');
const MODULES = ['scout-core.js','results-core.js','global-core.js','match-core.js','forum-core.js','v45-runtime.js','v45-candidates.js','v45-discovery.js','v45-messaging.js','v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-platform.js','v45-app.js'];
// Stub mirrors RR 1.0.5 mountDock(): host #reviverelay-lite-root (shadow row), same sidebar selector order,
// insertBefore(native[1]||native[0]||null) where native = every other sidebar child (dock entries included),
// childList observer on sidebar + parent that re-places only when the host is no longer in findSidebar().
const RR_STUB = `(()=>{const SEL=['#sidebar','#sidebarroot','nav[aria-label="Primary"]','nav[aria-label="Main"]','[role="navigation"][class*="sidebar"]','[class*="sidebar"] nav'];
const findSidebar=()=>{for(const s of SEL){const n=document.querySelector(s);if(n)return n;}return null;};
document.getElementById('reviverelay-lite-root')?.remove();
const host=document.createElement('div');host.id='reviverelay-lite-root';
host.attachShadow({mode:'closed'}).innerHTML='<style>:host{all:initial;display:block;margin:4px 0;font:700 12px/1 Arial,sans-serif;color:#ddd}button{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;box-sizing:border-box;padding:0 8px;border:1px solid #444;border-radius:5px;background:#2e2e2e;color:inherit;font:inherit;text-align:left}</style><button type="button" aria-expanded="false">ReviveRelay</button>';
let observer=null,observed=null;
function observe(sidebar){if(observed===sidebar)return;observer&&observer.disconnect();observer=null;observed=sidebar;if(!sidebar)return;observer=new MutationObserver(()=>{if(host.parentNode!==findSidebar())place();});observer.observe(sidebar,{childList:true});if(sidebar.parentNode)observer.observe(sidebar.parentNode,{childList:true});}
function place(){const target=findSidebar();if(!target)return;if(host.parentNode!==target){const native=Array.from(target.children).filter(n=>n!==host);target.insertBefore(host,native[1]||native[0]||null);}host.setAttribute('data-rr-placement','sidebar');host.setAttribute('data-theme',document.body.classList.contains('dark-mode')?'dark':'light');observe(target);}
place();})();`;
const RR_PATH = process.env.RR_USERSCRIPT || '';
const RR = RR_PATH ? fs.readFileSync(RR_PATH, 'utf8') : RR_STUB;
const RR_MODE = RR_PATH ? `real ReviveRelay (${path.basename(RR_PATH)})` : 'ReviveRelay 1.0.5 stub';
const RA = 'voidsmith-dock-recruitment-agency', RRID = 'reviverelay-lite-root';
const SHOTS = process.env.RA_DOCK_SHOTS || '';
const T = name => `${name} [${RR_MODE}]`;

function chromePath(){
  for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){
    try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
  }
  throw new Error('No Chrome/Chromium executable found.');
}

const SIDEBAR = `<div id="sidebar" class="sidebar___BizFX"><div class="toggle-block___oKpdF user-information"><h2>Information</h2><a href="#">Name: Tester [1]</a><a href="#">Money: $1,000</a></div><div class="toggle-block___oKpdF areas"><h2>Areas</h2><a href="#">Home</a><a href="#">Items</a></div><div class="toggle-block___oKpdF lists"><h2>Lists</h2><a href="#">Friends</a></div></div>`;
const html = (sidebar = SIDEBAR) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#191919;color:#ddd;font:12px Arial,sans-serif}.wrap{display:flex;gap:10px;padding:10px}#sidebarroot{width:172px;flex:0 0 172px}#sidebar>div:not([id]){background:#2b2b2b;border-radius:5px;margin-bottom:4px;padding:6px}#sidebar h2{font-size:12px;margin:0 0 4px;color:#fff}#sidebar a{display:block;color:#bbb;padding:2px 0}</style></head><body class="dark-mode"><div class="wrap"><div id="sidebarroot">${sidebar}</div><div class="content-wrapper" style="flex:1;min-height:500px"></div></div><script>window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;</script></body></html>`;
// GM stubs for ReviveRelay: no network, in-memory storage.
const GM = `(()=>{const s={};window.GM_getValue=(k,d)=>k in s?s[k]:d;window.GM_setValue=(k,v)=>{s[k]=v;};window.GM_addStyle=c=>{const e=document.createElement('style');e.textContent=c;document.head.appendChild(e);return e;};window.GM_notification=()=>{};window.GM_xmlhttpRequest=d=>{setTimeout(()=>d.onerror&&d.onerror({status:0,error:'stubbed'}),10);return{abort(){}};};window.GM_info={script:{version:'1.0.5',name:'ReviveRelay'},scriptHandler:'Tampermonkey'};})();`;

let browser;
test.before(async()=>{browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>{await browser?.close();});

async function openTorn(body){
  const page = await browser.newPage();
  await page.setViewport({width:1280,height:800});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.setRequestInterception(true);
  page.on('request', r => r.resourceType()==='document' ? r.respond({status:200,contentType:'text/html',body:html(body)}) : r.abort());
  await page.evaluateOnNewDocument(GM);
  await page.goto('https://www.torn.com/index.php', {waitUntil:'domcontentloaded'});
  return page;
}
const settle = (page, ms=150) => page.evaluate(ms=>new Promise(r=>setTimeout(r,ms)), ms);
async function loadRR(page){ await page.addScriptTag({content:RR}); await page.waitForFunction(id=>document.getElementById(id)?.getAttribute('data-rr-placement')==='sidebar',{timeout:5000},RRID); await settle(page); }
async function loadRA(page){
  for(const file of MODULES) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
  await page.addScriptTag({content:sourceCompatibleBoot(ROOT)});
  await page.waitForFunction(()=>window.RA_V45App?._test?.state?.mounted===true,{timeout:15000});
  await settle(page);
}
const order = page => page.evaluate(()=>[...document.getElementById('sidebar').children].map(c=>c.id||c.className.split(' ').pop()));
const shot = async (page, name) => { if(SHOTS) await page.screenshot({path:path.join(SHOTS,`after-${name}${RR_PATH?'-real':''}.png`),clip:{x:0,y:0,width:420,height:300}}); };

test(T('ReviveRelay first, then RA: RA docks directly below ReviveRelay as a styled sidebar row'), {timeout:90000}, async()=>{
  const page = await openTorn();
  await loadRR(page); await loadRA(page);
  assert.deepEqual((await order(page)).slice(0,4), ['user-information',RRID,RA,'areas']);
  const row = await page.evaluate(id=>{const host=document.getElementById(id),b=host.shadowRoot.querySelector('button'),r=host.getBoundingClientRect(),rr=document.getElementById('reviverelay-lite-root').getBoundingClientRect(),cs=getComputedStyle(b);return{label:b.textContent.trim(),aria:b.getAttribute('aria-label'),prio:host.getAttribute('data-voidsmith-dock-priority'),dock:host.getAttribute('data-voidsmith-dock'),theme:host.getAttribute('data-theme'),w:r.width,rrW:rr.width,h:r.height,ws:cs.whiteSpace==='nowrap'||getComputedStyle(b.lastElementChild).whiteSpace,bg:cs.backgroundColor};}, RA);
  assert.equal(row.label,'Recruitment Agency'); assert.equal(row.dock,'recruitment-agency'); assert.equal(row.prio,'20'); assert.equal(row.theme,'dark');
  assert.equal(row.w,row.rrW,'row is as wide as the ReviveRelay row'); assert.ok(row.h>=28&&row.h<=34,`row height ${row.h}`);
  assert.equal(row.bg,'rgb(46, 46, 46)','dark token matches ReviveRelay');
  assert.equal(await page.evaluate(()=>!!document.querySelector('#sidebar .user-information [id^="ra-"]')),false,'no icon inside the Information block any more');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('ra-launch')).display),'none','floating fallback hidden while the dock row is visible');
  await shot(page,'rr-then-ra');
  assert.deepEqual(page.errors,[]);
  await page.close();
});

test(T('RA first, then ReviveRelay loads: ReviveRelay ends up above RA; RA alone takes the ReviveRelay slot'), {timeout:90000}, async()=>{
  const page = await openTorn();
  await loadRA(page);
  assert.deepEqual((await order(page)).slice(0,3), ['user-information',RA,'areas'], 'RA alone sits after the first native block');
  await shot(page,'ra-alone');
  await loadRR(page);
  assert.deepEqual((await order(page)).slice(0,4), ['user-information',RRID,RA,'areas']);
  await shot(page,'ra-then-rr');
  await page.close();
});

test(T('Torn replacing #sidebar restores the order without a placement loop; foreign priority 30 lands below RA'), {timeout:90000}, async()=>{
  const page = await openTorn();
  await loadRR(page);
  // a later Voidsmith script (priority 30) already docked directly below ReviveRelay
  await page.evaluate(rr=>{const f=document.createElement('div');f.id='voidsmith-dock-property-rental-manager';f.setAttribute('data-voidsmith-dock','property-rental-manager');f.setAttribute('data-voidsmith-dock-priority','30');f.textContent='PRM';document.getElementById(rr).after(f);}, RRID);
  await loadRA(page);
  assert.deepEqual((await order(page)).slice(0,5), ['user-information',RRID,RA,'voidsmith-dock-property-rental-manager','areas']);
  await page.evaluate(()=>{window.__mut=0;new MutationObserver(r=>{window.__mut+=r.length;}).observe(document.getElementById('sidebarroot'),{childList:true,subtree:true});});
  // React re-render: a fresh #sidebar with only native blocks; the foreign entry re-docks by appending itself
  await page.evaluate(()=>{const old=document.getElementById('sidebar'),fresh=old.cloneNode(false);[...old.children].filter(n=>n.className.startsWith('toggle')).forEach(n=>fresh.appendChild(n.cloneNode(true)));old.replaceWith(fresh);const f=document.createElement('div');f.id='voidsmith-dock-property-rental-manager';f.setAttribute('data-voidsmith-dock','property-rental-manager');f.setAttribute('data-voidsmith-dock-priority','30');f.textContent='PRM';fresh.appendChild(f);});
  await settle(page,400);
  assert.deepEqual((await order(page)).slice(0,3), ['user-information',RRID,RA]);
  const ord = await order(page); assert.ok(ord.indexOf('voidsmith-dock-property-rental-manager')>ord.indexOf(RA),'foreign priority 30 stays below RA');
  const m1 = await page.evaluate(()=>window.__mut); await settle(page,1000); const m2 = await page.evaluate(()=>window.__mut);
  assert.equal(m2,m1,'sidebar mutations stop once everything is placed');
  assert.ok(m1<=12,`placement settles in a few moves, got ${m1}`);
  // Torn appending a native block does not move anything
  await page.evaluate(()=>{const d=document.createElement('div');d.className='toggle-block___x extra';document.getElementById('sidebar').appendChild(d);});
  await settle(page); assert.deepEqual((await order(page)).slice(0,3), ['user-information',RRID,RA]);
  await shot(page,'replaced');
  await page.close();
});

test(T('sidebar hydrating late inside #sidebarroot: RA moves into #sidebar'), {timeout:90000}, async()=>{
  const page = await openTorn('');
  await loadRA(page);
  await page.evaluate(s=>{document.getElementById('sidebarroot').insertAdjacentHTML('beforeend',s);}, SIDEBAR);
  await settle(page);
  assert.deepEqual((await order(page)).slice(0,3), ['user-information',RA,'areas']);
  await page.close();
});

test(T('dock row click toggles the app and keeps aria-expanded in sync'), {timeout:90000}, async()=>{
  const page = await openTorn();
  await loadRR(page); await loadRA(page);
  const aria = () => page.evaluate(id=>document.getElementById(id).shadowRoot.querySelector('button').getAttribute('aria-expanded'), RA);
  const box = await page.evaluate(id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id};}, RA);
  assert.equal(box.hit, RA, 'row is physically clickable');
  assert.equal(await aria(),'false');
  await page.mouse.click(box.x, box.y);
  await page.waitForFunction(()=>document.getElementById('ra-app')?.style.display==='block',{timeout:10000});
  assert.equal(await aria(),'true');
  await page.evaluate(()=>document.getElementById('ra-close').click());
  assert.equal(await aria(),'false');
  await page.mouse.click(box.x, box.y);
  assert.equal(await page.evaluate(()=>document.getElementById('ra-app').style.display),'block');
  assert.equal(await aria(),'true');
  assert.equal(await page.evaluate(()=>document.getElementById('reviverelay-lite-root').nextElementSibling?.id), RA, 'opening the app does not move the row');
  await page.close();
});
