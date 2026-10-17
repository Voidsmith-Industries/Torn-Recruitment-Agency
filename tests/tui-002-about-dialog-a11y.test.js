'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

async function waitFor(check){
  const start=Date.now();
  while(!check()){
    if(Date.now()-start>2000)throw new Error('Timed out waiting for UI');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
test('About dialog traps keyboard focus, closes on Escape, restores opener',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><button id="host-button">Torn</button></body></html>',{
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
  const App=require('../src/v45-app');
  assert.equal(await App.start({indexedDB}),true);
  document.getElementById('ra-launch').click();
  document.getElementById('ra-settings-button').click();
  await waitFor(()=>document.getElementById('ra-open-about')!==null);
  const opener=document.getElementById('ra-open-about');
  opener.focus();
  opener.click();
  const overlay=document.getElementById('ra-modal');
  assert.equal(overlay.hidden,false);
  const dialog=overlay.querySelector('[role="dialog"]');
  assert.ok(dialog,'modal content must expose a dialog');
  assert.equal(dialog.getAttribute('aria-modal'),'true');
  assert.equal(document.activeElement,dialog,'opening must move focus to dialog');
  const items=[...dialog.querySelectorAll('a[href],button:not([disabled])')];
  assert.ok(items.length>=3);
  const first=items[0],last=items[items.length-1];
  last.focus();
  last.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(document.activeElement,first,'Tab must wrap to first control');
  first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(document.activeElement,last,'Shift+Tab must wrap to last control');
  last.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(overlay.hidden,true);
  assert.equal(document.activeElement,opener,'Escape must restore focus');
  opener.click();
  document.querySelector('#ra-modal [data-modal-close]').click();
  assert.equal(overlay.hidden,true);
  assert.equal(document.activeElement,opener,'Close must restore focus');
  dom.window.close();
});
test('distributed userscript retains the dialog controls',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/v45-app.js'),'utf8');
  const dist=fs.readFileSync(path.join(__dirname,'../dist/recruitment-agency.user.js'),'utf8');
  for(const text of [source,dist]){
    assert.match(text,/function modalTabbables\(dialog\)/);
    assert.match(text,/function onModalKeydown\(event\)/);
    assert.match(text,/modalReturnFocus=document\.activeElement/);
    assert.match(text,/min-height:44px/);
  }
});
