const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/v46-domain-core');

test('shared player identity accepts facts and drops recruitment-private fields', () => {
  const row = D.mergePlayerIntelligence(null, {userId:3877028,name:'Alpha',level:42,currentCompany:'Pub',recruiterNote:'PRIVATE',expectedSalary:5000000,pipelineStage:'Replied',waiverReason:'PRIVATE'}, 'scout', 1000);
  assert.equal(row.userId, '3877028');assert.equal(row.name, 'Alpha');assert.equal(row.level, 42);assert.equal(row.currentCompany, 'Pub');for (const key of ['recruiterNote','expectedSalary','pipelineStage','waiverReason']) assert.equal(Object.hasOwn(row,key), false, `${key} must not enter shared intelligence`);
});

test('shared identity normalizes a positive Torn userId', () => {assert.equal(D.normalizeUserId(3877028), '3877028');assert.throws(() => D.normalizeUserId('abc'), /valid Torn player ID/i);assert.throws(() => D.normalizeUserId(0), /valid Torn player ID/i);});

test('name history records real observed name changes without duplicates', () => {const a = D.mergePlayerIntelligence(null,{userId:1,name:'Alpha'},'manual',1000);const b = D.mergePlayerIntelligence(a,{userId:1,name:'Alpha'},'scout',1500);const c = D.mergePlayerIntelligence(b,{userId:1,name:'Beta'},'scout',2000);assert.deepEqual(c.nameHistory,[{name:'Alpha',observedAt:1000},{name:'Beta',observedAt:2000}]);assert.deepEqual(c.sources,['manual','scout']);assert.equal(c.createdAt,1000);assert.equal(c.updatedAt,2000);});

test('company and faction records remain independently shaped', () => {const company = D.normalizeCompanyRecruitment({userId:1,pipelineStage:'Replied',recruiterNote:'company note',expectedSalary:123},1000,{});const faction = D.normalizeFactionRecruitment({userId:1,pipelineStage:'Evaluating',recruiterNote:'faction note',expectedSalary:999},1000,{});assert.equal(company.domain,'company');assert.equal(faction.domain,'faction');assert.equal(company.pipelineStage,'Replied');assert.equal(faction.pipelineStage,'Evaluating');assert.equal(company.expectedSalary,123);assert.equal(Object.hasOwn(faction,'expectedSalary'),false);assert.equal(company.recruiterNote,'company note');assert.equal(faction.recruiterNote,'faction note');});

test('Company workflow normalization preserves vacancy pinning and per-requirement waivers locally', () => {const row=D.normalizeCompanyRecruitment({userId:1,pinnedVacancyId:'vacancy-7',waivers:[{requirementId:'ee-min',state:'active',reason:'Approved exception'}]},1000,{});assert.equal(row.pinnedVacancyId,'vacancy-7');assert.deepEqual(row.waivers,[{requirementId:'ee-min',state:'active',reason:'Approved exception'}]);});

test('Company workflow normalization preserves stage timing and separate system versus recruiter timeline history', () => {const row=D.normalizeCompanyRecruitment({userId:1,stageChangedAt:900,timelineEvents:[{eventId:'s1',type:'stage-changed',at:900}],timelineNotes:[{noteId:'n1',text:'keep',at:950}]},1000,{});assert.equal(row.stageChangedAt,900);assert.equal(row.timelineEvents.length,1);assert.equal(row.timelineEvents[0].eventId,'s1');assert.equal(row.timelineEvents[0].type,'stage-changed');assert.equal(row.timelineEvents[0].at,900);assert.deepEqual(row.timelineNotes,[{noteId:'n1',text:'keep',at:950}]);});

test('Company workflow normalization preserves explicit Talent Pool state and reason', () => {const row=D.normalizeCompanyRecruitment({userId:1,talentPool:true,talentPoolReason:'Future trainer',talentPoolChangedAt:980},1000,{});assert.equal(row.talentPool,true);assert.equal(row.talentPoolReason,'Future trainer');assert.equal(row.talentPoolChangedAt,980);});

test('legacy provenance classifies company-only faction-only both and unknown records', () => {assert.deepEqual(D.classifyLegacyDomains({userId:1,discoverySources:['COMPANY FORUM']},[]),['company']);assert.deepEqual(D.classifyLegacyDomains({userId:2,discoverySources:['FACTION FORUM']},[]),['faction']);assert.deepEqual(D.classifyLegacyDomains({userId:3,discoverySources:['COMPANY FORUM','FACTION FORUM']},[]),['company','faction']);assert.deepEqual(D.classifyLegacyDomains({userId:4,discoverySources:[]},[]),['company']);});

test('forum-source provenance supplements missing candidate discoverySources', () => {assert.deepEqual(D.classifyLegacyDomains({userId:9,discoverySources:[]},[{userId:9,sourceType:'FACTION FORUM'}]),['faction']);});

test('faction-only legacy stages map conservatively into faction stages', () => {const shortlisted=D.legacyCandidateToFaction({userId:1,pipelineStage:'Shortlisted',recruiterNote:'keep'},1000,{ambiguous:false});const hired=D.legacyCandidateToFaction({userId:2,pipelineStage:'Hired'},1000,{ambiguous:false});assert.equal(shortlisted.pipelineStage,'Evaluating');assert.equal(hired.pipelineStage,'Joined');assert.equal(shortlisted.recruiterNote,'keep');});

test('ambiguous cross-domain legacy workflow state is preserved but not guessed', () => {const source={userId:3,pipelineStage:'Replied',availability:'Available',recruiterNote:'legacy shared note',expectedSalary:5000000};const company=D.legacyCandidateToCompany(source,1000,{ambiguous:true});const faction=D.legacyCandidateToFaction(source,1000,{ambiguous:true});assert.equal(company.pipelineStage,'Not Contacted');assert.equal(faction.pipelineStage,'Prospect');assert.equal(company.migrationReviewRequired,true);assert.equal(faction.migrationReviewRequired,true);assert.equal(company.legacySharedState.pipelineStage,'Replied');assert.equal(faction.legacySharedState.recruiterNote,'legacy shared note');assert.equal(faction.legacySharedState.expectedSalary,5000000);});


test('lastObservedAt is monotonic and changes only from explicit observation patches',()=>{
  const first=D.mergePlayerIntelligence(null,{userId:1,name:'Alpha',lastObservedAt:2000},'api',2000);
  const older=D.mergePlayerIntelligence(first,{userId:1,name:'Alpha',lastObservedAt:1000},'legacy',3000);
  assert.equal(older.lastObservedAt,2000);
  const workflow=D.mergePlayerIntelligence(older,{userId:1,name:'Alpha'},'company-workflow',4000);
  assert.equal(workflow.lastObservedAt,2000);
  const newer=D.mergePlayerIntelligence(workflow,{userId:1,lastObservedAt:5000},'scout',5000);
  assert.equal(newer.lastObservedAt,5000);
});
