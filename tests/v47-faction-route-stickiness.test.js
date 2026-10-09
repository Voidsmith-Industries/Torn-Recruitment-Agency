const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

function tick(ms=50){return new Promise(resolve=>setTimeout(resolve,ms));}
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
function dbGet(db,store,key){return new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);});}

async function clickFactionRoute(route){
  document.querySelector(`[data-page="${route}"]`).click();
  await tick(80);
}

test('Faction controls stay on the route the recruiter navigated to',async()=>{
  await deleteDb();
  const dom=installDom();
  const App=freshApp();
  assert.equal(await App.start({indexedDB}),true);

  await App._test.repositories.players.ensure('123',{name:'Alpha',level:75,fit:90},'route-stickiness-test',100);
  await App._test.repositories.faction.ensure('123',{pipelineStage:'Prospect',waivers:[]},{source:'route-stickiness-test',observedAt:100});

  assert.equal(App._test.state.page,'company-candidates');
  const workspace=document.getElementById('ra-workspace-toggle');
  workspace.click();
  document.querySelector('[data-workspace-domain="faction"]').click();
  await tick(120);
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  assert.equal(App._test.state.page,'faction-candidates');

  await clickFactionRoute('faction-candidates');
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  assert.equal(App._test.state.page,'faction-candidates');

  const search=document.getElementById('ra-faction-filter-search');
  assert.ok(search,'Faction Candidates should expose the core search input');
  search.value='Alpha';
  document.getElementById('ra-faction-search-apply').click();
  await tick(120);

  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates','interacting with the selected core route must not snap back to another route');
  assert.equal(App._test.state.page,'faction-candidates');
  assert.equal((await dbGet(App._test.state.db,'factionRecruitment','123')).pipelineStage,'Prospect','core search must not mutate Faction workflow state');

  App._test.state.db.close();
  dom.window.close();
  await deleteDb();
});
