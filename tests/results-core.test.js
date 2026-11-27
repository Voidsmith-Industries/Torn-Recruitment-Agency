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

test('v4.5 exposes the exact six recruitment pipeline stages', () => {
  assert.deepEqual([...R.PIPELINE_STAGES], ['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
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
  assert.equal(result.score,null,'provenance and contact timing alone do not establish suitability');
  assert.equal(result.confidence,'Low','missing evidence should reduce confidence instead of fabricating zeros');
});

test('v4.9 failed hard criteria trump fractional Faction match, and one point is 1%', () => {
  const base={fit:90,lastActive:NOW-3600000,factionId:0,pipelineStage:'Prospect'};
  const ineligible=R.recruitmentFit({...base,eligibility:'NOT ELIGIBLE',eligibilityScore:50},{domain:'faction',nowMs:NOW});
  assert.equal(ineligible.components.find(x=>x.key==='eligibility').factor,0);
  const onePercent=R.recruitmentFit({...base,eligibilityScore:1},{domain:'faction',nowMs:NOW});
  assert.equal(onePercent.components.find(x=>x.key==='eligibility').factor,.01);
});

test('v4.9 Faction provenance excludes Company-only candidateLocal evidence', () => {
  const row={pipelineStage:'Prospect',factionRecord:{pipelineStage:'Prospect'},candidateLocal:{
    discoverySources:['COMPANY FORUM'],createdAt:NOW-1000,lastSeenAt:NOW
  }};
  const p=R.prospectProvenance(row,{domain:'faction',nowMs:NOW});
  assert.equal(p.sources.includes('Recruitment Forum'),false);
  assert.equal(p.firstDiscoveredAt,null);
  assert.equal(p.lastObservedAt,null);
  assert.equal(p.state,'Known Candidate');
});

test('v4.9 unset timestamps and terminal contact stage never fabricate evidence', () => {
  const noDate=R.prospectProvenance({pipelineStage:'Not Contacted',companyRecord:{createdAt:0,lastObservedAt:0}},{domain:'company',nowMs:NOW});
  assert.equal(noDate.freshness,'Unknown');
  assert.equal(noDate.state,'Known Candidate');
  for(const [domain,stage] of [['company','Hired'],['company','Rejected'],['faction','Joined']]){
    const result=R.recruitmentFit({pipelineStage:stage,lastContactAt:NOW-90*86400000,fit:85},{domain,nowMs:NOW});
    assert.equal(result.components.find(x=>x.key==='contact').factor,0);
  }
});

test('v4.9 Recruitment Fit remains unknown with only contact or discovery provenance', () => {
  for (const [domain, stage] of [['company','Not Contacted'],['faction','Prospect']]) {
    const empty=R.recruitmentFit({pipelineStage:stage},{domain,nowMs:NOW});
    assert.equal(empty.score,null,domain+': contact-only must not establish fit');
    const discovered=R.recruitmentFit({pipelineStage:stage,[domain+'Record']:{discoverySources:['TORN USER SEARCH'],updatedAt:NOW}},{domain,nowMs:NOW});
    assert.equal(discovered.score,null,domain+': discovery-only must not establish fit');
  }
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

test('v4.9 faction stages remain domain-native in prospect classification', () => {
  const evaluating=R.prospectProvenance({
    pipelineStage:'Evaluating',
    factionRecord:{domain:'faction',discoverySources:['MANUAL'],createdAt:NOW-86400000}
  },{domain:'faction',nowMs:NOW});
  assert.equal(R.domainStageOf({pipelineStage:'Evaluating',factionRecord:{domain:'faction'}},'faction'),'Evaluating');
  assert.equal(evaluating.state,'Active Lead');

  const joined=R.prospectProvenance({
    pipelineStage:'Joined',
    factionRecord:{domain:'faction',discoverySources:['FACTION FORUM'],createdAt:NOW-90*86400000}
  },{domain:'faction',nowMs:NOW});
  assert.equal(joined.state,'Known Candidate');
});

test('v4.9 eligibility labels never award credit to explicitly ineligible candidates', () => {
  const negative=R.recruitmentFit({
    userId:'901',eligibility:'NOT CURRENTLY ELIGIBLE',lastActive:NOW-3600000,currentCompany:'None',
    companyRecord:{domain:'company',discoverySources:['COMPANY FORUM'],createdAt:NOW}
  },{domain:'company',nowMs:NOW,useEligibility:true});
  const factor=negative.components.find(x=>x.key==='eligibility');
  assert.equal(factor.known,true);
  assert.equal(factor.factor,0);

  const ineligible=R.recruitmentFit({
    userId:'902',eligibility:'Ineligible',lastActive:NOW-3600000,currentCompany:'None',
    companyRecord:{domain:'company',discoverySources:['COMPANY FORUM'],createdAt:NOW}
  },{domain:'company',nowMs:NOW,useEligibility:true});
  assert.equal(ineligible.components.find(x=>x.key==='eligibility').factor,0);
});

test('v4.9 organization evidence respects authoritative zero and positive IDs when names are absent', () => {
  const noFaction=R.recruitmentFit({
    userId:'903',lastActive:NOW-3600000,player:{factionId:0},
    factionRecord:{domain:'faction',discoverySources:['TORN USER SEARCH'],createdAt:NOW}
  },{domain:'faction',nowMs:NOW,useEligibility:false});
  assert.equal(noFaction.components.find(x=>x.key==='organization').factor,1);

  const hasFaction=R.recruitmentFit({
    userId:'904',lastActive:NOW-3600000,player:{factionId:12345},
    factionRecord:{domain:'faction',discoverySources:['TORN USER SEARCH'],createdAt:NOW}
  },{domain:'faction',nowMs:NOW,useEligibility:false});
  assert.equal(hasFaction.components.find(x=>x.key==='organization').factor,.25);

  const noCompany=R.recruitmentFit({
    userId:'905',lastActive:NOW-3600000,playerRecord:{currentCompanyId:0},
    companyRecord:{domain:'company',discoverySources:['TORN USER SEARCH'],createdAt:NOW}
  },{domain:'company',nowMs:NOW,useEligibility:false});
  assert.equal(noCompany.components.find(x=>x.key==='organization').factor,1);
});

test('v4.9 repeat observation timestamp refreshes provenance without treating workflow edits as observations', () => {
  const row={
    userId:'906',
    pipelineStage:'Not Contacted',
    playerRecord:{lastObservedAt:NOW-3600000},
    companyRecord:{domain:'company',discoverySources:['TORN USER SEARCH'],createdAt:NOW-90*86400000,updatedAt:NOW}
  };
  const p=R.prospectProvenance(row,{domain:'company',nowMs:NOW});
  assert.equal(p.freshness,'Fresh');
  assert.equal(p.state,'Passive Prospect');
  assert.equal(p.lastObservedAt,NOW-3600000);
});
