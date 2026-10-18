'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

function freshApp(){
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{
    url:'https://www.torn.com/index.php',pretendToBeVisual:true
  });
  Object.defineProperty(dom.window.document,'readyState',{value:'complete',configurable:true});
  class ResizeObserverStub{observe(){} unobserve(){} disconnect(){}}
  global.window=dom.window;
  global.document=dom.window.document;
  global.navigator=dom.window.navigator;
  global.location=dom.window.location;
  global.MutationObserver=dom.window.MutationObserver;
  global.HTMLElement=dom.window.HTMLElement;
  global.Node=dom.window.Node;
  global.ResizeObserver=ResizeObserverStub;
  global.indexedDB=indexedDB;
  global.IDBKeyRange=IDBKeyRange;
  global.innerWidth=1440;
  global.innerHeight=900;
  global.confirm=()=>true;
  global.prompt=()=>'';
  global.alert=()=>{};
  dom.window.ResizeObserver=ResizeObserverStub;
  dom.window.open=()=>null;
  dom.window.confirm=global.confirm;
  dom.window.prompt=global.prompt;
  dom.window.alert=global.alert;
  delete require.cache[require.resolve('../src/v45-app')];
  return require('../src/v45-app');
}

test('a concurrent geometry autosave does not revert a simultaneous Global Intelligence opt-out and cleared API key',async()=>{
  const App=freshApp();
  assert.equal(await App.start({indexedDB}),true);
  const {saveSettings,saveGeometry,getMeta,state}=App._test;

  await saveSettings({apiKey:'TORN-OLD-KEY-0000001',global:{...state.settings.global,enabled:true}});
  const baseline=await getMeta();
  assert.equal(baseline.settings.apiKey,'TORN-OLD-KEY-0000001');
  assert.equal(baseline.settings.global.enabled,true);

  document.getElementById('ra-app').getBoundingClientRect=()=>({left:12,top:34,width:900,height:650});

  await Promise.all([
    saveSettings({apiKey:'',global:{...state.settings.global,enabled:false}}),
    saveGeometry()
  ]);

  const meta=await getMeta();
  assert.equal(meta.settings.apiKey,'','cleared API key must survive a concurrent geometry autosave');
  assert.equal(meta.settings.global.enabled,false,'Global Intelligence opt-out must survive a concurrent geometry autosave');
  assert.deepEqual(meta.ui.windowGeometry.main,{x:12,y:34,width:900,height:650},'geometry save must not be dropped either');
});

test('two concurrent settings saves do not clobber each other\'s fields (lost update)',async()=>{
  const App=freshApp();
  assert.equal(await App.start({indexedDB}),true);
  const {saveSettings,getMeta,state}=App._test;

  await saveSettings({apiKey:'TORN-OLD-KEY-0000002',global:{...state.settings.global,enabled:true}});

  await Promise.all([
    saveSettings({apiKey:''}),
    saveSettings({global:{...state.settings.global,enabled:false}})
  ]);

  const meta=await getMeta();
  assert.equal(meta.settings.apiKey,'','first concurrent save must not be lost');
  assert.equal(meta.settings.global.enabled,false,'second concurrent save must not be lost');
});

test('rapid interleaved settings and layout-reset writes converge without losing the latest value',async()=>{
  const App=freshApp();
  assert.equal(await App.start({indexedDB}),true);
  const {saveSettings,saveGeometry,resetLayout,getMeta,state}=App._test;

  document.getElementById('ra-app').getBoundingClientRect=()=>({left:5,top:6,width:800,height:600});

  await Promise.all([
    saveSettings({apiKey:'KEY-A'}),
    saveGeometry(),
    saveSettings({apiKey:'KEY-B',global:{...state.settings.global,enabled:false}}),
    resetLayout(),
    saveGeometry()
  ]);

  const meta=await getMeta();
  assert.equal(meta.settings.apiKey,'KEY-B','the last-issued settings patch must win, not an interleaved stale read');
  assert.equal(meta.settings.global.enabled,false);
  assert.ok(meta.ui&&meta.ui.windowGeometry,'ui metadata must remain a well-formed object after interleaved writes');
});
