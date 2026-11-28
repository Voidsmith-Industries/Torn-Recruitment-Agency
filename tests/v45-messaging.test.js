const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/v45-messaging');

test('recruitment affiliation checks fail closed when API omits the authoritative field',()=>{
  assert.deepEqual(M.companyRecruitmentEligibility({}),{eligible:false,known:false,currentName:'',currentId:''});
  assert.deepEqual(M.factionRecruitmentEligibility({user:{}}),{eligible:false,known:false,currentName:'',currentId:''});
  assert.deepEqual(M.companyRecruitmentEligibility({job:null}),{eligible:true,known:true,currentName:'',currentId:''});
  assert.deepEqual(M.factionRecruitmentEligibility({faction:null}),{eligible:true,known:true,currentName:'',currentId:''});
  assert.equal(M.companyRecruitmentEligibility({job:{type:'company',id:7,name:'Seven'}}).eligible,false);
  assert.equal(M.factionRecruitmentEligibility({faction:{id:8,name:'Eight'}}).eligible,false);
});

test('undefined or empty affiliation payloads remain unverifiable',()=>{
  for(const response of [{job:undefined},{job:{}},{user:{job:undefined}},{user:{job:{}}}]){
    assert.deepEqual(M.companyRecruitmentEligibility(response),{eligible:false,known:false,currentName:'',currentId:''});
  }
  for(const response of [{faction:undefined},{faction:{}},{user:{faction:undefined}},{user:{faction:{}}}]){
    assert.deepEqual(M.factionRecruitmentEligibility(response),{eligible:false,known:false,currentName:'',currentId:''});
  }
});

test('private-chat draft persists only explicit DNC override authority',()=>{
  const data=new Map();const storage={getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
  const base=M.recruitmentChatPlan('company','Hello {name}',{userId:789,name:'Override'});
  M.queuePrivateChatDraft({...base,dncOverrideConfirmed:true},storage,1000);
  const approved=M.consumePrivateChatDraft('789',storage,1100);
  assert.equal(approved.dncOverrideConfirmed,true);

  M.queuePrivateChatDraft(base,storage,2000);
  const normal=M.consumePrivateChatDraft('789',storage,2100);
  assert.equal(normal.dncOverrideConfirmed,false);
});
