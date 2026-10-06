const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

function tick(ms=30){return new Promise(resolve=>setTimeout(resolve,ms));}
class ResizeObserverStub{observe(){}unobserve(){}disconnect(){}}

function installDom(){
  const dom=new JSDOM('<!doctype html><html><head></head><body><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></body></html>',{url:'https://www.torn.com/index.php',pretendToBeVisual:true});
  Object.defineProperty(dom.window.document,'readyState',{value:'complete',configurable:true});
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async()=>{}},configurable:true});
  global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.location=dom.window.location;
  global.MutationObserver=dom.window.MutationObserver;global.HTMLElement=dom.window.HTMLElement;global.Node=dom.window.Node;global.ResizeObserver=ResizeObserverStub;
  global.indexedDB=indexedDB;global.IDBKeyRange=IDBKeyRange;global.innerWidth=1440;global.innerHeight=900;global.confirm=()=>true;global.prompt=()=>'';global.alert=()=>{};global.open=()=>null;
  dom.window.ResizeObserver=ResizeObserverStub;dom.window.confirm=global.confirm;dom.window.prompt=global.prompt;dom.window.alert=global.alert;dom.window.open=global.open;
  return dom;
}

function freshApp(){const path=require.resolve('../src/v45-app');delete require.cache[path];return require('../src/v45-app');}
function deleteDb(){return new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase('tornWorkerDB');req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);req.onblocked=()=>resolve();});}
async function readMeta(db){return new Promise((resolve,reject)=>{const q=db.transaction('meta','readonly').objectStore('meta').get('global');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}

test('real app upgrades to DB15, exposes Faction repositories, renders Faction routes and restores them after reload',async()=>{
  await deleteDb();
  const dom1=installDom();
  const App1=freshApp();
  assert.equal(await App1.start({indexedDB}),true);
  assert.equal(App1._test.state.db.version,15);
  for(const store of ['playerIntelligence','companyRecruitment','factionRecruitment','companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions'])assert.equal(App1._test.state.db.objectStoreNames.contains(store),true,store);
  assert.ok(App1._test.factionRepositories);
  assert.equal(typeof App1._test.factionRepositories.config.get,'function');

  const workspace=document.getElementById('ra-workspace-toggle');
  workspace.click();
  document.querySelector('[data-workspace-domain="faction"]').click();
  await tick(80);
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  let meta=await readMeta(App1._test.state.db);
  assert.equal(meta.settings.activePage,'faction-candidates');
  App1._test.state.db.close();
  dom1.window.close();

  const dom2=installDom();
  const App2=freshApp();
  assert.equal(await App2.start({indexedDB}),true);
  await tick();
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  meta=await readMeta(App2._test.state.db);
  assert.equal(meta.settings.activePage,'faction-candidates');
  assert.equal(document.getElementById('ra-workspace-label').textContent,'Faction');
  App2._test.state.db.close();
  dom2.window.close();
  await deleteDb();
});
