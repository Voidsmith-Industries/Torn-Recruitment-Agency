const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/v45-messaging');

test('supported message placeholders are exactly the approved initial seven', () => {
  assert.deepEqual(M.PLACEHOLDERS,['name','player_id','looking_for','company_name','current_company','match_score','fit_score']);
});

test('prepared messages substitute approved values and remove unknown placeholders cleanly', () => {
  const text=M.prepareMessage('Hi {name}, looking for {looking_for}. Current company: {current_company}. Unknown {nope}.',{
    name:'Alice',looking_for:'10* AN',current_company:''
  });
  assert.equal(text,'Hi Alice, looking for 10* AN. Current company. Unknown.');
});

test('message plan is pre-addressed but never sends or changes pipeline stage', () => {
  const plan=M.messagePlan('Hi {name}',{userId:123,name:'Alice'});
  assert.equal(plan.userId,'123');
  assert.equal(plan.preparedText,'Hi Alice');
  assert.equal(plan.composeUrl,'https://www.torn.com/messages.php#/p=compose&XID=123');
  assert.equal(plan.autoSubmit,false);
  assert.equal(plan.stageChange,null);
});

test('invalid message target is rejected', () => {
  assert.throws(()=>M.messagePlan('Hi',{userId:'nope'}),/valid Torn player ID/);
  assert.equal(M.composeUrl('nope'),'');
});


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
