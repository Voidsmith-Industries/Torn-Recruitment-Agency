// TDD regression contract for the approved private-chat Recruit workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/v45-messaging');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function memoryStorage() {
  const values = new Map();
  return {
    getItem:key => values.has(key) ? values.get(key) : null,
    setItem:(key,value) => values.set(key, String(value)),
    removeItem:key => values.delete(key)
  };
}

test('Company and Faction recruitment templates use separate approved placeholders', () => {
  assert.deepEqual(M.COMPANY_RECRUITMENT_PLACEHOLDERS, ['name','company_name','company_type']);
  assert.deepEqual(M.FACTION_RECRUITMENT_PLACEHOLDERS, ['name','faction_name']);

  assert.equal(
    M.prepareRecruitmentMessage('company', 'Hello {name}. {company_name} is a {company_type} company.', {
      name:'Alice', company_name:'Bad Decisions', company_type:'Adult Novelties'
    }),
    'Hello Alice. Bad Decisions is a Adult Novelties company.'
  );
  assert.equal(
    M.prepareRecruitmentMessage('faction', 'Hello {name}. Join {faction_name}.', {
      name:'Bob', faction_name:'Silent Ledger'
    }),
    'Hello Bob. Join Silent Ledger.'
  );
});

test('fresh Company and Faction eligibility is conservative', () => {
  assert.deepEqual(M.companyRecruitmentEligibility({job:{type:'company',name:'Acme',id:42}}), {
    eligible:false,currentName:'Acme',currentId:'42'
  });
  assert.equal(M.companyRecruitmentEligibility({job:{type:'job',name:'Army'}}).eligible, true);
  assert.equal(M.companyRecruitmentEligibility({job:null}).eligible, true);

  assert.deepEqual(M.factionRecruitmentEligibility({faction:{name:'Existing Faction',id:77}}), {
    eligible:false,currentName:'Existing Faction',currentId:'77'
  });
  assert.equal(M.factionRecruitmentEligibility({faction:null}).eligible, true);
});

test('Recruit prepares Torn private chat, never Torn Mail and never auto-submits', () => {
  const plan = M.recruitmentChatPlan('company', 'Hello {name}, join {company_name}.', {
    userId:123, name:'Alice', company_name:'Bad Decisions', company_type:'Adult Novelties'
  });
  assert.equal(plan.userId, '123');
  assert.equal(plan.preparedText, 'Hello Alice, join Bad Decisions.');
  assert.equal(plan.profileUrl, 'https://www.torn.com/profiles.php?XID=123');
  assert.equal(plan.transport, 'private-chat');
  assert.equal(plan.autoSubmit, false);
  assert.equal(plan.stageChange, null);
  assert.ok(!plan.profileUrl.includes('messages.php'));
  assert.ok(plan.preparedText.length <= M.TORN_CHAT_MAX_LENGTH);
});

test('private-chat draft handoff is target-scoped, one-shot and short-lived', () => {
  const storage = memoryStorage();
  const plan = M.recruitmentChatPlan('faction', 'Hello {name}, join {faction_name}.', {
    userId:456, name:'Bob', faction_name:'Silent Ledger'
  });
  M.queuePrivateChatDraft(plan, storage, 1000);
  assert.equal(M.consumePrivateChatDraft('999', storage, 1100), null);
  assert.equal(M.consumePrivateChatDraft('456', storage, 1100).preparedText, 'Hello Bob, join Silent Ledger.');
  assert.equal(M.consumePrivateChatDraft('456', storage, 1100), null);

  M.queuePrivateChatDraft(plan, storage, 2000);
  assert.equal(M.consumePrivateChatDraft('456', storage, 2000 + M.PRIVATE_CHAT_DRAFT_TTL_MS + 1), null);
});

test('settings expose separate editable Company and Faction recruitment defaults', () => {
  const app = read('src/v45-app.js');
  for (const marker of [
    'ra-setting-company-type',
    'ra-setting-company-message',
    'ra-setting-faction-name',
    'ra-setting-faction-message'
  ]) assert.match(app, new RegExp(marker));
  assert.match(app, /companyRecruitmentMessage/);
  assert.match(app, /factionRecruitmentMessage/);
});

test('Company and Faction candidate actions are Recruit actions backed by fresh official v2 checks', () => {
  const app = read('src/v45-app.js');
  const companyUi = read('src/v46-company-ui.js');
  const companyPlatform = read('src/v46-company-platform.js');
  const factionUi = read('src/v47-faction-ui.js');
  const factionPlatform = read('src/v47-faction-platform.js');

  assert.match(companyUi, /data-company-recruit=/);
  assert.match(companyUi, />Message</);
  assert.match(factionUi, /data-faction-recruit=/);
  assert.match(factionUi, />Message</);

  assert.match(companyPlatform, /recruitCandidate\?\.\('company'/);
  assert.match(factionPlatform, /recruitCandidate\?\.\('faction'/);
  assert.match(app, /user\/\$\{targetId\}\/job/);
  assert.match(app, /user\/\$\{targetId\}\/faction/);
  assert.match(app, /Messaging\.queuePrivateChatDraft/);
  assert.match(app, /Messaging\.consumePrivateChatDraft/);
});

test('DNC override paths fail closed when confirmation UI is unavailable',()=>{
  const companyPlatform=read('src/v46-company-platform.js');
  const factionPlatform=read('src/v47-faction-platform.js');
  assert.match(companyPlatform,/override confirmation is unavailable\. Recruitment stopped/);
  assert.match(factionPlatform,/override confirmation is unavailable\. Recruitment stopped/);
  assert.match(companyPlatform,/typeof globalThis\.confirm!=='function'\)throw/);
  assert.match(factionPlatform,/typeof globalThis\.confirm!=='function'\)throw/);
});
