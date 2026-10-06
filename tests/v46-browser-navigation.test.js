const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

function tick(ms=20){return new Promise(resolve=>setTimeout(resolve,ms));}
class ResizeObserverStub{observe(){} unobserve(){} disconnect(){}}

function installDom(){
  const dom=new JSDOM('<!doctype html><html><head></head><body><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section></body></html>',{
    url:'https://www.torn.com/index.php',pretendToBeVisual:true
  });
  Object.defineProperty(dom.window.document,'readyState',{value:'complete',configurable:true});
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async()=>{}},configurable:true});
  global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.location=dom.window.location;
  global.MutationObserver=dom.window.MutationObserver;global.HTMLElement=dom.window.HTMLElement;global.Node=dom.window.Node;
  global.ResizeObserver=ResizeObserverStub;global.indexedDB=indexedDB;global.IDBKeyRange=IDBKeyRange;global.innerWidth=1440;global.innerHeight=900;
  global.confirm=()=>true;global.prompt=()=>'';global.alert=()=>{};
  dom.window.ResizeObserver=ResizeObserverStub;dom.window.open=()=>null;dom.window.confirm=global.confirm;dom.window.prompt=global.prompt;dom.window.alert=global.alert;
  return dom;
}

async function readMeta(db){return new Promise((resolve,reject)=>{const q=db.transaction('meta','readonly').objectStore('meta').get('global');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}

function freshApp(){
  const appPath=require.resolve('../src/v45-app');
  delete require.cache[appPath];
  return require('../src/v45-app');
}

test('v4.8 domain switch and core route persist without exposing optional navigation by default',async()=>{
  const dom1=installDom();
  const App1=freshApp();
  assert.equal(await App1.start({indexedDB}),true);

  assert.equal(document.querySelector('[data-nav-toggle="company-recruitment"]'),null);
  assert.equal(document.querySelector('[data-nav-toggle="faction-recruitment"]'),null);
  assert.equal(document.querySelector('[data-nav-toggle="intelligence"]'),null);
  assert.ok(document.querySelector('[data-page="company-candidates"]'));
  assert.ok(document.getElementById('ra-workspace-domain'));
  assert.equal(document.querySelector('[data-page="settings"]'),null);
  assert.ok(document.getElementById('ra-settings-button'));

  const workspace=document.getElementById('ra-workspace-toggle');
  workspace.click();
  document.querySelector('[data-workspace-domain="faction"]').click();
  await tick(80);
  let meta=await readMeta(App1._test.state.db);
  assert.equal(meta.settings.activeDomain,'faction');
  assert.equal(meta.settings.activePage,'faction-candidates');
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  App1._test.state.db.close();
  dom1.window.close();

  const dom2=installDom();
  const App2=freshApp();
  assert.equal(await App2.start({indexedDB}),true);
  await tick(80);
  meta=await readMeta(App2._test.state.db);
  assert.equal(meta.settings.activeDomain,'faction');
  assert.equal(meta.settings.activePage,'faction-candidates');
  assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  App2._test.state.db.close();
  dom2.window.close();
});
