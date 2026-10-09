const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

class ResizeObserverStub{observe(){}unobserve(){}disconnect(){}}
const settle=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

function freshApp(){const modulePath=require.resolve('../src/v45-app');delete require.cache[modulePath];return require('../src/v45-app');}
function deleteDb(){return new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase('tornWorkerDB');req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);req.onblocked=()=>resolve();});}

async function withApp(run){
  await deleteDb();
  const dom=installDom();
  const App=freshApp();
  try{
    assert.equal(await App.start({indexedDB}),true);
    assert.equal(App._test.state.page,'company-candidates');
    await run(App,dom);
  }finally{
    await settle(200);
    App._test.state.db?.close?.();
    dom.window.close();
    await deleteDb();
  }
}

test('Company sidebar navigation commits canonical route before asynchronous rendering',async()=>{
  await withApp(async App=>{
    document.querySelector('[data-page="company-candidates"]').click();
    assert.equal(App._test.state.page,'company-candidates','Company route state must change in the same click turn');
    await settle(180);
    assert.equal(document.getElementById('ra-page-title').textContent,'Company Candidates');
    assert.equal(App._test.state.page,'company-candidates');
  });
});

test('Faction mode switch commits the canonical core route before rendering completes',async()=>{
  await withApp(async App=>{
    const workspace=document.getElementById('ra-workspace-toggle');
    workspace.click();
    document.querySelector('[data-workspace-domain="faction"]').click();
    await settle(20);
    assert.equal(App._test.state.page,'faction-candidates','Faction switch must select the Faction core route');
    await settle(180);
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
    assert.equal(App._test.state.page,'faction-candidates');
  });
});

test('a newer route wins over an older asynchronous render',async()=>{
  await withApp(async App=>{
    document.querySelector('[data-page="company-candidates"]').click();
    assert.equal(App._test.state.page,'company-candidates');
    const workspace=document.getElementById('ra-workspace-toggle');
    workspace.click();
    document.querySelector('[data-workspace-domain="faction"]').click();
    await settle(250);
    assert.equal(App._test.state.page,'faction-candidates');
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  });
});
