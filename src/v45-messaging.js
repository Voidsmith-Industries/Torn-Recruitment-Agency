(function (root, factory) {
  let forum = root && root.RA_ForumCore;
  if (!forum && typeof module === 'object' && module.exports) forum = require('./forum-core');
  const api = factory(forum);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Messaging = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ForumCore) {
  'use strict';
  if (!ForumCore) throw new Error('RA_ForumCore is required.');

  const PLACEHOLDERS = Object.freeze(['name','player_id','looking_for','company_name','current_company','match_score','fit_score']);
  const COMPANY_RECRUITMENT_PLACEHOLDERS = Object.freeze(['name','company_name','company_type']);
  const FACTION_RECRUITMENT_PLACEHOLDERS = Object.freeze(['name','faction_name']);
  const TORN_CHAT_MAX_LENGTH = 840;
  const PRIVATE_CHAT_DRAFT_KEY = 'r4g3-ra-private-chat-draft';
  const PRIVATE_CHAT_DRAFT_TTL_MS = 2 * 60 * 1000;
  const DEFAULT_COMPANY_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI own a {company_type} company called {company_name}. I noticed that you currently are not working for a company and was wondering whether you would be interested in joining us.\n\nWe are actively recruiting and I would be happy to discuss the position with you if you are interested.';
  const DEFAULT_FACTION_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI noticed that you currently are not in a faction. I would like to invite you to join {faction_name}.\n\nWe are currently looking for active players who would like to become part of the team. If you are interested, I would be happy to tell you more.';

  function text(value) { return String(value ?? '').trim(); }

  function approvedValues(input = {}) {
    return Object.fromEntries(PLACEHOLDERS.map(key => [key, text(input[key])]));
  }

  function cleanPreparedText(value) {
    return String(value || '')
      .replace(/\s+([,.;!?])/g,'$1')
      .replace(/:\s*([,.;!?])/g,'$1')
      .replace(/\(\s*\)/g,'')
      .replace(/\[\s*\]/g,'')
      .replace(/[ \t]{2,}/g,' ')
      .replace(/\n[ \t]+/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }

  function prepareMessage(template, input = {}) {
    const values = approvedValues(input);
    const prepared = ForumCore.substituteMessage(String(template || ''), values);
    return cleanPreparedText(prepared);
  }

  function recruitmentPlaceholders(domain) {
    const normalized = text(domain).toLowerCase();
    if (normalized === 'company') return COMPANY_RECRUITMENT_PLACEHOLDERS;
    if (normalized === 'faction') return FACTION_RECRUITMENT_PLACEHOLDERS;
    throw new Error('Recruitment domain must be Company or Faction.');
  }

  function prepareRecruitmentMessage(domain, template, input = {}) {
    const allowed = recruitmentPlaceholders(domain);
    const values = Object.fromEntries(allowed.map(key => [key, text(input[key])]));
    let prepared = String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (match, rawKey) => {
      const key = String(rawKey || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(values,key) ? values[key] : '';
    });
    prepared = cleanPreparedText(prepared);
    if (!prepared) throw new Error('The recruitment chat template is empty.');
    if (prepared.length > TORN_CHAT_MAX_LENGTH) throw new Error(`Recruitment chat is ${prepared.length} characters; Torn private chat allows at most ${TORN_CHAT_MAX_LENGTH}.`);
    return prepared;
  }

  function companyRecruitmentEligibility(response = {}) {
    const user=response?.user&&typeof response.user==='object'?response.user:{};
    const hasTop=Object.prototype.hasOwnProperty.call(response,'job'),hasNested=Object.prototype.hasOwnProperty.call(user,'job');
    if(!hasTop&&!hasNested)return {eligible:false,known:false,currentName:'',currentId:''};
    const job=hasTop?response.job:user.job;
    if(job===null)return {eligible:true,known:true,currentName:'',currentId:''};
    if(!job||typeof job!=='object')return {eligible:false,known:false,currentName:'',currentId:''};
    const type=text(job.type).toLowerCase();
    if(!type)return {eligible:false,known:false,currentName:'',currentId:''};
    if (type === 'company') {
      const currentId = text(job.id ?? job.company_id ?? job.companyId);
      return {
        eligible:false,
        known:true,
        currentName:text(job.name ?? job.company_name ?? job.companyName) || (currentId ? `Company #${currentId}` : 'a company'),
        currentId
      };
    }
    return {eligible:true,known:true,currentName:'',currentId:''};
  }

  function factionRecruitmentEligibility(response = {}) {
    const user=response?.user&&typeof response.user==='object'?response.user:{};
    const hasTop=Object.prototype.hasOwnProperty.call(response,'faction'),hasNested=Object.prototype.hasOwnProperty.call(user,'faction');
    if(!hasTop&&!hasNested)return {eligible:false,known:false,currentName:'',currentId:''};
    const faction=hasTop?response.faction:user.faction;
    if(faction===null)return {eligible:true,known:true,currentName:'',currentId:''};
    if(!faction||typeof faction!=='object')return {eligible:false,known:false,currentName:'',currentId:''};
    const currentId = text(faction.id ?? faction.faction_id ?? faction.factionId);
    const currentName=text(faction.name ?? faction.faction_name ?? faction.factionName);
    if(!currentId&&!currentName)return {eligible:false,known:false,currentName:'',currentId:''};
    return {
      eligible:false,
      known:true,
      currentName:currentName || (currentId ? `Faction #${currentId}` : 'a faction'),
      currentId
    };
  }

  function profileUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/profiles.php?XID=${id}` : '';
  }

  function recruitmentChatPlan(domain, template, input = {}) {
    const normalized = text(domain).toLowerCase();
    recruitmentPlaceholders(normalized);
    const userId = text(input.userId || input.player_id);
    if (!/^\d+$/.test(userId)) throw new Error('A valid Torn player ID is required.');
    return {
      domain:normalized,
      userId,
      preparedText:prepareRecruitmentMessage(normalized,template,input),
      profileUrl:profileUrl(userId),
      transport:'private-chat',
      autoSubmit:false,
      stageChange:null
    };
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage || null; } catch { return null; }
  }

  function queuePrivateChatDraft(plan, storage, now = Date.now()) {
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== 'function') throw new Error('Browser storage is unavailable for the private-chat draft.');
    const userId = text(plan?.userId);
    if (!/^\d+$/.test(userId) || !text(plan?.preparedText)) throw new Error('A valid private-chat recruitment plan is required.');
    const queued = {
      domain:text(plan.domain).toLowerCase(),
      userId,
      preparedText:text(plan.preparedText),
      profileUrl:text(plan.profileUrl) || profileUrl(userId),
      transport:'private-chat',
      autoSubmit:false,
      queuedAt:Number(now) || Date.now(),
      expiresAt:(Number(now) || Date.now()) + PRIVATE_CHAT_DRAFT_TTL_MS
    };
    target.setItem(PRIVATE_CHAT_DRAFT_KEY,JSON.stringify(queued));
    return queued;
  }

  function consumePrivateChatDraft(userId, storage, now = Date.now()) {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function') return null;
    let queued;
    try { queued = JSON.parse(target.getItem(PRIVATE_CHAT_DRAFT_KEY) || 'null'); } catch { queued = null; }
    if (!queued || typeof queued !== 'object') {
      try { target.removeItem(PRIVATE_CHAT_DRAFT_KEY); } catch {}
      return null;
    }
    const current = Number(now) || Date.now();
    if (!Number.isFinite(Number(queued.expiresAt)) || current > Number(queued.expiresAt)) {
      try { target.removeItem(PRIVATE_CHAT_DRAFT_KEY); } catch {}
      return null;
    }
    const expected = text(userId);
    if (!/^\d+$/.test(expected) || text(queued.userId) !== expected) return null;
    try { target.removeItem(PRIVATE_CHAT_DRAFT_KEY); } catch {}
    const preparedText = text(queued.preparedText);
    if (!preparedText || preparedText.length > TORN_CHAT_MAX_LENGTH) return null;
    return {...queued,userId:expected,preparedText,transport:'private-chat',autoSubmit:false};
  }

  function composeUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/messages.php#/p=compose&XID=${id}` : '';
  }

  function messagePlan(template, input = {}) {
    const userId = text(input.player_id || input.userId);
    if (!/^\d+$/.test(userId)) throw new Error('A valid Torn player ID is required.');
    return {
      userId,
      preparedText:prepareMessage(template,{...input,player_id:userId}),
      composeUrl:composeUrl(userId),
      autoSubmit:false,
      stageChange:null
    };
  }

  return Object.freeze({
    PLACEHOLDERS,
    COMPANY_RECRUITMENT_PLACEHOLDERS,
    FACTION_RECRUITMENT_PLACEHOLDERS,
    TORN_CHAT_MAX_LENGTH,
    PRIVATE_CHAT_DRAFT_KEY,
    PRIVATE_CHAT_DRAFT_TTL_MS,
    DEFAULT_COMPANY_RECRUITMENT_MESSAGE,
    DEFAULT_FACTION_RECRUITMENT_MESSAGE,
    approvedValues,
    cleanPreparedText,
    prepareMessage,
    recruitmentPlaceholders,
    prepareRecruitmentMessage,
    companyRecruitmentEligibility,
    factionRecruitmentEligibility,
    profileUrl,
    recruitmentChatPlan,
    queuePrivateChatDraft,
    consumePrivateChatDraft,
    composeUrl,
    messagePlan
  });
});
