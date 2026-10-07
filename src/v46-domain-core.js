(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V46DomainCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHARED_PLAYER_FIELDS = Object.freeze([
    'name','level','age','ee','man','int','end','total','factionId','factionName',
    'currentCompany','currentCompanyId','currentCompanyRating','currentCompanyPosition','companyCheckedAt',
    'networth','fit','fitType','lastActive','onlineStatus','lastScoutAt','lastGlobalAt','lastObservedAt',
    'activity30','activeStreak','bestActiveStreak','xanax30','refills30','attacks30','rwHits30','scoutStatus'
  ]);

  const COMPANY_STAGES = Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const FACTION_STAGES = Object.freeze(['Prospect','Contacted','Replied','Evaluating','Invite Ready','Joined','Rejected','Deferred']);
  const AVAILABILITY_VALUES = Object.freeze(['Available','Unavailable','Unknown']);
  const LEGACY_TO_FACTION_STAGE = Object.freeze({'Not Contacted':'Prospect','Shortlisted':'Evaluating','Contacted':'Contacted','Replied':'Replied','Hired':'Joined','Rejected':'Rejected'});
  const COMPANY_EVIDENCE = new Set(['COMPANY FORUM','TRAIN BUYER','MANUAL']);
  const FACTION_EVIDENCE = new Set(['FACTION FORUM']);
  const LEGACY_SHARED_KEYS = Object.freeze(['pipelineStage','availability','recruiterNote','desiredCompany','desiredRole','expectedSalary','manualFields','discoverySources','latestForumSourceId','currentCompany','currentCompanyId','currentCompanyRating','currentCompanyPosition','companyCheckedAt','status','stats','ee']);

  function text(value) { return String(value ?? '').trim(); }
  function timestamp(value, fallback = Date.now()) { const out = Number(value); return Number.isFinite(out) ? out : Number(fallback); }
  function uniqueStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map(value => text(value)).filter(Boolean))]; }
  function normalizeUserId(value) { const userId = text(value); if (!/^\d+$/.test(userId) || Number(userId) <= 0) throw new Error('A valid Torn player ID is required.'); return userId; }
  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
    return value;
  }

  function mergePlayerIntelligence(existing, patch = {}, source = 'unknown', observedAt = Date.now()) {
    const at = timestamp(observedAt);const userId = normalizeUserId(patch.userId ?? existing?.userId);const next = {...(existing || {}), userId};
    for (const key of SHARED_PLAYER_FIELDS) if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    const sourceLabel = text(source) || 'unknown';next.sources = uniqueStrings([...(Array.isArray(existing?.sources) ? existing.sources : []), sourceLabel]);next.createdAt = existing?.createdAt == null ? at : timestamp(existing.createdAt, at);next.updatedAt = Math.max(timestamp(existing?.updatedAt, 0), at);
    const history = Array.isArray(existing?.nameHistory) ? existing.nameHistory.map(item => ({name:text(item?.name), observedAt:timestamp(item?.observedAt, at)})).filter(item => item.name) : [];
    const currentName = text(next.name);if (currentName && history.at(-1)?.name !== currentName) history.push({name:currentName, observedAt:at});next.nameHistory = history;return next;
  }

  function normalizeAvailability(value) { const raw = text(value).toLowerCase(); return AVAILABILITY_VALUES.find(item => item.toLowerCase() === raw) || 'Unknown'; }
  function normalizeCompanyStage(value) { const raw = text(value).toLowerCase(); return COMPANY_STAGES.find(stage => stage.toLowerCase() === raw) || 'Not Contacted'; }
  function normalizeFactionStage(value) { const raw = text(value).toLowerCase(); return FACTION_STAGES.find(stage => stage.toLowerCase() === raw) || 'Prospect'; }
  function legacySharedState(record = {}) { const out = {}; for (const key of LEGACY_SHARED_KEYS) if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]; return out; }

  function normalizeCompanyRecruitment(record = {}, observedAt = Date.now(), options = {}) {
    const at = timestamp(observedAt);const userId = normalizeUserId(record.userId ?? record.id);const ambiguous = options.ambiguous === true;const createdAt = record.createdAt == null ? at : record.createdAt;
    const base = {
      userId,domain:'company',pipelineStage:ambiguous ? 'Not Contacted' : normalizeCompanyStage(record.pipelineStage),availability:ambiguous ? 'Unknown' : normalizeAvailability(record.availability),
      desiredCompany:ambiguous ? '' : text(record.desiredCompany),desiredRole:ambiguous ? '' : text(record.desiredRole),expectedSalary:ambiguous ? null : (record.expectedSalary ?? null),recruiterNote:ambiguous ? '' : text(record.recruiterNote),manualFields:ambiguous ? {} : {...(record.manualFields || {})},
      discoverySources:uniqueStrings(record.discoverySources),latestForumSourceId:text(record.latestForumSourceId),tags:uniqueStrings(record.tags),followUps:Array.isArray(record.followUps) ? record.followUps.map(item => ({...item,recurrence:item?.recurrence?{...item.recurrence}:item?.recurrence})) : [],campaigns:uniqueStrings(record.campaigns),outcomes:Array.isArray(record.outcomes) ? record.outcomes.map(item => ({...item})) : [],waivers:Array.isArray(record.waivers) ? record.waivers.map(item => ({...item})) : [],
      pinnedVacancyId:text(record.pinnedVacancyId),talentPool:record.talentPool===true,talentPoolReason:text(record.talentPoolReason),talentPoolChangedAt:record.talentPoolChangedAt ?? null,stageChangedAt:record.stageChangedAt ?? null,timelineEvents:Array.isArray(record.timelineEvents) ? record.timelineEvents.map(item => ({...item,payload:item?.payload?{...item.payload}:item?.payload})) : [],timelineNotes:Array.isArray(record.timelineNotes) ? record.timelineNotes.map(item => ({...item})) : [],
      doNotContact:record.doNotContact === true,doNotContactReason:text(record.doNotContactReason),doNotContactChangedAt:record.doNotContactChangedAt ?? null,archived:record.archived === true,cycles:Array.isArray(record.cycles) ? record.cycles.map(item => ({...item})) : [],createdAt,updatedAt:record.updatedAt ?? at
    };
    if (ambiguous) { base.migrationReviewRequired = true;base.legacySharedState = legacySharedState(record); }
    if (options.assumed === true) base.legacyDomainAssumed = 'company';return base;
  }

  function normalizeFactionRecruitment(record = {}, observedAt = Date.now(), options = {}) {
    const at = timestamp(observedAt);const userId = normalizeUserId(record.userId ?? record.id);const ambiguous = options.ambiguous === true;const createdAt = record.createdAt == null ? at : record.createdAt;
    const base = {
      userId,domain:'faction',pipelineStage:ambiguous ? 'Prospect' : normalizeFactionStage(record.pipelineStage),availability:ambiguous ? 'Unknown' : normalizeAvailability(record.availability),recruiterNote:ambiguous ? '' : text(record.recruiterNote),
      discoverySources:uniqueStrings(record.discoverySources),latestForumSourceId:text(record.latestForumSourceId),tags:uniqueStrings(record.tags),
      followUps:Array.isArray(record.followUps) ? cloneValue(record.followUps) : [],campaigns:uniqueStrings(record.campaigns),outcomes:Array.isArray(record.outcomes) ? cloneValue(record.outcomes) : [],waivers:Array.isArray(record.waivers) ? cloneValue(record.waivers) : [],
      specialistProfileId:text(record.specialistProfileId),pinnedSpecialistProfileId:text(record.pinnedSpecialistProfileId),stageChangedAt:record.stageChangedAt ?? null,
      timelineEvents:Array.isArray(record.timelineEvents) ? cloneValue(record.timelineEvents) : [],timelineNotes:Array.isArray(record.timelineNotes) ? cloneValue(record.timelineNotes) : [],
      doNotContact:record.doNotContact === true,doNotContactReason:text(record.doNotContactReason),doNotContactChangedAt:record.doNotContactChangedAt ?? null,
      archived:record.archived === true,cycles:Array.isArray(record.cycles) ? cloneValue(record.cycles) : [],createdAt,updatedAt:record.updatedAt ?? at
    };
    if (ambiguous) { base.migrationReviewRequired = true;base.legacySharedState = legacySharedState(record); }
    return base;
  }

  function evidenceForCandidate(candidate = {}, forumSources = []) { const userId = normalizeUserId(candidate.userId ?? candidate.id);const labels = uniqueStrings(candidate.discoverySources).map(value => value.toUpperCase());for (const source of Array.isArray(forumSources) ? forumSources : []) {if (text(source?.userId) !== userId) continue;const label = text(source?.sourceType).toUpperCase();if (label) labels.push(label);}return uniqueStrings(labels); }
  function classifyLegacyDomains(candidate = {}, forumSources = []) { const evidence = evidenceForCandidate(candidate, forumSources);let company = false;let faction = false;for (const label of evidence) {if (COMPANY_EVIDENCE.has(label)) company = true;if (FACTION_EVIDENCE.has(label)) faction = true;}if (!company && !faction) return ['company'];const out = [];if (company) out.push('company');if (faction) out.push('faction');return out; }
  function legacyCandidateToCompany(record = {}, observedAt = Date.now(), options = {}) { return normalizeCompanyRecruitment(record, observedAt, options); }
  function legacyCandidateToFaction(record = {}, observedAt = Date.now(), options = {}) { const mapped = {...record};if (options.ambiguous !== true) mapped.pipelineStage = LEGACY_TO_FACTION_STAGE[normalizeCompanyStage(record.pipelineStage)] || 'Prospect';return normalizeFactionRecruitment(mapped, observedAt, options); }

  return Object.freeze({SHARED_PLAYER_FIELDS,COMPANY_STAGES,FACTION_STAGES,AVAILABILITY_VALUES,LEGACY_TO_FACTION_STAGE,normalizeUserId,mergePlayerIntelligence,normalizeCompanyRecruitment,normalizeFactionRecruitment,classifyLegacyDomains,legacyCandidateToCompany,legacyCandidateToFaction});
});