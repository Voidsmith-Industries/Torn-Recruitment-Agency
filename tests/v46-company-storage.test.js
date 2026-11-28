const test=require('node:test');
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const CompanyCore=require('../src/v46-company-core.js');
const CompanyStorage=require('../src/v46-company-storage.js');

function openDb(version=CompanyStorage.DB_VERSION){
  return new Promise((resolve,reject)=>{
    const name=`ra-company-storage-${Date.now()}-${Math.random()}`;
    const req=indexedDB.open(name,version);
    req.onupgradeneeded=()=>CompanyStorage.applyUpgrade(req.result);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function adapter(db){
  return {
    get(store,key){return new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);});},
    getAll(store){return new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});},
    put(store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});},
    delete(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});}
  };
}

test('DB14 declares only additive Company entity stores',()=>{
  assert.equal(CompanyStorage.DB_VERSION,14);
  assert.deepEqual(Object.keys(CompanyStorage.STORE_DEFINITIONS).sort(),[
    'companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','companyVacancies'
  ]);
  assert.equal(CompanyStorage.STORE_DEFINITIONS.companyVacancies.keyPath,'vacancyId');
  assert.equal(CompanyStorage.STORE_DEFINITIONS.companyCampaigns.keyPath,'campaignId');
  assert.equal(CompanyStorage.STORE_DEFINITIONS.companyRecruitmentConfig.keyPath,'key');
  assert.equal(CompanyStorage.STORE_DEFINITIONS.companyRecruitmentSessions.keyPath,'sessionId');
});

test('DB14 upgrade creates Company stores without deleting pre-existing DB13 stores',async()=>{
  const name=`ra-company-upgrade-${Date.now()}-${Math.random()}`;
  const old=await new Promise((resolve,reject)=>{const req=indexedDB.open(name,13);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('playerIntelligence',{keyPath:'userId'});db.createObjectStore('companyRecruitment',{keyPath:'userId'});db.createObjectStore('factionRecruitment',{keyPath:'userId'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  old.close();
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(name,14);req.onupgradeneeded=()=>CompanyStorage.applyUpgrade(req.result);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const names=[...db.objectStoreNames];
  for(const store of ['playerIntelligence','companyRecruitment','factionRecruitment','companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions'])assert.ok(names.includes(store),store);
  db.close();
});

test('config repository persists baseline, stage thresholds and Opportunity weights under one Company config record',async()=>{
  const db=await openDb();
  const repos=CompanyStorage.createRepositories(adapter(db),CompanyCore);
  const config=await repos.config.save({baseline:{criteria:[{id:'ee',field:'ee',kind:'Hard',operator:'gte',value:10}]},stageThresholds:{Contacted:5},opportunityWeights:{match:30,fit:20}});
  assert.equal(config.key,'company');
  assert.equal(config.baseline.criteria[0].kind,'Hard');
  assert.equal(config.stageThresholds.Contacted,5);
  assert.equal((await repos.config.get()).opportunityWeights.match,30);
  db.close();
});

