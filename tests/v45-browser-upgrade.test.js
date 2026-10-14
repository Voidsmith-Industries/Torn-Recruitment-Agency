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
const BOOT = sourceCompatibleBoot(ROOT);

function chromePath(){for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}}throw new Error('No Chrome/Chromium executable found.');}
function htmlShell(extra=''){return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#202020;color:#fff;font-family:Arial}.torn-content{padding:20px}</style></head><body><ul class="status-icons"></ul><div class="torn-content"><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></div>${extra}</body></html>`;}
function serve(){const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/seed'){res.writeHead(200,{'content-type':'text/html'});res.end(htmlShell(`<script>
(async()=>{try{
 const req=indexedDB.open('tornWorkerDB',11);
 req.onupgradeneeded=e=>{const d=e.target.result;
  d.createObjectStore('users',{keyPath:'recordId'});d.createObjectStore('meta',{keyPath:'key'});d.createObjectStore('scoutLatest',{keyPath:'userId'});
  let s=d.createObjectStore('scoutHistory',{keyPath:'snapshotId'});s.createIndex('userId','userId',{unique:false});s.createIndex('capturedAt','capturedAt',{unique:false});
  d.createObjectStore('globalLatest',{keyPath:'userId'});s=d.createObjectStore('globalHistory',{keyPath:'snapshotId'});s.createIndex('userId','userId',{unique:false});s.createIndex('observedAt','observedAt',{unique:false});
  d.createObjectStore('globalSyncQueue',{keyPath:'queueId'});d.createObjectStore('candidateLocal',{keyPath:'userId'});d.createObjectStore('matchProfiles',{keyPath:'profileId'});
 };
 req.onerror=()=>{window.__seedError=String(req.error);window.__seedDone=true};
 req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['meta','candidateLocal','users'],'readwrite');
  tx.objectStore('meta').put({key:'global',settings:{theme:'dark',density:'comfortable',complexity:'simple',dockEnabled:true,includeInactive:false,activeMode:'company',apiKey:'',forumScope:'thread',forumDays:30,forumEnrich:false,view:'table',resultSort:'fit',resultsByMode:{company:{sort:{key:'fit',direction:'desc'},filters:{},visibleColumns:['player','fit','trend','level']},faction:{sort:{key:'fit',direction:'desc'},filters:{},visibleColumns:['player','fit']},scout:{sort:{key:'fit',direction:'desc'},filters:{},visibleColumns:['player','fit']}},resultsPanels:{filtersOpen:false,columnsOpen:false},global:{enabled:false,endpoint:'',lookupCacheMs:1800000,maxRetryAttempts:5},match:{activeProfileId:''},scout:{rate:75,workers:3,budget:900,historyGapMs:0,maxCandidates:60}},syncHistory:{},ui:{windowGeometry:{main:{x:120,y:80,width:980,height:680}}}});
  tx.objectStore('candidateLocal').put({userId:'3877028',pipelineStage:'Not Contacted',availability:'Unknown',desiredCompany:'Adult Novelties',desiredRole:'',expectedSalary:null,recruiterNote:'legacy candidate'});
  tx.objectStore('users').put({recordId:'company:3877028',userId:3877028,name:'Legacy Candidate',mode:'company',postText:'Looking for AN',postDate:Date.now()-10000,threadId:'15907925'});
  tx.oncomplete=()=>{db.close();window.__seedDone=true};tx.onerror=()=>{window.__seedError=String(tx.error);window.__seedDone=true};
 };
}catch(e){window.__seedError=String(e&&e.stack||e);window.__seedDone=true}})();
</script>`));return;}
 if(url.pathname==='/'){const scripts=MODULES.map(f=>`<script src="/src/${f}"></script>`).join('');res.writeHead(200,{'content-type':'text/html'});res.end(htmlShell(`${scripts}<script>
 window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;window.__startupError='';
 window.addEventListener('error',e=>window.__startupError+=String(e.error||e.message)+'\\n');window.addEventListener('unhandledrejection',e=>window.__startupError+=String(e.reason||'rejection')+'\\n');
</script>`));return;}
 if(url.pathname.startsWith('/src/')){const file=path.basename(url.pathname);if(!MODULES.includes(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'application/javascript'});res.end(fs.readFileSync(path.join(ROOT,'src',file)));return;}res.writeHead(404);res.end();});return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));}
async function physicalClick(page,selector){await page.waitForSelector(selector,{visible:true});const p=await page.$eval(selector,el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,hit:hit&&(hit.id||hit.tagName),ok:hit===el||!!(hit&&el.contains(hit))}});assert.equal(p.ok,true,`${selector} covered by ${p.hit}`);await page.mouse.click(p.x,p.y);}

test('v4.4 persisted DB11 upgrades through additive DB15 via the public v4.7.2 bootstrap and remains physically routable in Chrome',{timeout:60000},async()=>{const server=await serve();const port=server.address().port;const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});try{const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto(`http://127.0.0.1:${port}/seed`);await page.waitForFunction(()=>window.__seedDone===true);assert.equal(await page.evaluate(()=>window.__seedError||''),'');await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle0'});await page.addScriptTag({content:BOOT});await page.waitForFunction(()=>document.getElementById('ra-app')&&['#ra-status-launcher button'].some(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'}),{timeout:15000});assert.equal(await page.evaluate(()=>window.__startupError),'');
 const dbVersion=await page.evaluate(()=>RA_V45App.DB_VERSION);assert.equal(dbVersion,15);
 const db15Probe=await page.evaluate(async()=>{const companyConfig=await RA_V45App._test.companyRepositories.config.get();const vacancy=await RA_V45App._test.companyRepositories.vacancies.save({id:'db15-probe',name:'DB15 Probe',status:'Draft'});const listed=await RA_V45App._test.companyRepositories.vacancies.list();const factionConfig=await RA_V45App._test.factionRepositories.config.get();return{companyConfigKey:companyConfig.key,factionConfigKey:factionConfig.key,vacancyId:vacancy.vacancyId,listed:listed.some(v=>v.vacancyId==='db15-probe')};});assert.deepEqual(db15Probe,{companyConfigKey:'company',factionConfigKey:'faction',vacancyId:'db15-probe',listed:true});
 const launcher=await page.evaluate(()=>['#ra-status-launcher button'].find(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'})||'');assert.ok(launcher);await physicalClick(page,launcher);await physicalClick(page,'[data-page="company-candidates"]');await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Company Candidates',{timeout:10000});assert.equal(await page.$eval('#ra-page-title',e=>e.textContent),'Company Candidates');assert.equal(await page.evaluate(()=>window.__startupError),'');
}finally{await browser.close();await new Promise(r=>server.close(r));}});
