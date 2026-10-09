const test=require('node:test');
const assert=require('node:assert/strict');
const FactionCore=require('../src/v47-faction-core');

let FactionUI=null;
try{FactionUI=require('../src/v47-faction-ui');}catch{}
function ui(){assert.ok(FactionUI,'Faction UI module should exist');return FactionUI;}

const players=[
  {userId:'101',name:'Alpha',level:75,ee:120000,fit:92,lastActive:1000,activity30:110,attacks30:300,rwHits30:80},
  {userId:'202',name:'Beta',level:40,ee:80000,fit:74,lastActive:2000,activity30:70,attacks30:50,rwHits30:10}
];
const faction=[
  {userId:'101',domain:'faction',pipelineStage:'Replied',availability:'Available',followUps:[],waivers:[],pinnedSpecialistProfileId:'chain',archived:false,updatedAt:900},
  {userId:'202',domain:'faction',pipelineStage:'Evaluating',availability:'Unknown',followUps:[{dueAt:500,state:'open'}],waivers:[],archived:false,updatedAt:800}
];
const baseline={criteria:[{id:'level',field:'level',operator:'gte',value:50,kind:'Hard',label:'Level'}]};
const profiles=[
  {profileId:'rw',name:'RW Fighter',status:'Active',criteria:[{id:'rw',field:'rwHits30',operator:'gte',value:50,kind:'Hard'}]},
  {profileId:'chain',name:'Chain Specialist',status:'Active',criteria:[{id:'attacks',field:'attacks30',operator:'gte',value:500,kind:'Preferred'}]}
];

test('Faction candidate rows join shared intelligence and expose no Company workflow fields',()=>{
  const rows=ui().buildCandidateRows(faction,players,{baseline,profiles});
  assert.deepEqual(rows.map(row=>row.userId),['101','202']);
  assert.equal(rows[0].name,'Alpha');
  assert.equal(rows[0].pipelineStage,'Replied');
  assert.equal(rows[0].baselineEligibility,'Eligible');
  assert.equal(rows[1].baselineEligibility,'NOT CURRENTLY ELIGIBLE');
  assert.equal(rows[0].pinnedSpecialistProfileId,'chain');
  assert.equal(rows[0].suggestedProfileId,'rw');
  for(const forbidden of ['salary','expectedSalary','desiredRole','pinnedVacancyId','vacancyEvaluations','companyRecord'])assert.equal(Object.hasOwn(rows[0],forbidden),false,forbidden);
});

test('manual specialist pin is preserved while automatic best profile can change',()=>{
  const row=ui().buildCandidateRows([faction[0]],[players[0]],{baseline,profiles})[0];
  assert.equal(row.pinnedSpecialistProfileId,'chain');
  assert.equal(row.suggestedProfileId,'rw');
  assert.equal(row.bestProfileChanged,true);
  assert.equal(row.profileEvaluations.find(item=>item.profileId==='chain').matchScore,60);
});

test('Faction overview and Today models stay read-only and use Faction semantics',()=>{
  const before=structuredClone(faction);
  const rows=ui().buildCandidateRows(faction,players,{baseline,profiles});
  const overview=ui().buildOverviewModel(rows,profiles);
  assert.equal(overview.totalCandidates,2);
  assert.equal(overview.activeCandidates,2);
  assert.equal(overview.stageCounts.Replied,1);
  assert.equal(overview.stageCounts.Evaluating,1);
  assert.equal(overview.eligible,1);
  assert.equal(overview.notCurrentlyEligible,1);
  assert.equal(overview.activeProfiles,2);
  const today=ui().buildTodayModel(rows,{now:4000,stageThresholds:{Evaluating:0},opportunities:{101:90,202:20}});
  assert.deepEqual(today.map(item=>item.userId),['101','202']);
  assert.ok(today[0].reasons.includes('Reply waiting'));
  assert.ok(today[1].reasons.some(reason=>reason.startsWith('Overdue follow-up')));
  assert.deepEqual(faction,before);
});

test('Faction pipeline contains exactly the eight approved Faction stages and never Company-only stages',()=>{
  const U=ui();
  const rows=U.buildCandidateRows(faction,players,{baseline,profiles});
  const model=U.buildPipelineModel(rows);
  assert.deepEqual(Object.keys(model),FactionCore.FACTION_STAGES);
  assert.equal(Object.hasOwn(model,'Hired'),false);
  assert.equal(Object.hasOwn(model,'Shortlisted'),false);
  const html=U.renderPipeline(model);
  assert.match(html,/data-faction-stage="Invite Ready"/);
  assert.match(html,/data-faction-stage="Deferred"/);
  assert.doesNotMatch(html,/data-faction-stage="Hired"/);
});

test('Requirements page exposes Faction Baseline Hard Preferred controls and specialist lifecycle controls',()=>{
  const html=ui().renderRequirementsPage({config:{baseline},profiles});
  assert.match(html,/Faction Baseline/);
  assert.match(html,/Hard/);
  assert.match(html,/Preferred/);
  assert.match(html,/id="ra-faction-baseline-save"/);
  assert.match(html,/id="ra-faction-profile-new"/);
  assert.match(html,/data-faction-profile-save="rw"/);
  assert.match(html,/Draft/);
  assert.match(html,/Active/);
  assert.match(html,/Paused/);
  assert.match(html,/Archived/);
});

test('Faction HTML renderers escape player content and link only to Faction routes',()=>{
  const rows=ui().buildCandidateRows([faction[0]],[{...players[0],name:'<Alpha>'}],{baseline,profiles});
  const overview=ui().renderOverview(ui().buildOverviewModel(rows,profiles));
  const candidates=ui().renderCandidates(rows);
  assert.match(overview,/data-go-page="faction-today"/);
  assert.match(overview,/data-go-page="faction-requirements"/);
  assert.match(candidates,/&lt;Alpha&gt;/);
  assert.doesNotMatch(candidates,/<Alpha>/);
  assert.doesNotMatch(candidates,/company-/i);
});


test('v4.9 Faction Results keep unknown battle intelligence unknown and honor contact outcomes',()=>{
  const U=ui();
  const row=U.buildCandidateRows([{userId:'404',domain:'faction',pipelineStage:'Rejected',outcomes:[{kind:'declined',at:123}],availability:'Unknown'}],[{userId:'404',name:'Delta',recruitmentFit:null,attacks30:null,rwHits30:null}],{baseline,profiles})[0];
  const html=U.renderCandidates([row],{layout:'expanded'});
  assert.doesNotMatch(html,/0 \/ 0/);
  assert.doesNotMatch(html,/>0<\/td>/);
  assert.match(html,/>Contacted<\/td>/);
  const partial=U.renderCandidates([{...row,attacks30:12,rwHits30:null}],{layout:'expanded'});
  assert.match(partial,/12 \/ —/);
});
