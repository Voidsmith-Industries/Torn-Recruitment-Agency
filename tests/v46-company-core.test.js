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

test('unknown Company criteria remain unscored',()=>{
  const criteria=[{id:'fit',field:'fit',operator:'gte',value:80,kind:'Preferred',weight:1}];
  const baseline=Company.evaluateCriteria(criteria,{fit:null},[]);
  assert.equal(baseline.score,null);
  assert.equal(baseline.results[0].known,false);
});

test('unknown hard Company requirement is Unknown, not a failure',()=>{
  const criteria=[{id:'ee',field:'ee',operator:'gte',value:10,kind:'Hard',weight:1}];
  const baseline=Company.evaluateCriteria(criteria,{ee:null},[]);
  assert.equal(baseline.eligibility,'Unknown');
  assert.equal(baseline.hardFailed,false);
  assert.equal(baseline.hardFailures.length,0);
  assert.equal(baseline.unknownHard.length,1);
  assert.equal(baseline.failures.length,0);
});

