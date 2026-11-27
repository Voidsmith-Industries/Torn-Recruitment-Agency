// Release runtime-version integrity, checked on the shipped artifact.
//
// Players install only dist/recruitment-agency.user.js (served from the Voidsmith website).
// The source wrapper's @require lines are build inputs: scripts/build-userscript.js maps each
// URL to the local src/ file and inlines it. Those URLs still point at the pre-4.9 commit
// 912b070 and are never installed by players, so this test no longer fetches them; it checks
// that the dist itself carries one consistent release version and boots without tripping the
// wrapper's mismatched-runtime guard.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

const root=path.join(__dirname,'..');
const dist=fs.readFileSync(path.join(root,'dist','recruitment-agency.user.js'),'utf8');
const app=fs.readFileSync(path.join(root,'src','v45-app.js'),'utf8');
const wrapper=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');

test('shipped dist declares one consistent release version and no remote requires',()=>{
  const header=dist.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
  assert.ok(header,'dist must start with a userscript metadata block');
  assert.doesNotMatch(dist,/@require/,'dist must not load any remote runtime');
  const version=header.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
  assert.equal(version,'4.9.0');
  assert.equal(wrapper.match(/INSTALLER_VERSION\s*=\s*'([^']+)'/)?.[1],version,'INSTALLER_VERSION');
  assert.equal(wrapper.match(/EXPECTED_APP_VERSION\s*=\s*'([^']+)'/)?.[1],version,'EXPECTED_APP_VERSION');
  assert.equal(app.match(/SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1],version,'SCRIPT_VERSION');
});

test('executing the shipped dist reports SCRIPT_VERSION 4.9.0 and passes the runtime guard',async()=>{
  const version=dist.match(/^\/\/ @version\s+(\S+)$/m)[1];
  const errors=[];
  const alerts=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('error',(...args)=>errors.push(args.map(String).join(' ')));
  virtualConsole.on('jsdomError',error=>errors.push(String(error?.stack||error)));
  const dom=new JSDOM('<!doctype html><html><head></head><body><div class="content-wrapper"></div></body></html>',{
    url:'https://www.torn.com/index.php',pretendToBeVisual:true,runScripts:'outside-only',virtualConsole
  });
  const win=dom.window;
  try{
    win.indexedDB=indexedDB;
    win.IDBKeyRange=IDBKeyRange;
    win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    win.alert=message=>alerts.push(String(message));
    win.confirm=()=>true;
    win.GM_xmlhttpRequest=options=>{setTimeout(()=>options.onerror&&options.onerror({}),5);};
    win.eval(dist);
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(win.RA_V45App?.SCRIPT_VERSION,version,'bundled runtime SCRIPT_VERSION');
    assert.equal(win.RA_V45App.SCRIPT_VERSION,'4.9.0');
    const guardMessages=[...errors,...alerts].filter(text=>/mismatched runtime|could not load its application module/i.test(text));
    assert.deepEqual(guardMessages,[],'the wrapper runtime guard must not fire');
    assert.equal(win.document.documentElement.getAttribute('data-r4g3-ra-v45-owner'),version,'owner guard carries the release version');
  }finally{
    win.close();
  }
});
