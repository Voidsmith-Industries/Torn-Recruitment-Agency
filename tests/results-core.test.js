const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/results-core.js');

function ids(rows) { return rows.map(r => r.userId); }

const NOW = Date.UTC(2026, 7, 15, 6, 0, 0);

function scout(id, overrides = {}) {
  return {
    userId: id,
    profile: {name:`User ${id}`, level:10, lastActionTs: Math.floor(NOW/1000)-3600, status:'Offline', factionId:0},
    w30: {activityHours:100, xanax:20, refills:10, attacks:30, rwHits:5},
    extra: {networth:1_000_000, activeStreak:5, bestActiveStreak:10, statEnhancers30:0},
    capturedAt: NOW - 60_000,
    official: true,
    currentFit: 50,
    trend: 2,
    ...overrides
  };
}

test('parseCompactNumber supports K/M/B and rejects junk', () => {
  assert.deepEqual(R.parseCompactNumber('50k'), {valid:true, empty:false, value:50000});
  assert.deepEqual(R.parseCompactNumber('2.5M'), {valid:true, empty:false, value:2500000});
  assert.deepEqual(R.parseCompactNumber('1b'), {valid:true, empty:false, value:1000000000});
  assert.deepEqual(R.parseCompactNumber('1,250'), {valid:true, empty:false, value:1250});
  assert.equal(R.parseCompactNumber('').empty, true);
  assert.equal(R.parseCompactNumber('potato').valid, false);
  assert.equal(R.parseCompactNumber('-5k').valid, false);
});

test('preferred company parser is conservative', () => {
  assert.equal(R.parsePreferredCompany('Looking for Adult Novelties, preferably 10*'), 'adult_novelties');
  assert.equal(R.parsePreferredCompany('Prefer AN, salary flexible'), 'adult_novelties');
  assert.equal(R.parsePreferredCompany('Looking for a logistics company'), 'logistics_management');
  assert.equal(R.parsePreferredCompany('Looking for 10* PSF'), 'private_security_firm');
  assert.equal(R.parsePreferredCompany('I used to work in AN but want anything'), '');
});

test('numeric sorting keeps missing values last in both directions', () => {
  const rows = [
    {userId:1,name:'Low',ee:7},
    {userId:2,name:'Missing',ee:null},
    {userId:3,name:'High',ee:10}
  ];
  assert.deepEqual(ids(R.sortRows(rows,{key:'ee',direction:'desc'},NOW)), [3,1,2]);
  assert.deepEqual(ids(R.sortRows(rows,{key:'ee',direction:'asc'},NOW)), [1,3,2]);
});

test('text, last active, scout status and deterministic ties sort correctly', () => {
  const rows = [
    {...scout(3), profile:{...scout(3).profile,name:'Zulu',lastActionTs:Math.floor(NOW/1000)-7200}},
    {...scout(2), profile:{...scout(2).profile,name:'Alpha',lastActionTs:Math.floor(NOW/1000)-60}},
    {...scout(1), profile:{...scout(1).profile,name:'Alpha',lastActionTs:Math.floor(NOW/1000)-3600}}
  ];
  assert.deepEqual(ids(R.sortRows(rows,{key:'player',direction:'asc'},NOW)), [1,2,3]);
  assert.deepEqual(ids(R.sortRows(rows,{key:'lastActive',direction:'asc'},NOW)), [2,1,3]);

  const statuses = [
    {...scout(10), capturedAt:NOW-15*86400000},
    {...scout(11), profile:{...scout(11).profile,status:'Online'}},
    {userId:12,name:'No Scout'},
    {...scout(13), official:false, provisionalSource:{activityHours:50}}
  ];
  assert.deepEqual(ids(R.sortRows(statuses,{key:'scoutStatus',direction:'asc'},NOW)), [11,13,10,12]);
});

test('filter combinations work across forum and scout fields', () => {
  const good = {
    userId:1,name:'Alice',stats:{man:60000,int:1000,end:2000,total:63000},ee:9,preferredCompany:'adult_novelties',
    scout:scout(1,{currentFit:82,w30:{activityHours:140,xanax:70,refills:25,attacks:220,rwHits:50},extra:{networth:2_000_000_000,activeStreak:12,bestActiveStreak:20,statEnhancers30:1}})
  };
  const bad = {
    userId:2,name:'Bob',stats:{man:1000,int:1000,end:1000,total:3000},ee:5,preferredCompany:'pub',scout:scout(2,{currentFit:40,w30:{activityHours:20,xanax:2,refills:1,attacks:5,rwHits:0}})
  };
  const filters = {search:'ali',minMan:'50k',minEe:'8',preferredCompany:'AN',minActivity30:'100',maxIdleDays:'1',minFit:'70',minNetworth:'1b',minXanax30:'60',minRefills30:'20',minAttacks30:'200',minRwHits30:'40'};
  assert.deepEqual(ids(R.applyFilters([bad,good],filters,NOW)), [1]);
  assert.equal(R.activeFilterCount(filters), 12);
});

