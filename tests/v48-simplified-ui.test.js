const test = require('node:test');
const assert = require('node:assert/strict');

const Navigation = require('../src/v46-navigation');
const CompanyUI = require('../src/v46-company-ui');
const FactionUI = require('../src/v47-faction-ui');

function byGroup(groups, id) {
  return groups.find(group => group.id === id) || { pages: [] };
}

test('v4.8 default navigation exposes only the core Company and Faction search/results surfaces', () => {
  const groups = Navigation.visibleGroups({ optionalModules: {} });
  assert.deepEqual(byGroup(groups, 'company-recruitment').pages.map(page => page.id), ['company-candidates']);
  assert.deepEqual(byGroup(groups, 'faction-recruitment').pages.map(page => page.id), ['faction-candidates']);
  assert.equal(groups.some(group => group.id === 'intelligence'), false);
  assert.equal(groups.some(group => group.id === 'application'), false);
});

test('v4.8 optional modules appear only when explicitly enabled', () => {
  const groups = Navigation.visibleGroups({
    optionalModules: {
      companyPipeline: true,
      companyFollowups: true,
      factionPipeline: true,
      scout: true,
      smartMatch: true,
      data: true
    }
  });
  assert.deepEqual(byGroup(groups, 'company-recruitment').pages.map(page => page.id), ['company-candidates'], 'removed workflow flags no longer add pages');
  assert.deepEqual(byGroup(groups, 'faction-recruitment').pages.map(page => page.id), ['faction-candidates']);
  assert.deepEqual(byGroup(groups, 'intelligence').pages.map(page => page.id), ['scout', 'smart-match']);
  assert.deepEqual(byGroup(groups, 'application').pages.map(page => page.id), ['data']);
});

test('Company search/results keeps END MAN INT, last-online activity and direct message action', () => {
  const html = CompanyUI.renderCandidates([{
    userId: '123', name: 'Candidate', pipelineStage: 'Not Contacted',
    man: 250000, int: 175000, end: 310000, lastActive: Date.now() - 5 * 60 * 1000,
    doNotContact: false
  }], { filters: { search: '', minEnd: '300k', minMan: '200k', minInt: '150k' }, total: 1 });
  assert.match(html, /id="ra-company-filter-end"/);
  assert.match(html, /id="ra-company-filter-man"/);
  assert.match(html, /id="ra-company-filter-int"/);
  assert.match(html, />Last Online</);
  assert.match(html, /5m ago/);
  assert.match(html, /data-company-recruit="123"[^>]*>Message</);
  assert.doesNotMatch(html, />Vacancy</);
  assert.doesNotMatch(html, />Salary</);
});

test('Faction search/results keeps END MAN INT, last-online activity and domain-specific direct message action', () => {
  const html = FactionUI.renderCandidates([{
    userId: '456', name: 'Faction Candidate', pipelineStage: 'Prospect',
    man: 99000, int: 88000, end: 77000, lastActive: Date.now() - 2 * 60 * 60 * 1000,
    doNotContact: false
  }], { filters: { search: '', minEnd: '', minMan: '', minInt: '' }, total: 1 });
  assert.match(html, /id="ra-faction-filter-end"/);
  assert.match(html, /id="ra-faction-filter-man"/);
  assert.match(html, /id="ra-faction-filter-int"/);
  assert.match(html, />Last Online</);
  assert.match(html, /2h ago/);
  assert.match(html, /data-faction-recruit="456"[^>]*>Message</);
  assert.doesNotMatch(html, />Specialist Profile</);
});

test('unknown Company and Faction work stats render as unknown rather than confirmed zero', () => {
  const company = CompanyUI.renderCandidates([{userId:'901',name:'Unknown Company',man:null,int:null,end:null,lastActive:null,doNotContact:false}], {filters:{},total:1});
  const faction = FactionUI.renderCandidates([{userId:'902',name:'Unknown Faction',man:null,int:null,end:null,lastActive:null,doNotContact:false}], {filters:{},total:1});
  assert.match(company, /<td>—<\/td><td>—<\/td><td>—<\/td>/);
  assert.match(faction, /<td>—<\/td><td>—<\/td><td>—<\/td>/);
  assert.doesNotMatch(company, /<td>0<\/td>/);
  assert.doesNotMatch(faction, /<td>0<\/td>/);
});
