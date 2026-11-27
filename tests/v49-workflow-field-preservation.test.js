const test=require('node:test');
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const App=require('../src/v45-app');

test('kept recruitment writes preserve stored workflow fields from removed pages',async()=>{
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  await App._test.clearRecruitmentData();
  const put=(store,value)=>new Promise((resolve,reject)=>{const req=db.transaction(store,'readwrite').objectStore(store).put(value);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});
  const get=(store,key)=>new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const workflow={followUps:[{followUpId:'f1',dueAt:5}],timelineNotes:[{noteId:'n1',text:'met'}],contactOutcomes:[{result:'Replied'}],campaignIds:['c1'],sessionIds:['s1'],talentPool:true,talentPoolSince:123,reactivatedAt:456,customWorkflowField:{nested:true},doNotContact:true,doNotContactReason:'asked'};
  await put('companyRecruitment',{userId:'501',domain:'company',pipelineStage:'Shortlisted',pinnedVacancyId:'v1',...workflow});
  await put('factionRecruitment',{userId:'502',domain:'faction',pipelineStage:'Evaluating',waivers:[{waiverId:'w1'}],...workflow});
  await App._test.repositories.company.ensure('501',{recruiterNote:'touched'},{source:'test'});
  await App._test.repositories.faction.ensure('502',{recruiterNote:'touched'},{source:'test'});
  const company=await get('companyRecruitment','501');
  const faction=await get('factionRecruitment','502');
  for(const record of [company,faction]){
    assert.equal(record.recruiterNote,'touched');
    assert.deepEqual(record.contactOutcomes,[{result:'Replied'}]);
    assert.deepEqual(record.campaignIds,['c1']);
    assert.deepEqual(record.sessionIds,['s1']);
    assert.equal(record.talentPoolSince,123);
    assert.equal(record.reactivatedAt,456);
    assert.deepEqual(record.customWorkflowField,{nested:true});
    assert.equal(record.followUps[0].followUpId,'f1');
    assert.equal(record.doNotContact,true,'Do Not Contact keeps being honoured');
  }
  assert.equal(company.pinnedVacancyId,'v1');
  assert.deepEqual(faction.waivers,[{waiverId:'w1'}]);
  db.close();
});
