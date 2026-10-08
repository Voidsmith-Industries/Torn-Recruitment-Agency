const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {indexedDB}=require('fake-indexeddb');
const App=require('../src/v45-app');

function put(db,store,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function clear(db,store){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

test('Claude remediation: cleared Company profile remains explicitly cleared',async()=>{
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  await clear(db,'matchProfiles');
  await put(db,'matchProfiles',{profileId:'alpha',name:'Alpha',criteria:{},searchFilters:{company:{}}});
  await put(db,'matchProfiles',{profileId:'sales',name:'Sales',criteria:{man:{enabled:true,target:100000}},searchFilters:{company:{minMan:'100000'}}});
  App._test.state.settings=App.mergeSettings({match:{activeProfileId:'sales'}});
  assert.equal((await App._test.getActiveMatchProfile()).profileId,'sales');
  App._test.state.settings=App.mergeSettings({...App._test.state.settings,match:{...App._test.state.settings.match,activeProfileId:''}});
  assert.equal(await App._test.getActiveMatchProfile(),null);
  assert.equal(App._test.state.settings.match.activeProfileId,'');
  db.close();
});

test('Claude remediation: CSV cells neutralize spreadsheet formulas before quoting',()=>{
  assert.equal(App._test.csvCell('=HYPERLINK("https://evil.example","Open")'),'"\'=HYPERLINK(""https://evil.example"",""Open"")"');
  assert.equal(App._test.csvCell(' +SUM(1,2)'),'"\' +SUM(1,2)"');
  assert.equal(App._test.csvCell('@cmd'),'"\'@cmd"');
  assert.equal(App._test.csvCell('-1'),'"\'-1"');
  assert.equal(App._test.csvCell('Normal "Name"'),'"Normal ""Name"""');
});

test('Claude remediation: Player Card recruitment re-reads domain DNC state before recruiting',()=>{
  const source=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  assert.match(source,/const latest=await idb\.get\(normalizedDomain==='faction'\?'factionRecruitment':'companyRecruitment',userId\)/);
  assert.match(source,/if\(latest\?\.doNotContact===true\)throw new Error\('Do Not Contact is set for this recruitment domain\.'\)/);
});

test('Claude remediation: Smart Match editor alone may bootstrap a fallback profile',()=>{
  const source=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  assert.match(source,/async function getActiveMatchProfile\(fallback=false\)/);
  assert.match(source,/return fallback\?ensureDefaultMatchProfile\(\):null/);
  assert.match(source,/async function renderSmartMatch\(\).*?getActiveMatchProfile\(true\)/s);
});
