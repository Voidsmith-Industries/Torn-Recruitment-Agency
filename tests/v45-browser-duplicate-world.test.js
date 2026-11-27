const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

const ROOT = path.join(__dirname, '..');
const MODULES = ['scout-core.js','results-core.js','global-core.js','match-core.js','forum-core.js','v45-runtime.js','v45-candidates.js','v45-discovery.js','v45-messaging.js','v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-platform.js','v45-app.js'];
const BOOT = sourceCompatibleBoot(ROOT);
const SOURCE_VERSION = fs.readFileSync(path.join(ROOT,'src','v45-app.js'),'utf8').match(/SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1];
assert.ok(SOURCE_VERSION,'local source runtime must declare SCRIPT_VERSION');

function chromePath(){for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}}throw new Error('No Chrome/Chromium executable found.');}
function serve(){const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><html><head><meta charset="utf-8"><style id="ra-styles">.ra-btn{pointer-events:auto}</style></head><body><div id="ra-panel"></div><div id="ra-results-panel"></div><div id="ra-config-modal"></div><div id="ra-dock-fallback"></div><div id="ra-launcher"></div><div class="ra-dock-icon"></div><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></body></html>`)});return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));}
async function isolatedEval(client,contextId,expression,awaitPromise=false){const out=await client.send('Runtime.evaluate',{contextId,expression,awaitPromise,returnByValue:true});if(out.exceptionDetails)throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text);return out.result.value;}
async function prepareWorld(client,contextId){await isolatedEval(client,contextId,`globalThis.alert=()=>{};globalThis.confirm=()=>true;globalThis.prompt=()=>'';globalThis.open=()=>null;globalThis.__errors=[];globalThis.addEventListener('error',e=>__errors.push(String(e.error||e.message)));globalThis.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason||'rejection')));`);for(const file of MODULES){await isolatedEval(client,contextId,fs.readFileSync(path.join(ROOT,'src',file),'utf8'));}assert.equal(await isolatedEval(client,contextId,`typeof RA_V45App`),'object');}

test('DOM singleton prevents duplicate source-compatible mounts across isolated userscript worlds and clears legacy UI',{timeout:60000},async()=>{
  const server=await serve();const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();await page.setViewport({width:421,height:850});await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'load'});
    const client=await page.target().createCDPSession();await client.send('Page.enable');await client.send('Runtime.enable');const tree=await client.send('Page.getFrameTree');const frameId=tree.frameTree.frame.id;
    const a=(await client.send('Page.createIsolatedWorld',{frameId,worldName:'tampermonkey-ra-a',grantUniveralAccess:true})).executionContextId;
    const b=(await client.send('Page.createIsolatedWorld',{frameId,worldName:'tampermonkey-ra-b',grantUniveralAccess:true})).executionContextId;
    await prepareWorld(client,a);await prepareWorld(client,b);

    await isolatedEval(client,a,BOOT);
    await isolatedEval(client,b,BOOT);
    await page.waitForFunction(()=>document.querySelectorAll('#ra-launch').length===1,{timeout:10000});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#ra-sidebar-launcher')||document.querySelector('#ra-launch')).display!=='none',{timeout:10000});
    assert.equal(await page.evaluate(()=>document.querySelectorAll('#ra-launch').length),1,'only one launcher may mount');
    await page.evaluate(()=>(document.querySelector('#ra-sidebar-launcher')||document.querySelector('#ra-launch')).click());
    await page.waitForFunction(()=>document.querySelectorAll('#ra-app').length===1,{timeout:10000});

    assert.equal(await page.evaluate(()=>document.querySelectorAll('#ra-app').length),1,'only one app shell may mount');
    assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-r4g3-ra-v45-owner')),SOURCE_VERSION);
    for(const id of ['ra-styles','ra-panel','ra-results-panel','ra-config-modal','ra-dock-fallback','ra-launcher']) assert.equal(await page.$(`#${id}`),null,`legacy ${id} should be removed`);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.ra-dock-icon').length),0,'legacy dock icons should be removed');
    assert.deepEqual(await isolatedEval(client,a,`__errors`),[]);
    assert.deepEqual(await isolatedEval(client,b,`__errors`),[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});