const test = require('node:test');
const assert = require('node:assert/strict');

let Faction = null;
try {
  Faction = require('../src/v47-faction-core');
} catch {}

function requireFaction() {
  assert.ok(Faction, 'Faction recruitment core module should exist');
  return Faction;
}

test('Faction pipeline uses the approved independent stage order', () => {
  const Core = requireFaction();
  assert.deepEqual(Core.FACTION_STAGES, [
    'Prospect',
    'Contacted',
    'Replied',
    'Evaluating',
    'Invite Ready',
    'Joined',
    'Rejected',
    'Deferred'
  ]);
});

test('Faction baseline Hard failure blocks normal eligibility and individual waiver restores it', () => {
  const Core = requireFaction();
  const criteria = [
    { id: 'rw', field: 'rwHits30', operator: 'gte', value: 50, kind: 'Hard', label: 'RW hits' }
  ];

  const failed = Core.evaluateCriteria(criteria, { rwHits30: 20 }, []);
  assert.equal(failed.eligibility, 'NOT CURRENTLY ELIGIBLE');
  assert.equal(failed.hardFailed, true);
  assert.equal(failed.results[0].passed, false);
  assert.equal(failed.results[0].waived, false);

  const waived = Core.evaluateCriteria(criteria, { rwHits30: 20 }, [
    { requirementId: 'rw', context: 'baseline', state: 'Active' }
  ]);
  assert.equal(waived.eligibility, 'Eligible by Waiver');
  assert.equal(waived.hardFailed, false);
  assert.equal(waived.results[0].passed, false, 'waiver must not rewrite the underlying failed fact');
  assert.equal(waived.results[0].waived, true);
});

test('Preferred baseline failure lowers score but does not block eligibility', () => {
  const Core = requireFaction();
  const result = Core.evaluateCriteria([
    { id: 'level', field: 'level', operator: 'gte', value: 50, kind: 'Hard', weight: 1 },
    { id: 'fit', field: 'fit', operator: 'gte', value: 80, kind: 'Preferred', weight: 1 }
  ], { level: 75, fit: 60 }, []);

  assert.equal(result.eligibility, 'Eligible');
  assert.equal(result.hardFailed, false);
  assert.equal(result.score, 50);
});

test('specialist Hard failure preserves raw score while making only that profile ineligible', () => {
  const Core = requireFaction();
  const profile = {
    profileId: 'chain',
    name: 'Chain Specialist',
    status: 'Active',
    criteria: [
      { id: 'attacks', field: 'attacks30', operator: 'gte', value: 500, kind: 'Hard', weight: 1 }
    ]
  };

  const result = Core.evaluateSpecialistProfile(profile, { attacks30: 250 }, []);
  assert.equal(result.profileId, 'chain');
  assert.equal(result.eligible, false);
  assert.equal(result.matchScore, 50);
  assert.equal(result.criteria.hardFailed, true);
});

