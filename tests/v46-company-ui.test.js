const test=require('node:test');
const assert=require('node:assert/strict');
const CompanyUI=require('../src/v46-company-ui');
const CompanyCore=require('../src/v46-company-core');

const players=[
  {userId:'101',name:'Alpha',level:25,ee:120000,fit:92,lastActive:1000,activity30:110,currentCompany:'Old Co'},
  {userId:'202',name:'Beta',level:18,ee:80000,fit:74,lastActive:2000,activity30:70},
  {userId:'303',name:'Gamma',level:30,ee:160000,fit:88,lastActive:3000,activity30:95}
];
const company=[
  {userId:'101',domain:'company',pipelineStage:'Replied',availability:'Available',desiredRole:'Sales',followUps:[],archived:false,updatedAt:900,newlyDiscoveredAt:0},
  {userId:'202',domain:'company',pipelineStage:'Contacted',availability:'Unknown',desiredRole:'Trainer',followUps:[{dueAt:500,state:'open'}],archived:false,updatedAt:800},
  {userId:'303',domain:'company',pipelineStage:'Hired',availability:'Available',desiredRole:'Manager',followUps:[],archived:false,updatedAt:700}
];

function eligibilityFor(record,player){
  return CompanyCore.evaluateCriteria([{id:'ee',field:'ee',operator:'gte',value:100000,kind:'Hard',label:'EE'}],player,record.waivers||[]);
}

test('candidate rows join Company workflow with shared player facts and never require Faction state',()=>{
  const rows=CompanyUI.buildCandidateRows(company,players,{eligibilityFor});
  assert.deepEqual(rows.map(row=>row.userId),['101','202','303']);
  assert.equal(rows[0].name,'Alpha');
  assert.equal(rows[0].pipelineStage,'Replied');
  assert.equal(rows[0].fit,92);
  assert.equal(rows[0].eligibility,'Eligible');
  assert.equal(rows[1].eligibility,'NOT CURRENTLY ELIGIBLE');
  assert.equal(Object.hasOwn(rows[0],'factionStage'),false);
});

test('Company HTML renderers escape player content',()=>{
  const rows=CompanyUI.buildCandidateRows([{...company[0]}],[{...players[0],name:'<Alpha>'}],{eligibilityFor});
  const candidates=CompanyUI.renderCandidates(rows);
  assert.match(candidates,/&lt;Alpha&gt;/);
  assert.doesNotMatch(candidates,/<Alpha>/);
});

test('Company eligibility baseline editor renders saved criteria collapsed by default',()=>{
  const html=CompanyUI.renderBaselineEditor({baseline:{criteria:[{id:'ee',field:'ee',operator:'gte',value:5000,kind:'Hard',label:'<EE>',weight:1}]}});
  assert.match(html,/<details[^>]*id="ra-company-baseline-editor"/);
  assert.doesNotMatch(html,/id="ra-company-baseline-editor" open/);
  assert.match(html,/id="ra-company-baseline-save"/);
  assert.match(html,/data-criterion-id="ee"/);
  assert.match(html,/&lt;EE&gt;/);
  assert.match(CompanyUI.renderBaselineEditor({},{open:true}),/id="ra-company-baseline-editor" open/);
});

test('v4.9 Company results surface local recruitment profiles without adding a second profile system',()=>{
  const html=CompanyUI.renderCandidates([],{
    profiles:[
      {profileId:'sales',name:'Sales Role'},
      {profileId:'trainer',name:'Trainer Role'}
    ],
    activeProfileId:'trainer',
    smartMatch:true
  });
  assert.match(html,/id="ra-company-profile-select"/);
  assert.match(html,/Sales Role/);
  assert.match(html,/value="trainer" selected/);
  assert.match(html,/id="ra-company-profile-apply"/);
  assert.match(html,/<option value=""[^>]*>No profile<\/option>/);
  assert.match(html,/id="ra-company-profile-clear"/);
  assert.match(html,/id="ra-company-profile-save-search"/);
  assert.match(html,/id="ra-company-profile-manage"/);
  // 4.9.2: Manage Profiles opens Smart Match, so it is replaced by a hint while Smart Match is off.
  const off=CompanyUI.renderCandidates([],{profiles:[{profileId:'sales',name:'Sales Role'}]});
  assert.doesNotMatch(off,/id="ra-company-profile-manage"/);
  assert.match(off,/Turn on Smart Match in Settings/);
});

test('Company Results pagination shows filtered range without rendering the full result set',()=>{
  const rows=Array.from({length:2},(_,i)=>({userId:String(i+1),name:'C'+i,pipelineStage:'Not Contacted',prospectProvenance:{sources:[]}}));
  const html=CompanyUI.renderCandidates(rows,{total:350,filteredTotal:250,layout:'compact',pagination:{page:1,pageCount:3,start:100,end:102}});
  assert.match(html,/101-102 of 250/);
  assert.match(html,/data-results-page="prev"/);
  assert.match(html,/data-results-page="next"/);
});

// Verified RA-002 regression coverage retained during RA-003 reconciliation.
test('v4.9 Results preserve unknown Recruitment Fit and recorded contact history',()=>{
  const row=CompanyUI.buildCandidateRows([{userId:'404',domain:'company',pipelineStage:'Rejected',outcomes:[{kind:'declined',at:123}],availability:'Unknown'}],[{userId:'404',name:'Delta',recruitmentFit:null}],{eligibilityFor})[0];
  const html=CompanyUI.renderCandidates([row],{layout:'expanded'});
  assert.doesNotMatch(html,/>0\.0<\/td>/);
  assert.match(html,/>Contacted<\/td>/);
});

test('Company candidate rows preserve unmeasured eligibility as null',()=>{
  const rows=CompanyUI.buildCandidateRows(
    [{userId:'505',domain:'company',pipelineStage:'Not Contacted',availability:'Unknown'}],
    [{userId:'505',name:'Unknown',fit:null}],
    {eligibilityFor:()=>({eligibility:'Unknown',score:null,hardFailed:false})}
  );
  assert.equal(rows[0].eligibility,'Unknown');
  assert.equal(rows[0].eligibilityScore,null);
});
