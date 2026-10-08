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

test('Company overview summarizes active pipeline eligibility and vacancy coverage without mutating records',()=>{
  const companyBefore=structuredClone(company);
  const rows=CompanyUI.buildCandidateRows(company,players,{eligibilityFor});
  const overview=CompanyUI.buildOverviewModel(rows,[
    {vacancyId:'v1',name:'Sales',status:'Open',openings:2},
    {vacancyId:'v2',name:'Manager',status:'Filled',openings:1}
  ]);
  assert.equal(overview.totalCandidates,3);
  assert.equal(overview.activeCandidates,2);
  assert.equal(overview.stageCounts.Replied,1);
  assert.equal(overview.stageCounts.Hired,1);
  assert.equal(overview.eligible,2);
  assert.equal(overview.notCurrentlyEligible,1);
  assert.equal(overview.openVacancies,1);
  assert.equal(overview.openings,2);
  assert.deepEqual(company,companyBefore);
});

test('Company Today enriches core priority queue with shared identity while preserving workflow state',()=>{
  const before=structuredClone(company);
  const rows=CompanyUI.buildCandidateRows(company,players,{eligibilityFor});
  const today=CompanyUI.buildTodayModel(rows,{now:4000,stageThresholds:{Contacted:0},opportunities:{101:90,202:30}});
  assert.deepEqual(today.map(item=>item.userId),['101','202']);
  assert.equal(today[0].name,'Alpha');
  assert.ok(today[0].reasons.includes('Reply waiting'));
  assert.ok(today[1].reasons.some(reason=>reason.startsWith('Overdue follow-up')));
  assert.deepEqual(company,before);
});

test('Company pipeline buckets only Company records into the canonical domain stages',()=>{
  const rows=CompanyUI.buildCandidateRows(company,players,{eligibilityFor});
  const pipeline=CompanyUI.buildPipelineModel(rows);
  assert.deepEqual(Object.keys(pipeline),CompanyUI.COMPANY_STAGES);
  assert.deepEqual(pipeline.Replied.map(row=>row.userId),['101']);
  assert.deepEqual(pipeline.Contacted.map(row=>row.userId),['202']);
  assert.deepEqual(pipeline.Hired.map(row=>row.userId),['303']);
});

test('Company HTML renderers expose operational links and escaped player content',()=>{
  const rows=CompanyUI.buildCandidateRows([{...company[0]}],[{...players[0],name:'<Alpha>'}],{eligibilityFor});
  const overview=CompanyUI.renderOverview(CompanyUI.buildOverviewModel(rows,[{vacancyId:'v1',name:'Sales',status:'Open',openings:1}]));
  const today=CompanyUI.renderToday(CompanyUI.buildTodayModel(rows,{now:4000,opportunities:{101:90}}));
  const candidates=CompanyUI.renderCandidates(rows);
  const pipeline=CompanyUI.renderPipeline(CompanyUI.buildPipelineModel(rows));
  assert.match(overview,/data-go-page="company-today"/);
  assert.match(overview,/data-go-page="company-vacancies"/);
  assert.match(today,/Reply waiting/);
  assert.match(candidates,/&lt;Alpha&gt;/);
  assert.doesNotMatch(candidates,/<Alpha>/);
  assert.match(pipeline,/data-company-stage="Replied"/);
});


test('v4.9 Company results surface local recruitment profiles without adding a second profile system',()=>{
  const html=CompanyUI.renderCandidates([],{
    profiles:[
      {profileId:'sales',name:'Sales Role'},
      {profileId:'trainer',name:'Trainer Role'}
    ],
    activeProfileId:'trainer'
  });
  assert.match(html,/id="ra-company-profile-select"/);
  assert.match(html,/Sales Role/);
  assert.match(html,/value="trainer" selected/);
  assert.match(html,/id="ra-company-profile-apply"/);
  assert.match(html,/<option value=""[^>]*>No profile<\/option>/);
  assert.match(html,/id="ra-company-profile-clear"/);
  assert.match(html,/id="ra-company-profile-save-search"/);
  assert.match(html,/id="ra-company-profile-manage"/);
});


test('Company Results pagination shows filtered range without rendering the full result set',()=>{
  const rows=Array.from({length:2},(_,i)=>({userId:String(i+1),name:'C'+i,pipelineStage:'Not Contacted',prospectProvenance:{sources:[]}}));
  const html=CompanyUI.renderCandidates(rows,{total:350,filteredTotal:250,layout:'compact',pagination:{page:1,pageCount:3,start:100,end:102}});
  assert.match(html,/101-102 of 250/);
  assert.match(html,/data-results-page="prev"/);
  assert.match(html,/data-results-page="next"/);
});
