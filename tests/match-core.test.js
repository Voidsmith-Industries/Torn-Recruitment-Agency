const test = require('node:test');
const assert = require('node:assert/strict');
const MatchCore = require('../src/match-core');

test('positive numeric criteria scale linearly and cap at full weight', () => {
  assert.deepEqual(MatchCore.scoreNumeric(50, 100, 20), {known:true, earned:10, available:20, ratio:0.5});
  assert.deepEqual(MatchCore.scoreNumeric(150, 100, 20), {known:true, earned:20, available:20, ratio:1});
  assert.deepEqual(MatchCore.scoreNumeric(null, 100, 20), {known:false, earned:0, available:0, ratio:null});
});

test('salary rewards values at or below budget and degrades proportionally above it', () => {
  assert.equal(MatchCore.scoreSalary(2_000_000, 2_000_000, 15).earned, 15);
  assert.equal(MatchCore.scoreSalary(1_500_000, 2_000_000, 15).earned, 15);
  assert.equal(MatchCore.scoreSalary(4_000_000, 2_000_000, 20).earned, 10);
  assert.equal(MatchCore.scoreSalary(null, 2_000_000, 20).known, false);
});

test('categorical matching normalizes role/company/availability and excludes unknowns', () => {
  assert.equal(MatchCore.normalizeRole('  Sales   Assistant '), 'sales assistant');
  assert.equal(MatchCore.normalizeCompany('Adult Novelties'), 'adult_novelties');
  assert.equal(MatchCore.normalizeAvailability('Immediate'), 'immediate');

  assert.deepEqual(
    MatchCore.scoreCategorical(' Sales Assistant ', 'sales assistant', 10, MatchCore.normalizeRole),
    {known:true, earned:10, available:10, ratio:1}
  );
  assert.deepEqual(
    MatchCore.scoreCategorical('', 'sales assistant', 10, MatchCore.normalizeRole),
    {known:false, earned:0, available:0, ratio:null}
  );
});

test('manual candidate fields win over parser-derived values', () => {
  const merged = MatchCore.mergeCandidateValues({
    manual: {desiredRole:'Sales Assistant', expectedSalary:2_000_000},
    parsed: {desiredRole:'Manager', expectedSalary:1_000_000, availability:'Immediate'}
  });
  assert.equal(merged.desiredRole, 'Sales Assistant');
  assert.equal(merged.expectedSalary, 2_000_000);
  assert.equal(merged.availability, 'immediate');
});

test('normalizeCandidate preserves actual manual field values for future precedence', () => {
  const candidate = MatchCore.normalizeCandidate({
    userId:'123',
    manualFields:{desiredRole:'Sales Assistant',expectedSalary:2_000_000},
    parsed:{desiredRole:'Manager',expectedSalary:1_000_000,availability:'Immediate'}
  });
  assert.deepEqual(candidate.manualFields, {
    desiredCompany:'',
    desiredRole:'Sales Assistant',
    expectedSalary:2_000_000,
    availability:''
  });
  assert.equal(candidate.desiredRole, 'Sales Assistant');
  assert.equal(candidate.expectedSalary, 2_000_000);
  assert.equal(candidate.availability, 'immediate');
});

test('default profile is safe and normalized', () => {
  const profile = MatchCore.createDefaultProfile('Bad Decisions - Sales');
  assert.equal(profile.name, 'Bad Decisions - Sales');
  assert.ok(profile.profileId);
  assert.deepEqual(Object.keys(profile.criteria), MatchCore.CRITERIA_KEYS);
});

test('evaluateMatch excludes unknown enabled criteria from denominator', () => {
  const profile = MatchCore.normalizeProfile({
    profileId:'p1', name:'Sales', criteria:{
      ee:{enabled:true,target:10,weight:20},
      fit:{enabled:true,target:100,weight:20},
      salary:{enabled:true,max:2_000_000,weight:20}
    }
  });
  const result = MatchCore.evaluateMatch({
    row:{ee:8, fit:90},
    candidate:{expectedSalary:null},
    profile
  });
  assert.equal(result.availableWeight, 40);
  assert.equal(result.earnedWeight, 34);
  assert.equal(result.score, 85);
  assert.equal(result.knownCriteria, 2);
  assert.equal(result.enabledCriteria, 3);
});

test('evaluateMatch returns unmeasured when no enabled criterion is known', () => {
  const profile = MatchCore.normalizeProfile({profileId:'p2',name:'Role',criteria:{role:{enabled:true,value:'sales',weight:10}}});
  const result = MatchCore.evaluateMatch({row:{},candidate:{},profile});
  assert.equal(result.score, null);
  assert.equal(result.availableWeight, 0);
});


test('v4.9 match profiles preserve normalized local Company saved-search filters', () => {
  const profile=MatchCore.normalizeProfile({
    profileId:'sales-role',
    name:'Sales Role',
    searchFilters:{company:{
      search:'  alice  ',
      minEnd:'100k',
      minMan:'50k',
      minInt:'  ',
      onlineStatus:'Online',
      organization:'Acme',
      organizationPresence:'has'
    }}
  });
  assert.deepEqual(profile.searchFilters.company,{
    search:'alice',
    minEnd:'100k',
    minMan:'50k',
    minInt:'',
    onlineStatus:'Online',
    organization:'Acme',
    organizationPresence:'has'
  });
});

test('v4.9 saved-search normalization fails safe for unsupported status and presence values', () => {
  assert.deepEqual(MatchCore.normalizeCompanySearchFilters({
    onlineStatus:'Probably Online',
    organizationPresence:'mystery'
  }),{
    search:'',minEnd:'',minMan:'',minInt:'',
    onlineStatus:'',organization:'',organizationPresence:'any'
  });
});
