const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/v45-candidates');

test('candidate view composes local recruiter fields ahead of parsed/source values', () => {
  const view = C.composeCandidateView({
    candidate:{userId:123,name:'Alice',pipelineStage:'Replied',availability:'Unavailable',desiredCompany:'Oil Rig',desiredRole:'Sales',expectedSalary:5000000,recruiterNote:'Strong'},
    source:{sourceId:'JOB:1',sourceType:'JOB SEEKER',forumUrl:'https://www.torn.com/forums.php?t=1',parsed:{desiredCompany:'Adult Novelties',desiredRole:'Manager',availability:'Available'}},
    result:{matchScore:91,fit:82,currentCompany:'Pub',stats:{man:10,int:20,end:30},ee:9}
  });
  assert.equal(view.pipelineStage,'Replied');
  assert.equal(view.availability,'Unavailable');
  assert.equal(view.desiredCompany,'Oil Rig');
  assert.equal(view.desiredRole,'Sales');
  assert.equal(view.expectedSalary,5000000);
  assert.equal(view.recruiterNote,'Strong');
  assert.equal(view.matchScore,91);
  assert.equal(view.fitScore,82);
});