test('processRows filters before sorting and does not mutate input', () => {
  const rows = [
    {userId:1,name:'A',ee:7},
    {userId:2,name:'B',ee:10},
    {userId:3,name:'C',ee:3}
  ];
  const original = [...rows];
  const out = R.processRows(rows,{minEe:'7'},{key:'ee',direction:'desc'},NOW);
  assert.deepEqual(ids(out), [2,1]);
  assert.deepEqual(rows, original);
});

test('v4.5 default columns are recruitment first and compact', () => {
  assert.deepEqual([...R.DEFAULT_VISIBLE_COLUMNS], ['player','pipelineStage','match','fit','lookingFor','sourceType','lastActive']);
  assert.deepEqual(R.DEFAULT_SORT, {key:'match',direction:'desc'});
});

test('v4.5 exposes the exact six recruitment pipeline stages', () => {
  assert.deepEqual([...R.PIPELINE_STAGES], ['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
});

test('Match filtering and sorting keeps unmeasured Match last', () => {
  const rows = [
    {userId:1,name:'A',matchScore:88},
    {userId:2,name:'B',matchScore:null},
    {userId:3,name:'C',matchScore:72}
  ];
  assert.deepEqual(ids(R.applyFilters(rows, {minMatch:'80'}, NOW)), [1]);
  assert.deepEqual(ids(R.sortRows(rows, {key:'match',direction:'desc'}, NOW)), [1,3,2]);
});

test('pipeline stage filter uses candidateLocal without inventing a second authority', () => {
  const rows = [
    {userId:1,name:'A',candidateLocal:{pipelineStage:'Shortlisted'}},
    {userId:2,name:'B',candidateLocal:{pipelineStage:'Replied'}},
    {userId:3,name:'C',candidateLocal:{}}
  ];
  assert.deepEqual(ids(R.applyFilters(rows, {pipelineStage:'Replied'}, NOW)), [2]);
  assert.equal(R.pipelineStageOf(rows[2]), 'Not Contacted');
});

test('source filter accepts direct and candidate discovery source provenance', () => {
  const rows = [
    {userId:1,name:'A',sourceType:'TRAIN BUYER'},
    {userId:2,name:'B',candidateLocal:{discoverySources:['JOB SEEKER','COMPANY FORUM']}},
    {userId:3,name:'C'}
  ];
  assert.deepEqual(ids(R.applyFilters(rows, {sourceType:'TRAIN BUYER'}, NOW)), [1]);
  assert.deepEqual(ids(R.applyFilters(rows, {sourceType:'COMPANY FORUM'}, NOW)), [2]);
});

test('current company and looking-for filters are case-insensitive contains matches', () => {
  const rows = [
    {userId:1,name:'A',currentCompany:'Bad Decisions',candidateLocal:{desiredRole:'Sales Assistant'}},
    {userId:2,name:'B',currentCompany:'Other Place',candidateLocal:{desiredCompany:'Adult Novelties'}}
  ];
  assert.deepEqual(ids(R.applyFilters(rows, {currentCompany:'bad dec'}, NOW)), [1]);
  assert.deepEqual(ids(R.applyFilters(rows, {lookingFor:'adult'}, NOW)), [2]);
});

test('active-only uses explicit inactive state first and then last activity age', () => {
  const recent = {...scout(1), candidateLocal:{active:true}};
  const old = {...scout(2), profile:{...scout(2).profile,lastActionTs:Math.floor(NOW/1000)-45*86400}};
  const disabled = {...scout(3), candidateLocal:{active:false}};
  assert.deepEqual(ids(R.applyFilters([recent,old,disabled], {activeOnly:true,activeAgeDays:30}, NOW)), [1]);
});

test('unknown recruitment values behave predictably', () => {
  const row = {userId:1,name:'Unknown'};
  assert.equal(R.sourceTypeOf(row), '');
  assert.equal(R.currentCompanyOf(row), '');
  assert.equal(R.lookingForOf(row), '');
  assert.equal(R.availabilityOf(row), 'Unknown');
  assert.deepEqual(ids(R.applyFilters([row], {sourceType:'TRAIN BUYER'}, NOW)), []);
  assert.deepEqual(ids(R.applyFilters([row], {availability:'Unknown'}, NOW)), [1]);
});


test('v4.9 Recruitment Fit is deterministic, explainable and keeps Scout Fit separate', () => {
  const row = {
    userId:'77',
    name:'Prospect',
    man:120000,
    int:80000,
    end:60000,
    fit:74,
    eligibilityScore:88,
    lastActive:NOW - 2*3600000,
    currentOrganizationLabel:'None',
    pipelineStage:'Not Contacted',
    companyRecord:{
      domain:'company',
      discoverySources:['COMPANY FORUM'],
      createdAt:NOW-2*86400000,
      updatedAt:NOW-3600000
    }
  };
  const a=R.recruitmentFit(row,{domain:'company',nowMs:NOW,requirements:{minMan:100000,minInt:75000,minEnd:50000}});
  const b=R.recruitmentFit(row,{domain:'company',nowMs:NOW,requirements:{minMan:100000,minInt:75000,minEnd:50000}});
  assert.deepEqual(a,b);
  assert.ok(a.score>=0&&a.score<=100);
  assert.equal(a.confidence,'High');
  assert.equal(a.provenance.state,'Active Lead');
  assert.deepEqual([...a.provenance.sources],['Recruitment Forum']);
  assert.ok(a.components.some(x=>x.key==='scoutFit'&&x.reason.includes('separate metric')));
  assert.equal(row.fit,74,'existing Scout Fit must remain untouched');
});

test('v4.9 Recruitment Fit never converts missing evidence into zero', () => {
  const sparse = {
    userId:'88',
    name:'Sparse',
    pipelineStage:'Not Contacted',
    companyRecord:{domain:'company',discoverySources:['TORN USER SEARCH'],updatedAt:NOW}
  };
  const result=R.recruitmentFit(sparse,{domain:'company',nowMs:NOW,requirements:{minMan:100000,minInt:100000,minEnd:100000}});
  const requirements=result.components.find(x=>x.key==='requirements');
  const activity=result.components.find(x=>x.key==='activity');
  assert.equal(requirements.known,false);
  assert.equal(requirements.points,null);
  assert.equal(activity.known,false);
  assert.equal(activity.points,null);
  assert.ok(result.score>0,'known positive evidence should still produce a score');
  assert.equal(result.confidence,'Low','missing evidence should reduce confidence instead of fabricating zeros');
});

test('v4.9 provenance classifies active, passive, known and reactivation prospects deterministically', () => {
  const active=R.prospectProvenance({
    pipelineStage:'Not Contacted',
    companyRecord:{discoverySources:['COMPANY FORUM'],createdAt:NOW-86400000,updatedAt:NOW-1000}
  },{domain:'company',nowMs:NOW});
  assert.equal(active.state,'Active Lead');
  assert.equal(active.freshness,'Fresh');

  const passive=R.prospectProvenance({
    pipelineStage:'Not Contacted',
    companyRecord:{discoverySources:['WORK STAT LEADERBOARD'],createdAt:NOW-86400000,updatedAt:NOW-1000}
  },{domain:'company',nowMs:NOW});
  assert.equal(passive.state,'Passive Prospect');
  assert.deepEqual([...passive.sources],['Work-Stat Leaderboard']);

  const known=R.prospectProvenance({
    pipelineStage:'Hired',
    companyRecord:{discoverySources:['COMPANY FORUM'],createdAt:NOW-100*86400000,updatedAt:NOW-90*86400000}
  },{domain:'company',nowMs:NOW});
  assert.equal(known.state,'Known Candidate');

  const reactivation=R.prospectProvenance({
    pipelineStage:'Not Contacted',
    companyRecord:{discoverySources:['MANUAL'],createdAt:NOW-120*86400000,updatedAt:NOW-90*86400000}
  },{domain:'company',nowMs:NOW});
  assert.equal(reactivation.state,'Reactivation Candidate');
  assert.equal(reactivation.freshness,'Stale');
});

test('v4.9 Recruitment Fit respects Company/Faction organization context without mixing private workflow state', () => {
  const shared={fit:80,lastActive:NOW-3600000};
  const company=R.recruitmentFit({
    ...shared,currentCompany:'None',pipelineStage:'Not Contacted',
    companyRecord:{domain:'company',discoverySources:['COMPANY FORUM'],updatedAt:NOW}
  },{domain:'company',nowMs:NOW});
  const faction=R.recruitmentFit({
    ...shared,currentFaction:'Example Faction',pipelineStage:'Not Contacted',
    factionRecord:{domain:'faction',discoverySources:['FACTION FORUM'],updatedAt:NOW}
  },{domain:'faction',nowMs:NOW});
  const cOrg=company.components.find(x=>x.key==='organization');
  const fOrg=faction.components.find(x=>x.key==='organization');
  assert.equal(cOrg.factor,1);
  assert.equal(fOrg.factor,.25);
  assert.equal(company.provenance.state,'Active Lead');
  assert.equal(faction.provenance.state,'Active Lead');
});

test('v4.9 recent contact reduces prioritization but Do Not Contact is not falsified into Fit', () => {
  const base={
    fit:90,lastActive:NOW-3600000,currentCompany:'None',
    companyRecord:{domain:'company',discoverySources:['TORN USER SEARCH'],updatedAt:NOW}
  };
  const fresh=R.recruitmentFit({...base,pipelineStage:'Not Contacted'},{domain:'company',nowMs:NOW});
  const contacted=R.recruitmentFit({
    ...base,pipelineStage:'Contacted',
    companyRecord:{...base.companyRecord,outcomes:[{at:NOW-3600000,result:'Messaged'}],doNotContact:true}
  },{domain:'company',nowMs:NOW});
  assert.ok(contacted.score<fresh.score);
  assert.equal(contacted.components.find(x=>x.key==='contact').factor,.2);
  assert.equal(contacted.provenance.state,'Active Lead');
});
