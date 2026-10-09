// Torn.com game userscript tests. "Company recruitment" here refers only to the fictional Torn game mechanic.
const test=require('node:test');
const assert=require('node:assert/strict');
const OpportunityUI=require('../src/v46-company-opportunity-ui');
const Platform=require('../src/v46-company-platform');

const NOW=Date.parse('2026-08-25T12:00:00Z');
const weights={match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10};
const rows=[
  {userId:'101',name:'Alpha',pipelineStage:'Shortlisted',eligibility:'Eligible',availability:'Available',fit:91,ee:12,lastActive:NOW-2*3600000,playerRecord:{userId:'101',name:'Alpha',lastScoutAt:NOW-3*3600000,currentCompany:'Example Co'},companyRecord:{userId:'101',domain:'company',pipelineStage:'Shortlisted',followUps:[{followUpId:'f1',dueAt:NOW-1000,state:'open'}],doNotContact:false},pinnedVacancyId:'v1',suggestedVacancyId:'v1',vacancyEvaluations:[{vacancyId:'v1',matchScore:94,eligible:true,eligibility:'Eligible'}],vacancyOptions:[{vacancyId:'v1',name:'Trainer',matchScore:94,eligible:true}]},
  {userId:'202',name:'Beta',pipelineStage:'Contacted',eligibility:'Eligible by Waiver',availability:'Unknown',fit:78,ee:9,lastActive:NOW-30*3600000,playerRecord:{userId:'202',name:'Beta',lastScoutAt:NOW-80*3600000,currentCompany:'Other Co'},companyRecord:{userId:'202',domain:'company',pipelineStage:'Contacted',followUps:[],doNotContact:false},pinnedVacancyId:'',suggestedVacancyId:'v2',vacancyEvaluations:[{vacancyId:'v2',matchScore:82,eligible:true,eligibility:'Eligible by Waiver'}],vacancyOptions:[{vacancyId:'v2',name:'Sales',matchScore:82,eligible:true}]}
];

test('Opportunity queue is Torn Company-specific, deterministic and explainable from configurable weights',()=>{
  const first=OpportunityUI.buildOpportunityRows(rows,{weights,now:NOW});
  const second=OpportunityUI.buildOpportunityRows(rows,{weights,now:NOW});
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(row=>row.userId),['101','202']);
  assert.ok(first[0].opportunity.score>first[1].opportunity.score);
  assert.match(first[0].opportunity.explanation,/Match/);
  assert.equal(first[0].selectedVacancyId,'v1');
  assert.equal(first[0].selectedVacancyName,'Trainer');
  assert.equal(Object.hasOwn(first[0],'factionRecord'),false);
});

test('Opportunity page exposes score and breakdown without mutating Torn Company stage',()=>{
  const before=JSON.stringify(rows);
  const model=OpportunityUI.buildOpportunityRows(rows,{weights,now:NOW});
  const html=OpportunityUI.renderOpportunityPage(model);
  assert.match(html,/Company Opportunity Queue/);
  assert.match(html,/Alpha/);
  assert.match(html,/Trainer/);
  assert.match(html,/Match/);
  assert.match(html,/Freshness/);
  assert.equal(JSON.stringify(rows),before);
});

test('Compare presents selected Torn players side by side using shared facts and Company results only',()=>{
  const html=OpportunityUI.renderComparePage(rows,['101','202']);
  assert.match(html,/Company Compare/);
  assert.match(html,/Alpha/);
  assert.match(html,/Beta/);
  assert.match(html,/Example Co/);
  assert.match(html,/Eligible by Waiver/);
  assert.match(html,/Trainer/);
  assert.match(html,/Sales/);
  assert.doesNotMatch(html,/Faction/i);
  assert.match(html,/data-company-compare-select="101"/);
});

test('Task 8 Torn game routes are owned by the v4.6 Company platform',()=>{
  for(const route of ['company-opportunity','company-compare'])assert.equal(Platform._test.IMPLEMENTED_ROUTES.has(route),true,route);
});


test('Opportunity queue excludes unknown evidence instead of inventing neutral scores',()=>{
  const unknown={userId:'909',name:'Unknown',pipelineStage:'Not Contacted',eligibility:'Unknown',availability:'Unknown',fit:null,ee:null,lastActive:null,playerRecord:{userId:'909'},companyRecord:{userId:'909',domain:'company',pipelineStage:'Not Contacted',followUps:[],doNotContact:false},pinnedVacancyId:'',suggestedVacancyId:'',vacancyEvaluations:[],vacancyOptions:[]};
  const result=OpportunityUI.buildOpportunityRows([unknown],{weights,now:NOW})[0];
  const byLabel=Object.fromEntries(result.opportunity.breakdown.map(item=>[item.label,item]));
  for(const label of ['Match','Fit','Availability','Activity','Freshness'])assert.equal(byLabel[label].known,false,label);
  assert.equal(result.intelligenceFreshness,'Unknown');
  assert.match(result.opportunity.explanation,/Match: Unknown \(excluded\)/);
});


test('Company Opportunity renders excluded evidence as unknown, never zero',()=>{
  const unknown={userId:'910',name:'Unknown Render',pipelineStage:'Not Contacted',eligibility:'Unknown',availability:'Unknown',fit:null,lastActive:null,playerRecord:{userId:'910'},companyRecord:{userId:'910',domain:'company',followUps:[],doNotContact:false},vacancyEvaluations:[{vacancyId:'v0',matchScore:null,eligible:true}],vacancyOptions:[{vacancyId:'v0',name:'Unknown Vacancy'}],suggestedVacancyId:'v0'};
  const model=OpportunityUI.buildOpportunityRows([unknown],{weights,now:NOW});
  const html=OpportunityUI.renderOpportunityPage(model);
  assert.match(html,/Match: —/);
  assert.match(html,/Fit: —/);
  assert.match(html,/Match: — \(excluded\)/);
  assert.match(html,/Fit: — \(excluded\)/);
  assert.doesNotMatch(html,/Match: —[^<]*= 0/);
  assert.doesNotMatch(html,/Fit: —[^<]*= 0/);
  assert.doesNotMatch(html,/Match: 0/);
  assert.doesNotMatch(html,/Fit: 0/);
});
