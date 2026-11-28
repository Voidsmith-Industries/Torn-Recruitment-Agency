const test = require('node:test');
const assert = require('node:assert/strict');
const V45 = require('../src/v45-runtime');

test('candidate normalization uses exact six stages and explicit availability', () => {
  assert.deepEqual(V45.PIPELINE_STAGES, ['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  assert.deepEqual(V45.AVAILABILITY_VALUES, ['Available','Unavailable','Unknown']);
  const row = V45.normalizeCandidateRecord({userId:123,pipelineStage:'replied',availability:'available now',discoverySources:['company','company','manual']});
  assert.equal(row.userId, '123');
  assert.equal(row.pipelineStage, 'Replied');
  assert.equal(row.availability, 'Available');
  assert.deepEqual(row.discoverySources, ['company','manual']);
});

test('recruitment settings include stage and availability colour defaults plus one global message', () => {
  const settings = V45.normalizeRecruitmentSettings({});
  assert.deepEqual(Object.keys(settings.stageColors), V45.PIPELINE_STAGES);
  assert.deepEqual(Object.keys(settings.availabilityColors), V45.AVAILABILITY_VALUES);
  assert.match(settings.defaultMessage, /\{name\}/);
  assert.match(settings.defaultMessage, /\{looking_for\}/);
});

test('sanitized logs exclude private recruitment and credential-shaped fields', () => {
  const entry = V45.makeLogEntry('sync','page complete',{
    feedId:'company',
    pages:3,
    apiKey:'secret',
    key:'secret',
    recruiterNote:'private',
    forumBody:'private body',
    preparedMessage:'private message',
    safeStatus:'resume available'
  }, 123);
  assert.deepEqual(entry, {
    at:123,
    type:'sync',
    message:'page complete',
    details:{feedId:'company',pages:3,safeStatus:'resume available'}
  });
});

test('context help covers every kept major surface', () => {
  for (const key of ['discovery','sync','fillCompanies','messagePlayer','defaultMessage','data']) {
    assert.ok(V45.HELP_REGISTRY[key], `missing help registry entry: ${key}`);
  }
});
