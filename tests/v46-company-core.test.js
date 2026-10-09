const test=require('node:test');
const assert=require('node:assert/strict');
const Company=require('../src/v46-company-core.js');

const facts={
  man:5000,int:4000,end:3000,ee:8,fit:76,activity30:140,
  expectedSalary:2_000_000,availability:'Available',currentCompany:'Example Co',lastActive:Date.parse('2026-08-24T12:00:00Z')
};

test('baseline and vacancy criteria keep Hard and Preferred semantics separate',()=>{
  const baseline=Company.normalizeBaseline({criteria:[
    {id:'ee',field:'ee',operator:'gte',value:10,kind:'Hard',label:'EE 10+'},
    {id:'fit',field:'fit',operator:'gte',value:80,kind:'Preferred',label:'Fit 80+'}
  ]});
  const evaluation=Company.evaluateCriteria(baseline.criteria,facts,[]);
  assert.equal(evaluation.hardFailed,true);
  assert.equal(evaluation.eligibility,'NOT CURRENTLY ELIGIBLE');
  assert.deepEqual(evaluation.failures.map(v=>v.id),['ee','fit']);
  assert.deepEqual(evaluation.hardFailures.map(v=>v.id),['ee']);
  assert.equal(evaluation.score,0);
});

test('an active per-requirement waiver changes eligibility without falsifying the failed criterion',()=>{
  const criteria=[{id:'ee',field:'ee',operator:'gte',value:10,kind:'Hard',label:'EE 10+'}];
  const evaluation=Company.evaluateCriteria(criteria,facts,[{requirementId:'ee',state:'Active',reason:'Director exception'}]);
  assert.equal(evaluation.eligibility,'Eligible by Waiver');
  assert.equal(evaluation.results[0].passed,false);
  assert.equal(evaluation.results[0].waived,true);
  assert.equal(evaluation.results[0].effectivePass,true);
});

test('vacancy normalization enforces approved states and preserves one vacancy with multiple openings',()=>{
  const vacancy=Company.normalizeVacancy({id:'sales',name:'Sales Associate',role:'Sales',openings:3,status:'Open',criteria:[],weights:{fit:50,activity30:50}});
  assert.equal(vacancy.vacancyId,'sales');
  assert.equal(vacancy.openings,3);
  assert.equal(vacancy.status,'Open');
  assert.deepEqual(Company.VACANCY_STATES,['Draft','Open','Paused','Filled','Archived']);
  assert.equal(Company.normalizeVacancy({id:'x',name:'X',status:'nonsense'}).status,'Draft');
});

test('vacancy evaluation preserves raw Match when a Hard requirement makes the vacancy ineligible',()=>{
  const vacancy=Company.normalizeVacancy({id:'sales',name:'Sales',status:'Open',criteria:[
    {id:'ee',field:'ee',operator:'gte',value:10,kind:'Hard',weight:30},
    {id:'fit',field:'fit',operator:'gte',value:70,kind:'Preferred',weight:70}
  ]});
  const result=Company.evaluateVacancy(vacancy,facts,[]);
  assert.equal(result.eligibility,'NOT ELIGIBLE');
  assert.ok(result.matchScore>0,'raw Match remains useful even when Hard eligibility fails');
  assert.equal(result.hardFailed,true);
});

test('vacancy suggestion selects best eligible result but never overwrites a manual pin',()=>{
  const vacancies=[
    Company.normalizeVacancy({id:'a',name:'A',status:'Open'}),
    Company.normalizeVacancy({id:'b',name:'B',status:'Open'})
  ];
  const evaluations=[
    {vacancyId:'a',eligible:true,matchScore:70},
    {vacancyId:'b',eligible:true,matchScore:92}
  ];
  assert.deepEqual(Company.suggestVacancy(vacancies,evaluations,''),{suggestedVacancyId:'b',pinnedVacancyId:'',bestChanged:false});
  assert.deepEqual(Company.suggestVacancy(vacancies,evaluations,'a'),{suggestedVacancyId:'b',pinnedVacancyId:'a',bestChanged:true});
});

test('Opportunity is deterministic, weighted and fully explainable',()=>{
  const result=Company.computeOpportunity({
    match:90,fit:80,availability:'Available',lastActiveAgeHours:2,intelligenceFreshness:'Fresh',contactPenalty:10,followUpDue:true
  },{match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});
  assert.ok(result.score>=0&&result.score<=100);
  assert.equal(result.breakdown.length,7);
  assert.equal(result.breakdown.reduce((sum,row)=>sum+row.contribution,0),result.rawScore);
  assert.equal(result.score,Math.round(Math.max(0,Math.min(100,result.rawScore-result.penalty))));
  assert.match(result.explanation,/Match/);
});

test('stage aging warns but does not mutate pipeline stage',()=>{
  const record={pipelineStage:'Contacted',stageChangedAt:Date.parse('2026-08-14T12:00:00Z')};
  const status=Company.stageAgeStatus(record,{Contacted:5},Date.parse('2026-08-24T12:00:00Z'));
  assert.equal(status.stale,true);
  assert.equal(status.daysInStage,10);
  assert.equal(record.pipelineStage,'Contacted');
});

test('Today queue surfaces replies, overdue follow-ups, stale and opportunity work without changing records',()=>{
  const now=Date.parse('2026-08-24T12:00:00Z');
  const records=[
    {userId:'1',pipelineStage:'Replied',updatedAt:now-1000,followUps:[]},
    {userId:'2',pipelineStage:'Contacted',stageChangedAt:now-8*86400000,followUps:[{id:'f1',dueAt:now-1000,state:'Open'}]},
    {userId:'3',pipelineStage:'Not Contacted',newlyDiscoveredAt:now-1000,followUps:[]}
  ];
  const before=JSON.stringify(records);
  const queue=Company.buildTodayQueue(records,{now,stageThresholds:{Contacted:5},opportunities:{'3':88}});
  assert.deepEqual(queue.map(v=>v.userId),['1','2','3']);
  assert.ok(queue.find(v=>v.userId==='1').reasons.includes('Reply waiting'));
  assert.ok(queue.find(v=>v.userId==='2').reasons.some(v=>v.startsWith('Overdue follow-up')));
  assert.ok(queue.find(v=>v.userId==='2').reasons.includes('Stale stage'));
  assert.ok(queue.find(v=>v.userId==='3').reasons.includes('Newly discovered'));
  assert.ok(queue.find(v=>v.userId==='3').reasons.includes('High opportunity'));
  assert.equal(JSON.stringify(records),before);
});


test('unknown Company criteria and vacancy evidence remain unscored',()=>{
  const criteria=[{id:'fit',field:'fit',operator:'gte',value:80,kind:'Preferred',weight:1}];
  const baseline=Company.evaluateCriteria(criteria,{fit:null},[]);
  assert.equal(baseline.score,null);
  assert.equal(baseline.results[0].known,false);
  const vacancy=Company.normalizeVacancy({id:'unknown',name:'Unknown',status:'Open',criteria});
  const result=Company.evaluateVacancy(vacancy,{fit:null},[]);
  assert.equal(result.matchScore,null);
});
