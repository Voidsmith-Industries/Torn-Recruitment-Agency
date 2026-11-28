const test=require('node:test');
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const Foundation=require('../src/v46-storage-core');
const FactionCore=require('../src/v47-faction-core');
const FactionStorage=require('../src/v47-faction-storage');

function makeAdapter(db){
  return{
    get(store,key){return new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);});},
    getAll(store){return new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});},
    put(store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});},
    delete(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});}
  };
}

async function openDb(){
  const name=`ra-v47-isolation-${Date.now()}-${Math.random()}`;
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,15);
    req.onupgradeneeded=()=>{Foundation.applyUpgrade(req.result);FactionStorage.applyUpgrade(req.result);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

test('Faction mutation cannot change Company workflow state for the same Torn ID',async()=>{
  const db=await openDb();const idb=makeAdapter(db);const repos=Foundation.createRepositories(idb);
  await repos.company.ensure('123',{pipelineStage:'Contacted',recruiterNote:'Company note'},{source:'company-test',sharedPatch:{name:'Alpha',fit:80},observedAt:100});
  await repos.faction.ensure('123',{pipelineStage:'Evaluating',recruiterNote:'Faction note'},{source:'faction-test',observedAt:200});
  const before=await idb.get('companyRecruitment','123');
  await repos.faction.ensure('123',{pipelineStage:'Deferred',recruiterNote:'Faction changed'},{source:'faction-test',observedAt:300});
  const after=await idb.get('companyRecruitment','123');
  assert.equal(after.pipelineStage,'Contacted');
  assert.equal(after.recruiterNote,'Company note');
  assert.deepEqual(after,before);
  db.close();
});

test('Company mutation cannot change Faction workflow state for the same Torn ID',async()=>{
  const db=await openDb();const idb=makeAdapter(db);const repos=Foundation.createRepositories(idb);
  await repos.company.ensure('123',{pipelineStage:'Contacted'},{source:'company-test',sharedPatch:{name:'Alpha'},observedAt:100});
  await repos.faction.ensure('123',{pipelineStage:'Evaluating',pinnedSpecialistProfileId:'rw'},{source:'faction-test',observedAt:200});
  const before=await idb.get('factionRecruitment','123');
  await repos.company.ensure('123',{pipelineStage:'Replied'},{source:'company-test',observedAt:300});
  const after=await idb.get('factionRecruitment','123');
  assert.equal(after.pipelineStage,'Evaluating');
  assert.equal(after.pinnedSpecialistProfileId,'rw');
  assert.deepEqual(after,before);
  db.close();
});

test('shared Player Intelligence updates are visible without mutating either domain stage',async()=>{
  const db=await openDb();const idb=makeAdapter(db);const repos=Foundation.createRepositories(idb);
  await repos.company.ensure('123',{pipelineStage:'Shortlisted'},{source:'company-test',sharedPatch:{name:'Alpha',fit:70},observedAt:100});
  await repos.faction.ensure('123',{pipelineStage:'Invite Ready'},{source:'faction-test',observedAt:200});
  await repos.players.ensure('123',{name:'Alpha Updated',fit:95,activity30:120},'shared-refresh',300);
  const[player,company,faction]=await Promise.all([
    idb.get('playerIntelligence','123'),idb.get('companyRecruitment','123'),idb.get('factionRecruitment','123')
  ]);
  assert.equal(player.name,'Alpha Updated');
  assert.equal(player.fit,95);
  assert.equal(player.activity30,120);
  assert.equal(company.pipelineStage,'Shortlisted');
  assert.equal(faction.pipelineStage,'Invite Ready');
  db.close();
});

test('Faction support-store mutations cannot create or alter Company recruitment records',async()=>{
  const db=await openDb();const idb=makeAdapter(db);const foundation=Foundation.createRepositories(idb);const factionRepos=FactionStorage.createRepositories(idb,FactionCore);
  await foundation.company.ensure('123',{pipelineStage:'Contacted'},{source:'company-test',sharedPatch:{name:'Alpha'},observedAt:100});
  const before=await idb.get('companyRecruitment','123');
  await factionRepos.config.save({baseline:{criteria:[{id:'level',field:'level',kind:'Hard',operator:'gte',value:50}]}});
  await factionRepos.profiles.save({profileId:'rw',name:'RW Fighter',status:'Active',criteria:[]});
  const after=await idb.get('companyRecruitment','123');
  assert.deepEqual(after,before);
  db.close();
});
