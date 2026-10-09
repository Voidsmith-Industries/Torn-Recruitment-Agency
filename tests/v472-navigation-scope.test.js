const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

class ResizeObserverStub{observe(){}unobserve(){}disconnect(){}}
const settle=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function installDom(){
  const dom=new JSDOM(`<!doctype html><html><head></head><body>
    <main id="torn-content">
      <button id="torn-page-two" type="button" data-page="2">Torn page 2</button>
      <section><h2>Information</h2><div><button>One</button><button>Two</button></div></section>
    </main>
  </body></html>`,{url:'https://www.torn.com/index.php',pretendToBeVisual:true});
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

test('Recruitment Agency navigation never hijacks foreign Torn data-page controls',async()=>{
  await deleteDb();
  const dom=installDom();
  const tornButton=document.getElementById('torn-page-two');
  let tornClicks=0;
  tornButton.onclick=()=>{tornClicks++;};
  const App=freshApp();
  try{
    assert.equal(await App.start({indexedDB}),true);

    const workspace=document.getElementById('ra-workspace-toggle');
    workspace.click();
    document.querySelector('[data-workspace-domain="faction"]').click();
    await settle(180);
    assert.equal(App._test.state.page,'faction-candidates');
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');

    tornButton.click();
    await settle(180);

    assert.equal(App._test.state.page,'faction-candidates','foreign data-page values must never enter the Recruitment Agency router');
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
    assert.equal(tornClicks,1,'the Torn control must keep its own click handler');
  }finally{
    await settle(100);
    App._test.state.db?.close?.();
    dom.window.close();
    await deleteDb();
  }
});

test('invalid live navigation is rejected instead of falling back to Company Overview',async()=>{
  await deleteDb();
  const dom=installDom();
  const App=freshApp();
  try{
    assert.equal(await App.start({indexedDB}),true);
    const workspace=document.getElementById('ra-workspace-toggle');
    workspace.click();
    document.querySelector('[data-workspace-domain="faction"]').click();
    await settle(180);
    assert.equal(App._test.state.page,'faction-candidates');
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');

    assert.equal(typeof App._test.navigate,'function','the live router must expose its test seam');
    assert.equal(await App._test.navigate('2'),false,'an invalid live route should be rejected');
    await settle(80);

    assert.equal(App._test.state.page,'faction-candidates');
    assert.equal(document.getElementById('ra-page-title').textContent,'Faction Candidates');
  }finally{
    await settle(100);
    App._test.state.db?.close?.();
    dom.window.close();
    await deleteDb();
  }
});
