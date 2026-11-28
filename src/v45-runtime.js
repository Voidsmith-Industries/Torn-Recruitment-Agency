(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Runtime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_VERSION = 12;

  const PIPELINE_STAGES = Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const AVAILABILITY_VALUES = Object.freeze(['Available','Unavailable','Unknown']);
  const STAGE_COLORS = Object.freeze({
    'Not Contacted':'#64748b',
    'Shortlisted':'#d97706',
    'Contacted':'#2563eb',
    'Replied':'#7c3aed',
    'Hired':'#15803d',
    'Rejected':'#991b1b'
  });
  const AVAILABILITY_COLORS = Object.freeze({Available:'#15803d',Unavailable:'#991b1b',Unknown:'#64748b'});

  const DEFAULT_RECRUITMENT_MESSAGE = 'Hi {name}, I saw that you are looking for {looking_for}. I may have an opportunity at {company_name}.';
  const DEFAULT_COMPANY_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI own a {company_type} company called {company_name}. I noticed that you currently are not working for a company and was wondering whether you would be interested in joining us.\n\nWe are actively recruiting and I would be happy to discuss the position with you if you are interested.';
  const DEFAULT_FACTION_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI noticed that you currently are not in a faction. I would like to invite you to join {faction_name}.\n\nWe are currently looking for active players who would like to become part of the team. If you are interested, I would be happy to tell you more.';
  const HELP_REGISTRY = Object.freeze({
    discovery:{title:'Discovery',body:'Imports explicit recruitment intent from configured Torn forum sources. Forum text and workflow data remain local.'},
    sync:{title:'Sync Forum Posts',body:'Uses the shared Torn API scheduler. Completed pages are saved before the sanitized continuation checkpoint is advanced.'},
    fillCompanies:{title:'Fill Companies',body:'Looks up current company data sequentially through the shared scheduler. It never changes pipeline stage.'},
    messagePlayer:{title:'Recruit Player',body:'Freshly checks the target through Torn v2, prepares the saved Company or Faction private-chat template, opens the player profile and fills Torn private chat. You still press Send.'},
    defaultMessage:{title:'Recruitment Templates',body:'Company and Faction private-chat templates are saved separately and remain browser-local.'},
    data:{title:'Data',body:'Shows local IndexedDB counts and export/reset controls. No workspace backup/import system is added in v4.5.'},
  });

  const PRIVATE_LOG_FIELDS = new Set(['apiKey','key','messageBody','forumBody','rawText','recruiterNote','defaultMessage','preparedMessage','companyRecruitmentMessage','factionRecruitmentMessage']);

  function normalizeStage(value) {
    const raw = String(value || '').trim().toLowerCase();
    return PIPELINE_STAGES.find(stage => stage.toLowerCase() === raw) || 'Not Contacted';
  }

  function normalizeAvailability(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'Unknown';
    if (/^(available(?:\s+now)?|immediate|immediately|yes)$/.test(raw)) return 'Available';
    if (/^(unavailable|not available|no)$/.test(raw)) return 'Unavailable';
    return AVAILABILITY_VALUES.find(item => item.toLowerCase() === raw) || 'Unknown';
  }

  function normalizeCandidateRecord(record = {}) {
    const userId = String(record.userId || record.id || '').trim();
    if (!userId || !/^\d+$/.test(userId)) throw new Error('Candidate userId is required.');
    return {
      ...record,
      userId,
      pipelineStage:normalizeStage(record.pipelineStage),
      availability:normalizeAvailability(record.availability),
      discoverySources:[...new Set((Array.isArray(record.discoverySources) ? record.discoverySources : []).map(String).filter(Boolean))],
      latestForumSourceId:String(record.latestForumSourceId || ''),
      updatedAt:record.updatedAt || new Date().toISOString()
    };
  }

  function normalizeRecruitmentSettings(input = {}) {
    const stageColors = {...STAGE_COLORS, ...(input.stageColors || {})};
    const availabilityColors = {...AVAILABILITY_COLORS, ...(input.availabilityColors || {})};
    const legacyDefault = String(input.defaultMessage || DEFAULT_RECRUITMENT_MESSAGE);
    return {
      companyThreadId:String(input.companyThreadId || '15907925'),
      factionThreadId:String(input.factionThreadId || '15909136'),
      trainingThreadId:String(input.trainingThreadId || ''),
      recentImportDays:Math.max(1, Number(input.recentImportDays || 30)),
      maxPagesPerFeed:Math.max(1, Number(input.maxPagesPerFeed || 20)),
      candidateActiveAgeDays:Math.max(1, Number(input.candidateActiveAgeDays || 30)),
      explicitTrainBuyersOnly:input.explicitTrainBuyersOnly !== false,
      defaultMessage:legacyDefault,
      companyType:String(input.companyType || ''),
      companyRecruitmentMessage:String(input.companyRecruitmentMessage || DEFAULT_COMPANY_RECRUITMENT_MESSAGE),
      factionName:String(input.factionName || ''),
      factionRecruitmentMessage:String(input.factionRecruitmentMessage || DEFAULT_FACTION_RECRUITMENT_MESSAGE),
      stageColors,
      availabilityColors
    };
  }

  function sanitizeLogDetails(details = {}) {
    const out = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (PRIVATE_LOG_FIELDS.has(key)) continue;
      if (/key|token|secret|message|body|note/i.test(key)) continue;
      if (value === undefined) continue;
      out[key] = typeof value === 'string' ? value.slice(0, 300) : value;
    }
    return out;
  }

  function makeLogEntry(type, message, details = {}, at = Date.now()) {
    return {
      at:Number(at) || Date.now(),
      type:String(type || 'info').slice(0, 40),
      message:String(message || '').slice(0, 300),
      details:sanitizeLogDetails(details)
    };
  }

  return Object.freeze({
    DB_VERSION,
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    STAGE_COLORS,
    AVAILABILITY_COLORS,
    DEFAULT_RECRUITMENT_MESSAGE,
    DEFAULT_COMPANY_RECRUITMENT_MESSAGE,
    DEFAULT_FACTION_RECRUITMENT_MESSAGE,
    HELP_REGISTRY,
    normalizeStage,
    normalizeAvailability,
    normalizeCandidateRecord,
    normalizeRecruitmentSettings,
    sanitizeLogDetails,
    makeLogEntry
  });
});