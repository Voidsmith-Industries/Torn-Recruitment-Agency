const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const S = require('../src/v46-storage-core');

function openDb(name, version, onUpgrade) {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,version);
    req.onupgradeneeded=event=>onUpgrade?.(event.target.result,event.oldVersion,event.newVersion,event.target.transaction);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function adapter(db) {
  return {
    get(store,key){return new Promise(resolve=>{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);});},
    getAll(store){return new Promise(resolve=>{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);});},
    put(store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});},
    delete(store,key){return new Promise(resolve=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);});},
    clear(store){return new Promise(resolve=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);});}
  };
}

function createLegacyStores(db) {
  if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
  if(!db.objectStoreNames.contains('candidateLocal')) db.createObjectStore('candidateLocal',{keyPath:'userId'});
  if(!db.objectStoreNames.contains('forumSources')) { const s=db.createObjectStore('forumSources',{keyPath:'sourceId'});s.createIndex('userId','userId',{unique:false}); }
  if(!db.objectStoreNames.contains('scoutLatest')) db.createObjectStore('scoutLatest',{keyPath:'userId'});
  if(!db.objectStoreNames.contains('globalLatest')) db.createObjectStore('globalLatest',{keyPath:'userId'});
  if(!db.objectStoreNames.contains('users')) db.createObjectStore('users',{keyPath:'recordId'});
}

