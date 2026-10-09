const test=require('node:test');
const assert=require('node:assert/strict');

let OpportunityUI=null;
try{OpportunityUI=require('../src/v47-faction-opportunity-ui');}catch{}
function ui(){assert.ok(OpportunityUI,'Faction Opportunity UI module should exist');return OpportunityUI;}

const NOW=Date.parse('2026-08-25T12:00:00Z');
const weights={match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10};

function row(overrides={}){
  return {
    userId:'101',name:'Alpha',pipelineStage:'Evaluating',baselineEligibility:'Eligible',baselineScore:72,
    availability:'Available',fit:91,ee:120000,level:75,lastActive:NOW-2*3600000,
    activity30:100,xanax30:40,refills30:25,attacks30:300,rwHits30:80,networth:900000000,
    pinnedSpecialistProfileId:'chain',suggestedProfileId:'rw',
    profileEvaluations:[
      {profileId:'rw',matchScore:96,eligible:true,eligibility:'Eligible'},
      {profileId:'chain',matchScore:81,eligible:true,eligibility:'Eligible'}
    ],
    profileOptions:[
      {profileId:'rw',name:'RW Fighter',matchScore:96,eligible:true},
      {profileId:'chain',name:'Chain Specialist',matchScore:81,eligible:true}
    ],
    factionRecord:{userId:'101',pipelineStage:'Evaluating',followUps:[{followUpId:'f1',dueAt:NOW-1000,state:'open'}],doNotContact:false},
    player:{userId:'101',name:'Alpha',lastScoutAt:NOW-3*3600000,currentCompany:'Example Co'},
    ...overrides
  };
}

test('Faction Opportunity uses the valid manual specialist pin before automatic suggestion and baseline',()=>{
  const model=ui().buildOpportunityRows([row()],{weights,now:NOW});
  assert.equal(model[0].selectedMatchSource,'Pinned specialist');
  assert.equal(model[0].selectedProfileId,'chain');
  assert.equal(model[0].selectedProfileName,'Chain Specialist');
  assert.equal(model[0].selectedMatchScore,81);
});

test('without a valid pin Faction Opportunity uses the best eligible active specialist result',()=>{
  const model=ui().buildOpportunityRows([row({pinnedSpecialistProfileId:'missing'})],{weights,now:NOW});
  assert.equal(model[0].selectedMatchSource,'Suggested specialist');
  assert.equal(model[0].selectedProfileId,'rw');
  assert.equal(model[0].selectedMatchScore,96);
});

test('without an eligible specialist Faction Opportunity falls back to Faction Baseline score',()=>{
  const candidate=row({
    pinnedSpecialistProfileId:'',suggestedProfileId:'',
    profileEvaluations:[{profileId:'rw',matchScore:99,eligible:false,eligibility:'NOT ELIGIBLE'}],
    profileOptions:[{profileId:'rw',name:'RW Fighter',matchScore:99,eligible:false}],
    baselineScore:64,baselineEligibility:'Eligible by Waiver'
  });
  const model=ui().buildOpportunityRows([candidate],{weights,now:NOW});
  assert.equal(model[0].selectedMatchSource,'Faction Baseline');
  assert.equal(model[0].selectedProfileId,'');
  assert.equal(model[0].selectedMatchScore,64);
  assert.equal(model[0].baselineEligibility,'Eligible by Waiver');
});

test('Faction Opportunity ranking is deterministic and fully explainable without mutating Faction stage',()=>{
  const beta=row({userId:'202',name:'Beta',fit:65,pinnedSpecialistProfileId:'',suggestedProfileId:'',profileEvaluations:[],profileOptions:[],baselineScore:55,factionRecord:{userId:'202',pipelineStage:'Contacted',followUps:[],doNotContact:false},pipelineStage:'Contacted',player:{userId:'202',lastScoutAt:NOW-80*3600000}});
  const source=[row(),beta];
  const before=JSON.stringify(source);
  const first=ui().buildOpportunityRows(source,{weights,now:NOW});
  const second=ui().buildOpportunityRows(source,{weights,now:NOW});
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(item=>item.userId),['101','202']);
  assert.match(first[0].opportunity.explanation,/Match:/);
  assert.match(first[0].opportunity.explanation,/Freshness:/);
  assert.equal(JSON.stringify(source),before);
  assert.equal(source[0].pipelineStage,'Evaluating');
});

test('DNC applies a contact penalty without changing Faction Baseline eligibility',()=>{
  const candidate=row({baselineEligibility:'Eligible',factionRecord:{userId:'101',pipelineStage:'Evaluating',followUps:[],doNotContact:true}});
  const result=ui().buildOpportunityRows([candidate],{weights,now:NOW})[0];
  assert.equal(result.baselineEligibility,'Eligible');
  assert.ok(result.opportunity.penalty>0);
});

test('Faction Opportunity page displays selected match source and breakdown',()=>{
  const html=ui().renderOpportunityPage(ui().buildOpportunityRows([row()],{weights,now:NOW}));
  assert.match(html,/Faction Opportunity Queue/);
  assert.match(html,/Pinned specialist/);
  assert.match(html,/Chain Specialist/);
  assert.match(html,/Match:/);
  assert.match(html,/Freshness:/);
  assert.doesNotMatch(html,/Vacancy/);
  assert.doesNotMatch(html,/Salary/);
});

test('Faction Compare exposes shared facts and Faction results only and caps four unique selections',()=>{
  const rows=[
    row({userId:'101',name:'Alpha'}),
    row({userId:'202',name:'Beta'}),
    row({userId:'303',name:'Gamma'}),
    row({userId:'404',name:'Delta'}),
    row({userId:'505',name:'Epsilon'})
  ];
  const selected=ui().buildCompareRows(rows,['101','202','303','404','505','101']);
  assert.deepEqual(selected.map(item=>item.userId),['101','202','303','404']);
  assert.equal(Object.hasOwn(selected[0],'expectedSalary'),false);
  assert.equal(Object.hasOwn(selected[0],'vacancy'),false);
  assert.equal(Object.hasOwn(selected[0],'companyRecord'),false);
  assert.equal(selected[0].baselineEligibility,'Eligible');
  assert.equal(selected[0].pipelineStage,'Evaluating');
  assert.equal(selected[0].pinnedSpecialistProfileId,'chain');
  const html=ui().renderComparePage(rows,['101','202','303','404','505']);
  assert.match(html,/Faction Compare/);
  assert.match(html,/data-faction-compare-select="101"/);
  assert.match(html,/Faction Baseline/);
  assert.match(html,/Specialist Profile/);
  assert.doesNotMatch(html,/Expected Salary/);
  assert.doesNotMatch(html,/Vacancy/);
});


test('Faction Opportunity excludes unknown evidence instead of manufacturing baseline scores',()=>{
  const unknown=row({availability:'Unknown',fit:null,lastActive:null,baselineScore:null,pinnedSpecialistProfileId:'',suggestedProfileId:'',profileEvaluations:[],profileOptions:[],player:{userId:'101'},factionRecord:{userId:'101',pipelineStage:'Prospect',followUps:[],doNotContact:false}});
  const result=ui().buildOpportunityRows([unknown],{weights,now:NOW})[0];
  const byLabel=Object.fromEntries(result.opportunity.breakdown.map(item=>[item.label,item]));
  for(const label of ['Match','Fit','Availability','Activity','Freshness'])assert.equal(byLabel[label].known,false,label);
  assert.equal(result.selectedMatchScore,null);
  assert.equal(result.intelligenceFreshness,'Unknown');
  assert.match(result.opportunity.explanation,/Match: Unknown \(excluded\)/);
});