test('baseline waiver never waives a specialist requirement with the same requirement id', () => {
  const Core = requireFaction();
  const profile = {
    profileId: 'rw',
    name: 'RW Fighter',
    status: 'Active',
    criteria: [
      { id: 'activity', field: 'activity30', operator: 'gte', value: 90, kind: 'Hard' }
    ]
  };

  const result = Core.evaluateSpecialistProfile(profile, { activity30: 50 }, [
    { requirementId: 'activity', context: 'baseline', state: 'Active' }
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.criteria.results[0].waived, false);
});

test('specialist waiver is scoped to the matching specialist profile', () => {
  const Core = requireFaction();
  const profile = {
    profileId: 'rw',
    name: 'RW Fighter',
    status: 'Active',
    criteria: [
      { id: 'activity', field: 'activity30', operator: 'gte', value: 90, kind: 'Hard' }
    ]
  };

  const result = Core.evaluateSpecialistProfile(profile, { activity30: 50 }, [
    { requirementId: 'activity', profileId: 'rw', context: 'specialist', state: 'Active' }
  ]);
  assert.equal(result.eligible, true);
  assert.equal(result.criteria.results[0].passed, false);
  assert.equal(result.criteria.results[0].waived, true);
});

test('manual specialist pin survives a better automatic suggestion', () => {
  const Core = requireFaction();
  const profiles = [
    { profileId: 'rw', name: 'RW Fighter', status: 'Active' },
    { profileId: 'crime', name: 'Crime Specialist', status: 'Active' }
  ];
  const evaluations = [
    { profileId: 'rw', eligible: true, matchScore: 95 },
    { profileId: 'crime', eligible: true, matchScore: 80 }
  ];

  assert.deepEqual(Core.suggestSpecialistProfile(profiles, evaluations, 'crime'), {
    suggestedProfileId: 'rw',
    pinnedProfileId: 'crime',
    bestChanged: true
  });
});

test('inactive specialist profiles are ignored by automatic suggestion', () => {
  const Core = requireFaction();
  const result = Core.suggestSpecialistProfile([
    { profileId: 'paused', status: 'Paused' },
    { profileId: 'active', status: 'Active' }
  ], [
    { profileId: 'paused', eligible: true, matchScore: 100 },
    { profileId: 'active', eligible: true, matchScore: 70 }
  ], '');

  assert.equal(result.suggestedProfileId, 'active');
});

test('Faction opportunity exposes a deterministic explainable breakdown', () => {
  const Core = requireFaction();
  const result = Core.computeOpportunity({
    match: 90,
    fit: 80,
    availability: 'Available',
    lastActiveAgeHours: 4,
    intelligenceFreshness: 'Fresh',
    followUpDue: true,
    contactPenalty: 20
  }, {
    match: 30,
    fit: 20,
    availability: 15,
    activity: 15,
    freshness: 10,
    followUp: 10,
    contactPenalty: 10
  });

  assert.equal(result.score, 91);
  assert.match(result.explanation, /Match:/);
  assert.match(result.explanation, /Fit:/);
  assert.match(result.explanation, /Contact penalty: -2/);
});

test('Faction Today queue recognizes Replied, overdue follow-up, stale stage and high opportunity independently', () => {
  const Core = requireFaction();
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  const rows = Core.buildTodayQueue([
    {
      userId: '10',
      pipelineStage: 'Replied',
      stageChangedAt: now - 10 * 86400000,
      followUps: [{ followUpId: 'f1', dueAt: now - 1000, state: 'Pending' }]
    }
  ], {
    now,
    stageThresholds: { Replied: 7 },
    opportunities: { '10': 90 }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, 100);
  assert.deepEqual(rows[0].reasons, [
    'Reply waiting',
    'Overdue follow-up (1)',
    'Stale stage',
    'High opportunity'
  ]);
});


test('Faction specialist profiles preserve normalized saved Results filters', () => {
  const Core=requireFaction();
  const profile=Core.normalizeSpecialistProfile({
    profileId:'rw',name:'RW',status:'Active',
    searchFilters:{search:'  foo  ',minEnd:'100k',onlineStatus:'online',organizationPresence:'HAS'}
  });
  assert.equal(profile.searchFilters.search,'foo');
  assert.equal(profile.searchFilters.minEnd,'100k');
  assert.equal(profile.searchFilters.onlineStatus,'');
  assert.equal(profile.searchFilters.organizationPresence,'has');
  assert.deepEqual(Core.normalizeFactionSearchFilters({onlineStatus:'Online',organizationPresence:'none'}),{
    search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'Online',organization:'',organizationPresence:'none'
  });
});

// Verified RA-002 regression coverage retained during RA-003 reconciliation.
test('unknown Faction criteria and specialist evidence remain unscored',()=>{
  const Core=requireFaction();
  const criteria=[{id:'fit',field:'fit',operator:'gte',value:80,kind:'Preferred',weight:1}];
  const baseline=Core.evaluateCriteria(criteria,{fit:null},[]);
  assert.equal(baseline.score,null);
  assert.equal(baseline.results[0].known,false);
  const result=Core.evaluateSpecialistProfile({profileId:'unknown',name:'Unknown',status:'Active',criteria},{fit:null},[]);
  assert.equal(result.matchScore,null);
});


test('unknown hard Faction requirement is Unknown, not a failure',()=>{
  const Core=requireFaction();
  const criteria=[{id:'rw',field:'rwHits30',operator:'gte',value:50,kind:'Hard',weight:1}];
  const baseline=Core.evaluateCriteria(criteria,{rwHits30:null},[]);
  assert.equal(baseline.eligibility,'Unknown');
  assert.equal(baseline.hardFailed,false);
  assert.equal(baseline.hardFailures.length,0);
  assert.equal(baseline.unknownHard.length,1);
  assert.equal(baseline.failures.length,0);
  const profile=Core.evaluateSpecialistProfile({profileId:'u',name:'Unknown',status:'Active',criteria},{rwHits30:null},[]);
  assert.equal(profile.eligibility,'Unknown');
  assert.equal(profile.eligible,false);
  assert.equal(profile.matchScore,null);
});

test('Faction Opportunity is unknown when no substantive evidence is known',()=>{
  const Core=requireFaction();
  const result=Core.computeOpportunity({
    match:null,fit:null,availability:'Unknown',lastActiveAgeHours:null,intelligenceFreshness:'Unknown',followUpDue:false,contactPenalty:0
  },{match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});
  assert.equal(result.score,null);
  assert.equal(result.rawScore,null);
});
