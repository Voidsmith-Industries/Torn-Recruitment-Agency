const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

function tick(ms=40){return new Promise(resolve=>setTimeout(resolve,ms));}
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

async function openFactionRequirements(App){
  App._test.state.settings.optionalModules.factionRequirements=true;
  await App._test.navigate('faction-requirements',false);
  await tick();
}

test('Faction waiver UI persists an individual baseline exception, preserves failed facts, and resolves history instead of deleting it',async()=>{
  await deleteDb();
  const dom=installDom();
  const App=freshApp();
  assert.equal(await App.start({indexedDB}),true);await App._test.openApp();

  await App._test.repositories.players.ensure('123',{name:'Alpha',level:40},'waiver-browser-test',100);
  await App._test.repositories.faction.ensure('123',{pipelineStage:'Evaluating',waivers:[]},{source:'waiver-browser-test',observedAt:100});
  await App._test.factionRepositories.config.save({baseline:{criteria:[{id:'level',label:'Level 50+',field:'level',operator:'gte',value:50,kind:'Hard',weight:1}]}});

  await openFactionRequirements(App);
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Requirements');
  document.getElementById('ra-faction-waiver-player').value='123';
  document.getElementById('ra-faction-waiver-context').value='baseline';
  document.getElementById('ra-faction-waiver-requirement').value='level';
  document.getElementById('ra-faction-waiver-reason').value='Leadership-approved exception';
  document.getElementById('ra-faction-waiver-review').value='2026-09-01T12:00';
  document.getElementById('ra-faction-waiver-grant').click();
  await tick(80);

  let faction=await dbGet(App._test.state.db,'factionRecruitment','123');
  const player=await dbGet(App._test.state.db,'playerIntelligence','123');
  assert.equal(player.level,40,'waiver must not falsify the failed shared fact');
  assert.equal(faction.waivers.length,1);
  assert.equal(faction.waivers[0].requirementId,'level');
  assert.equal(faction.waivers[0].context,'baseline');
  assert.equal(faction.waivers[0].reason,'Leadership-approved exception');
  assert.equal(faction.waivers[0].state,'Active');
  assert.ok(Number.isFinite(faction.waivers[0].reviewAt));
  assert.match(document.getElementById('ra-content').textContent,/Eligible by Waiver/);

  document.querySelector(`[data-faction-waiver-resolve="${faction.waivers[0].waiverId}"]`).click();
  await tick(80);
  faction=await dbGet(App._test.state.db,'factionRecruitment','123');
  assert.equal(faction.waivers.length,1,'resolved waiver history must be retained');
  assert.equal(faction.waivers[0].state,'Resolved');
  assert.ok(Number.isFinite(faction.waivers[0].resolvedAt));

  App._test.state.db.close();
  dom.window.close();
  await deleteDb();
});