async function seedLegacy(db) {
  const tx=db.transaction(['candidateLocal','forumSources','scoutLatest','globalLatest','users'],'readwrite');
  const c=tx.objectStore('candidateLocal');
  c.put({userId:'111',name:'Company One',pipelineStage:'Replied',recruiterNote:'company note',expectedSalary:5000000,discoverySources:['COMPANY FORUM'],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-02-01T00:00:00.000Z'});
  c.put({userId:'222',name:'Faction Two',pipelineStage:'Shortlisted',recruiterNote:'faction note',discoverySources:['FACTION FORUM'],createdAt:'2026-01-02T00:00:00.000Z',updatedAt:'2026-02-02T00:00:00.000Z'});
  c.put({userId:'333',name:'Both Three',pipelineStage:'Replied',recruiterNote:'ambiguous note',discoverySources:['COMPANY FORUM','FACTION FORUM'],createdAt:'2026-01-03T00:00:00.000Z',updatedAt:'2026-02-03T00:00:00.000Z'});
  c.put({userId:'444',name:'Unknown Four',pipelineStage:'Not Contacted',recruiterNote:'unknown note',discoverySources:[],createdAt:'2026-01-04T00:00:00.000Z',updatedAt:'2026-02-04T00:00:00.000Z'});
  tx.objectStore('forumSources').put({sourceId:'FACTION:222:1',userId:222,sourceType:'FACTION FORUM',postedAt:1769000000000});
  tx.objectStore('scoutLatest').put({userId:111,capturedAt:1771000000000,profile:{name:'Company One Renamed',level:50,factionId:7,factionName:'Seven',lastActionTs:1770999000},currentFit:87,official:true,extra:{networth:123456}});
  tx.objectStore('globalLatest').put({userId:222,name:'Faction Two',observedAt:1772000000000,level:60,activity30:20,xanax30:3,refills30:4,attacks30:50,rwHits30:6,fit:91,fitType:'official',lastActive:1771999000000,scoutStatus:'fresh'});
  tx.objectStore('users').put({recordId:'company:111',userId:111,name:'Company One',sourceMode:'company',lastSeenPost:1768000000000});
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}

test('DB13 declares only additive foundation stores and indexable keys',()=>{
  assert.equal(S.DB_VERSION,13);
  assert.deepEqual(Object.keys(S.STORE_DEFINITIONS),['playerIntelligence','companyRecruitment','factionRecruitment']);
  assert.deepEqual(S.STORE_DEFINITIONS.playerIntelligence.indexes.map(x=>x.name),['nameLower','updatedAt']);
  assert.deepEqual(S.STORE_DEFINITIONS.companyRecruitment.indexes.map(x=>x.name),['pipelineStage','updatedAt']);
  assert.deepEqual(S.STORE_DEFINITIONS.factionRecruitment.indexes.map(x=>x.name),['pipelineStage','updatedAt']);
});

test('domain repositories never copy recruitment-private patch fields into playerIntelligence',async()=>{
  const name=`ra-storage-privacy-${Date.now()}-${Math.random()}`;
  const db=await openDb(name,13,db=>{createLegacyStores(db);S.applyUpgrade(db);});
  const idb=adapter(db);
  const repos=S.createRepositories(idb);
  await repos.company.ensure('111',{pipelineStage:'Replied',recruiterNote:'PRIVATE',expectedSalary:5000000},{
    sharedPatch:{name:'Alice',level:50},source:'company-discovery',observedAt:1000
  });
  const player=await idb.get('playerIntelligence','111');
  const company=await idb.get('companyRecruitment','111');
  assert.equal(player.name,'Alice');
  assert.equal(Object.hasOwn(player,'recruiterNote'),false);
  assert.equal(Object.hasOwn(player,'expectedSalary'),false);
  assert.equal(company.recruiterNote,'PRIVATE');
  assert.equal(company.expectedSalary,5000000);
  assert.equal(await idb.get('factionRecruitment','111'),null);
  db.close();
});

test('DB12 backfill separates provenance, preserves ambiguity and is idempotent',async()=>{
  const name=`ra-storage-backfill-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  await seedLegacy(db);
  db.close();
  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  const repos=S.createRepositories(idb);
  const first=await repos.backfillLegacy(1773000000000);
  assert.deepEqual(first,{players:4,company:3,faction:2,ambiguous:1});

  assert.ok(await idb.get('companyRecruitment','111'));
  assert.equal(await idb.get('factionRecruitment','111'),null);
  assert.ok(await idb.get('factionRecruitment','222'));
  assert.equal(await idb.get('companyRecruitment','222'),null);
  assert.ok(await idb.get('companyRecruitment','333'));
  assert.ok(await idb.get('factionRecruitment','333'));
  assert.equal((await idb.get('companyRecruitment','333')).migrationReviewRequired,true);
  assert.equal((await idb.get('factionRecruitment','333')).migrationReviewRequired,true);
  assert.equal((await idb.get('companyRecruitment','444')).legacyDomainAssumed,'company');

  for(const id of ['111','222','333','444']) assert.ok(await idb.get('playerIntelligence',id),`missing shared player ${id}`);
  assert.equal((await idb.get('playerIntelligence','111')).name,'Company One Renamed');
  assert.equal((await idb.get('playerIntelligence','111')).fit,87);
  assert.equal((await idb.get('playerIntelligence','222')).fit,91);
  assert.ok(await idb.get('candidateLocal','111'),'legacy candidateLocal remains');

  const beforeCompany=await idb.get('companyRecruitment','111');
  const beforePlayer=await idb.get('playerIntelligence','111');
  const second=await repos.backfillLegacy(1774000000000);
  assert.deepEqual(second,first);
  const afterCompany=await idb.get('companyRecruitment','111');
  const afterPlayer=await idb.get('playerIntelligence','111');
  assert.equal(afterCompany.createdAt,beforeCompany.createdAt);
  assert.deepEqual(afterPlayer.nameHistory,beforePlayer.nameHistory);
  db.close();
});


test('legacy backfill does not invent lastObservedAt when no historical timestamp exists',async()=>{
  const name=`ra-storage-no-observation-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  const tx=db.transaction('users','readwrite');
  tx.objectStore('users').put({recordId:'company:999',userId:999,name:'No Timestamp',sourceMode:'company'});
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();
  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  const repos=S.createRepositories(idb);
  await repos.backfillLegacy(1773000000000);
  const player=await idb.get('playerIntelligence','999');
  assert.ok(player);
  assert.equal(Object.hasOwn(player,'lastObservedAt'),false);
  db.close();
});


test('legacy candidate workflow updatedAt does not become Last Observed',async()=>{
  const name=`ra-storage-workflow-not-observation-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  const tx=db.transaction('candidateLocal','readwrite');
  tx.objectStore('candidateLocal').put({
    userId:'998',
    name:'Workflow Only',
    pipelineStage:'Replied',
    discoverySources:['MANUAL'],
    createdAt:'2026-01-01T00:00:00.000Z',
    updatedAt:'2026-10-09T12:00:00.000Z'
  });
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();
  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  const repos=S.createRepositories(idb);
  await repos.backfillLegacy(1773000000000);
  const player=await idb.get('playerIntelligence','998');
  assert.ok(player);
  assert.equal(player.name,'Workflow Only');
  assert.equal(Object.hasOwn(player,'lastObservedAt'),false);
  db.close();
});


test('legacy migration can write domain state without overwriting shared Player Intelligence',async()=>{
  const name=`ra-storage-skip-shared-${Date.now()}-${Math.random()}`;
  const db=await openDb(name,13,db=>{createLegacyStores(db);S.applyUpgrade(db);});
  const idb=adapter(db);
  const repos=S.createRepositories(idb);

  await repos.players.ensure('777',{name:'Fresh Scout',ee:99,lastObservedAt:5000},'scout',5000);
  await repos.company.ensure('777',{
    name:'Legacy Name',
    ee:1,
    pipelineStage:'Replied',
    recruiterNote:'legacy'
  },{
    source:'legacy-user-company',
    observedAt:1000,
    skipShared:true
  });

  const player=await idb.get('playerIntelligence','777');
  const company=await idb.get('companyRecruitment','777');
  assert.equal(player.name,'Fresh Scout');
  assert.equal(player.ee,99);
  assert.equal(player.lastObservedAt,5000);
  assert.equal(company.pipelineStage,'Replied');
  assert.equal(company.recruiterNote,'legacy');
  db.close();
});


test('legacy backfill cannot overwrite newer authoritative Player Intelligence',async()=>{
  const name=`ra-storage-protect-modern-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  const tx=db.transaction('candidateLocal','readwrite');
  tx.objectStore('candidateLocal').put({
    userId:'997',
    name:'Old Legacy',
    ee:1,
    pipelineStage:'Replied',
    discoverySources:['MANUAL'],
    updatedAt:'2026-10-09T12:00:00.000Z'
  });
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();

  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  await idb.put('playerIntelligence',{
    userId:'997',
    name:'New Scout',
    nameLower:'new scout',
    ee:99,
    level:75,
    lastObservedAt:5000,
    updatedAt:5000,
    createdAt:5000,
    sources:['scout']
  });

  const repos=S.createRepositories(idb);
  await repos.backfillLegacy(1773000000000);
  const player=await idb.get('playerIntelligence','997');
  assert.equal(player.name,'New Scout');
  assert.equal(player.ee,99);
  assert.equal(player.level,75);
  assert.equal(player.lastObservedAt,5000);
  assert.ok(player.sources.includes('legacy-candidate'));
  db.close();
});


test('undated legacy backfill only fills missing fields on an existing undated Player Intelligence row',async()=>{
  const name=`ra-storage-protect-undated-modern-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  const tx=db.transaction('candidateLocal','readwrite');
  tx.objectStore('candidateLocal').put({
    userId:'996',
    name:'Old Legacy',
    ee:1,
    pipelineStage:'Replied',
    discoverySources:['MANUAL']
  });
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();

  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  await idb.put('playerIntelligence',{
    userId:'996',
    name:'Current Unknown-Time',
    nameLower:'current unknown-time',
    ee:99,
    level:75,
    updatedAt:9000,
    createdAt:8000,
    sources:['manual']
  });
  const repos=S.createRepositories(idb);
  await repos.backfillLegacy(1773000000000);
  const player=await idb.get('playerIntelligence','996');
  assert.equal(player.name,'Current Unknown-Time');
  assert.equal(player.ee,99);
  assert.equal(player.level,75);
  assert.equal(Object.hasOwn(player,'lastObservedAt'),false);
  db.close();
});


test('legacy backfill leaves existing modern Company and Faction records unchanged',async()=>{
  const name=`ra-storage-domain-authority-${Date.now()}-${Math.random()}`;
  let db=await openDb(name,12,db=>createLegacyStores(db));
  const tx=db.transaction('candidateLocal','readwrite');
  tx.objectStore('candidateLocal').put({
    userId:'995',
    name:'Ambiguous Legacy',
    pipelineStage:'Replied',
    discoverySources:['COMPANY FORUM','FACTION FORUM']
  });
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();

  db=await openDb(name,13,db=>S.applyUpgrade(db));
  const idb=adapter(db);
  const company={userId:'995',domain:'company',pipelineStage:'Shortlisted',discoverySources:['MANUAL'],migrationReviewRequired:false,recruiterNote:'modern company'};
  const faction={userId:'995',domain:'faction',pipelineStage:'Invite Ready',discoverySources:['MANUAL'],migrationReviewRequired:false,recruiterNote:'modern faction'};
  await idb.put('companyRecruitment',company);
  await idb.put('factionRecruitment',faction);

  const repos=S.createRepositories(idb);
  await repos.backfillLegacy(1773000000000);
  assert.deepEqual(await idb.get('companyRecruitment','995'),company);
  assert.deepEqual(await idb.get('factionRecruitment','995'),faction);
  db.close();
});
