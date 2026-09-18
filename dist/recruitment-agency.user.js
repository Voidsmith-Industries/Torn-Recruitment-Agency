// ==UserScript==
// @name         R4G3RUNN3R's Recruitment Agency
// @namespace    r4g3runn3r.recruitment.agency
// @version      4.8.2
// @description  Sortable Company and Faction recruitment search with status, organisation, work-stat and Last Online filters plus safe messaging.
// @author       R4G3RUNN3R[3877028]
// @license      MIT
// @match        https://www.torn.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @downloadURL  https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Recruitment-Agency/main/dist/recruitment-agency.user.js
// @updateURL    https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Recruitment-Agency/main/dist/recruitment-agency.user.js
// ==/UserScript==


/* bundled runtime: scout-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_ScoutCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const METRICS = ['xanax', 'activityHours', 'refills', 'attacks', 'rwHits'];

  const DEFAULT_SCORING = Object.freeze({
    targets: Object.freeze({
      xanax: 60,
      activityHours: 120,
      refills: 25,
      attacks: 200,
      rwHits: 40
    }),
    weights: Object.freeze({
      xanax: 20,
      activityHours: 20,
      refills: 20,
      attacks: 20,
      rwHits: 20
    })
  });

  function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonNegative(value) {
    return Math.max(0, finiteNumber(value, 0));
  }

  function round(value, dp = 2) {
    const p = 10 ** dp;
    return Math.round((finiteNumber(value, 0) + Number.EPSILON) * p) / p;
  }

  function normalizeScoring(input = {}) {
    const sourceTargets = input.targets || {};
    const sourceWeights = input.weights || {};
    const targets = {};
    const rawWeights = {};

    for (const key of METRICS) {
      const target = finiteNumber(sourceTargets[key], DEFAULT_SCORING.targets[key]);
      targets[key] = target > 0 ? target : DEFAULT_SCORING.targets[key];
      rawWeights[key] = nonNegative(sourceWeights[key] ?? DEFAULT_SCORING.weights[key]);
    }

    let total = METRICS.reduce((sum, key) => sum + rawWeights[key], 0);
    if (total <= 0) {
      for (const key of METRICS) rawWeights[key] = DEFAULT_SCORING.weights[key];
      total = 100;
    }

    const weights = {};
    let allocated = 0;
    METRICS.forEach((key, index) => {
      if (index === METRICS.length - 1) {
        weights[key] = round(100 - allocated, 10);
      } else {
        weights[key] = round((rawWeights[key] / total) * 100, 10);
        allocated += weights[key];
      }
    });

    return { targets, weights };
  }

  function metricScore(actual, target, weight) {
    const a = nonNegative(actual);
    const t = finiteNumber(target, 0);
    const w = nonNegative(weight);
    if (t <= 0 || w <= 0) return 0;
    return round(Math.min(a / t, 1) * w, 2);
  }

  function scoreFit(metrics = {}, scoring = DEFAULT_SCORING) {
    const cfg = normalizeScoring(scoring);
    const components = {};
    let score = 0;

    for (const key of METRICS) {
      components[key] = metricScore(metrics[key], cfg.targets[key], cfg.weights[key]);
      score += components[key];
    }

    return {
      score: round(Math.min(100, Math.max(0, score)), 2),
      components,
      scoring: cfg
    };
  }

  function computeTrend(window7 = {}, window30 = {}, scoring = DEFAULT_SCORING) {
    const cfg = normalizeScoring(scoring);
    const components = {};
    let weighted = 0;
    let validWeight = 0;

    for (const key of METRICS) {
      const recent = nonNegative(window7[key]) / 7;
      const baseline = nonNegative(window30[key]) / 30;
      if (baseline <= 0) continue;

      const pct = ((recent / baseline) - 1) * 100;
      components[key] = pct;
      weighted += pct * cfg.weights[key];
      validWeight += cfg.weights[key];
    }

    return {
      percent: validWeight > 0 ? round(weighted / validWeight, 2) : null,
      components,
      validWeight: round(validWeight, 10)
    };
  }

  function rawDelta(current, past, key) {
    return Math.max(0, finiteNumber(current && current[key], 0) - finiteNumber(past && past[key], 0));
  }

  function deltaStats(current = {}, past = {}) {
    return {
      xanax: rawDelta(current, past, 'xantaken'),
      activityHours: round(rawDelta(current, past, 'useractivity') / 3600, 4),
      refills: rawDelta(current, past, 'refills'),
      attacks: rawDelta(current, past, 'attackswon') + rawDelta(current, past, 'attackslost'),
      rwHits: rawDelta(current, past, 'rankedwarhits'),
      statEnhancers: rawDelta(current, past, 'statenhancersused'),
      networth: nonNegative(current.networth),
      activeStreak: nonNegative(current.activestreak),
      bestActiveStreak: nonNegative(current.bestactivestreak)
    };
  }

  function metricsFromTotals(current = {}) {
    return deltaStats(current, {});
  }

  function projectWindow(metrics = {}, days, targetDays = 30) {
    const sourceDays = finiteNumber(days, 0);
    const destDays = finiteNumber(targetDays, 30);
    if (sourceDays <= 0 || destDays <= 0) return null;
    const factor = destDays / sourceDays;
    const out = {};

    for (const key of METRICS) out[key] = round(nonNegative(metrics[key]) * factor, 4);
    out.statEnhancers = round(nonNegative(metrics.statEnhancers) * factor, 4);
    out.networth = nonNegative(metrics.networth);
    out.activeStreak = nonNegative(metrics.activeStreak);
    out.bestActiveStreak = nonNegative(metrics.bestActiveStreak);
    return out;
  }

  function provisionalConfidence(days) {
    const d = Math.max(0, finiteNumber(days, 0));
    if (d >= 30) return 'Official';
    if (d >= 21) return 'High';
    if (d >= 14) return 'Medium';
    if (d >= 7) return 'Low';
    return 'Very Low';
  }

  function provisionalFit(metrics = {}, days, scoring = DEFAULT_SCORING) {
    const d = Math.max(0, finiteNumber(days, 0));
    const projected = projectWindow(metrics, d, 30);
    if (!projected || d <= 0) {
      return { score: null, components: {}, projected: null, days: d, confidence: provisionalConfidence(d) };
    }
    const fit = scoreFit(projected, scoring);
    return {
      score: fit.score,
      components: fit.components,
      projected,
      days: d,
      confidence: provisionalConfidence(d),
      scoring: fit.scoring
    };
  }

  function parseIds(text, max = 20) {
    const limit = Math.max(1, Math.floor(finiteNumber(max, 20)));
    const seen = new Set();
    const out = [];
    const parts = String(text || '').split(/[^0-9]+/);
    for (const part of parts) {
      const id = Number.parseInt(part, 10);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) break;
    }
    return out;
  }

  function signature(stats = {}) {
    return [
      'xantaken',
      'useractivity',
      'refills',
      'statenhancersused',
      'attackswon',
      'attackslost',
      'rankedwarhits',
      'networth',
      'activestreak',
      'bestactivestreak'
    ].map((key) => String(finiteNumber(stats[key], 0))).join('|');
  }

  return {
    METRICS: METRICS.slice(),
    DEFAULT_SCORING,
    normalizeScoring,
    metricScore,
    scoreFit,
    computeTrend,
    deltaStats,
    metricsFromTotals,
    projectWindow,
    provisionalFit,
    provisionalConfidence,
    parseIds,
    signature
  };
});

/* bundled runtime: results-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_ResultsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PIPELINE_STAGES = Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const DEFAULT_VISIBLE_COLUMNS = Object.freeze(['player','pipelineStage','match','fit','lookingFor','sourceType','lastActive']);
  const DEFAULT_SORT = Object.freeze({ key: 'match', direction: 'desc' });
  const SCOUT_STATUS_ORDER = Object.freeze(['live','fresh','cached','provisional','stale','failed','unscouted']);
  const SCOUT_STATUS_RANK = Object.freeze(Object.fromEntries(SCOUT_STATUS_ORDER.map((key, index) => [key, index])));

  const COMPANY_KEYS = Object.freeze([
    'adult_novelties','amusement_park','candle_shop','car_dealership','clothing_store','cruise_line','cyber_cafe',
    'detective_agency','farm','firework_stand','fitness_center','flower_shop','furniture_store','game_shop','gas_station',
    'gents_strip_club','grocery_store','gun_shop','hair_salon','ladies_strip_club','law_firm','lingerie_store',
    'logistics_management','meat_warehouse','mechanic_shop','mining_corporation','music_store','nightclub','oil_rig',
    'private_security_firm','property_broker','pub','restaurant','software_corporation','sweet_shop','television_network',
    'theater','toy_shop','travel_agency','wedding_chapel','zoo'
  ]);

  const COMPANY_ALIASES = new Map();
  for (const key of COMPANY_KEYS) {
    COMPANY_ALIASES.set(key, key);
    COMPANY_ALIASES.set(key.replace(/_/g, ' '), key);
  }
  Object.entries({
    an: 'adult_novelties',
    'adult novelty': 'adult_novelties',
    'adult novelties': 'adult_novelties',
    psf: 'private_security_firm',
    'private security': 'private_security_firm',
    lm: 'logistics_management',
    logistics: 'logistics_management',
    'logistics company': 'logistics_management',
    'oil rig': 'oil_rig',
    gents: 'gents_strip_club',
    'gentlemans club': 'gents_strip_club',
    "gentleman's club": 'gents_strip_club'
  }).forEach(([alias, key]) => COMPANY_ALIASES.set(alias, key));

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const x = Number(value);
    return Number.isFinite(x) ? x : null;
  }

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function lower(value) { return text(value).toLowerCase(); }

  function parseCompactNumber(value) {
    const raw = String(value ?? '').trim().replace(/,/g, '');
    if (!raw) return { valid: true, empty: true, value: null };
    const m = raw.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([kmb])?$/i);
    if (!m) return { valid: false, empty: false, value: null };
    const base = Number(m[1]);
    if (!Number.isFinite(base) || base < 0) return { valid: false, empty: false, value: null };
    const mult = ({ k: 1e3, m: 1e6, b: 1e9 })[(m[2] || '').toLowerCase()] || 1;
    const out = base * mult;
    return Number.isFinite(out) ? { valid: true, empty: false, value: out } : { valid: false, empty: false, value: null };
  }

  function normalizeCompany(value) {
    const raw = String(value ?? '').trim().toLowerCase().replace(/[.*]/g, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    return COMPANY_ALIASES.get(raw) || '';
  }

  function parsePreferredCompany(value) {
    const raw = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const intent = /(?:\blooking\s+for\b|\bseeking\b|\bprefer(?:ably|red|ring)?\b|\bwant(?:ing)?\b|\bafter\b)\s+(?:a\s+|an\s+|any\s+|\d+\s*\*?\s*)?([^,.;|]{1,80})/ig;
    let match;
    while ((match = intent.exec(raw))) {
      const phrase = match[1].toLowerCase().replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const candidates = [...COMPANY_ALIASES.keys()].sort((a, b) => b.length - a.length);
      for (const alias of candidates) {
        const re = new RegExp(`(?:^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'i');
        if (re.test(phrase)) return COMPANY_ALIASES.get(alias) || '';
      }
    }
    return '';
  }

  function formatCompany(key) {
    const normalized = normalizeCompany(key) || String(key || '').toLowerCase();
    if (!normalized) return '—';
    return normalized.split('_').map(x => x ? x[0].toUpperCase() + x.slice(1) : '').join(' ');
  }

  function scoutOf(row) { return row?.scout || (row?.w30 || row?.profile ? row : null); }
  function profileOf(row) { return scoutOf(row)?.profile || row?.api || row?.profile || {}; }
  function window30(row) { const s = scoutOf(row); return s?.w30 || s?.provisionalSource || {}; }
  function candidateOf(row) { return row?.candidateLocal || row?.candidate || {}; }

  function fitOf(row) {
    const direct = finite(row?.fit);
    if (direct !== null) return direct;
    const s = scoutOf(row);
    if (!s) return null;
    for (const key of ['currentFit','fit','originalFit']) {
      const x = finite(s[key]);
      if (x !== null) return x;
    }
    return null;
  }

  function idleSeconds(row, nowMs = Date.now()) {
    const p = profileOf(row);
    const ts = finite(p.lastActionTs ?? p.last_action?.timestamp ?? row?.lastActionTs);
    if (ts === null || ts <= 0) return null;
    return Math.max(0, Math.floor(nowMs / 1000 - ts));
  }

  function classifyScoutStatus(row, nowMs = Date.now(), freshMs = 12 * 60 * 60 * 1000) {
    const s = scoutOf(row);
    if (!s) return 'unscouted';
    if (s.failed || s.error) return 'failed';
    const p = profileOf(row);
    if (/online/i.test(String(p.status || ''))) return 'live';
    if (s.official === false || s.originalFitType === 'provisional' || s.provisionalSource) return 'provisional';
    const capturedAt = finite(s.capturedAt);
    if (capturedAt === null) return 'cached';
    const age = Math.max(0, nowMs - capturedAt);
    if (age <= Math.min(freshMs, 15 * 60 * 1000)) return 'fresh';
    if (age <= freshMs) return 'cached';
    return 'stale';
  }

  function pipelineStageOf(row) {
    const value = text(row?.pipelineStage || candidateOf(row)?.pipelineStage);
    return PIPELINE_STAGES.find(stage => stage.toLowerCase() === value.toLowerCase()) || 'Not Contacted';
  }

  function sourceTypeOf(row) {
    const direct = text(row?.sourceType || row?.latestSource?.sourceType);
    if (direct) return direct.toUpperCase();
    const sources = row?.discoverySources || candidateOf(row)?.discoverySources;
    return Array.isArray(sources) && sources.length ? text(sources[sources.length - 1]).toUpperCase() : '';
  }

  function currentCompanyOf(row) {
    const p = profileOf(row);
    return text(row?.currentCompany || row?.companyName || p?.company?.name || p?.job?.company_name || p?.company_name);
  }

  function lookingForOf(row) {
    const c = candidateOf(row);
    return text(row?.lookingFor || c?.lookingFor || c?.desiredRole || c?.desiredCompany || row?.preferredCompany || row?.company);
  }

  function availabilityOf(row) { return text(row?.availability || candidateOf(row)?.availability) || 'Unknown'; }

  function isActiveCandidate(row, nowMs = Date.now(), activeAgeDays = 30) {
    if (row?.active === false || candidateOf(row)?.active === false) return false;
    const limit = Math.max(0, finite(activeAgeDays) ?? 30) * 86400;
    if (!limit) return true;
    const idle = idleSeconds(row, nowMs);
    return idle === null ? true : idle <= limit;
  }

  const COLUMNS = Object.freeze([
    { key:'player', label:'Player', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(r?.name || profileOf(r)?.name) },
    { key:'pipelineStage', label:'Stage', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(pipelineStageOf(r)) },
    { key:'match', label:'Match', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.matchScore) },
    { key:'fit', label:'Fit', type:'number', sortable:true, defaultDirection:'desc', getValue:r => fitOf(r) },
    { key:'lookingFor', label:'Looking For', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(lookingForOf(r)) || null },
    { key:'sourceType', label:'Source', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(sourceTypeOf(r)) || null },
    { key:'lastActive', label:'Last Active', type:'number', sortable:true, defaultDirection:'asc', getValue:(r,now) => idleSeconds(r, now) },
    { key:'currentCompany', label:'Current Company', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(currentCompanyOf(r)) || null },
    { key:'availability', label:'Availability', type:'text', sortable:true, defaultDirection:'asc', getValue:r => lower(availabilityOf(r)) },
    { key:'man', label:'MAN', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.stats?.man) },
    { key:'int', label:'INT', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.stats?.int) },
    { key:'end', label:'END', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.stats?.end) },
    { key:'total', label:'TOTAL', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.stats?.total) },
    { key:'ee', label:'EE', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.ee) },
    { key:'preferredCompany', label:'Preferred Company', type:'text', sortable:true, defaultDirection:'asc', getValue:r => normalizeCompany(r?.preferredCompany || r?.company) || null },
    { key:'trend', label:'Trend', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(scoutOf(r)?.trend ?? r?.trend) },
    { key:'activity30', label:'Activity', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(window30(r)?.activityHours) },
    { key:'scoutStatus', label:'Scout Status', type:'rank', sortable:true, defaultDirection:'asc', getValue:(r,now) => SCOUT_STATUS_RANK[classifyScoutStatus(r, now)] ?? 999 },
    { key:'level', label:'Level', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(profileOf(r)?.level) },
    { key:'xanax30', label:'Xanax 30d', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(window30(r)?.xanax) },
    { key:'refills30', label:'Refills 30d', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(window30(r)?.refills) },
    { key:'attacks30', label:'Attacks 30d', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(window30(r)?.attacks) },
    { key:'rwHits30', label:'RW Hits 30d', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(window30(r)?.rwHits) },
    { key:'networth', label:'Net Worth', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(scoutOf(r)?.extra?.networth) },
    { key:'activeStreak', label:'Active Streak', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(scoutOf(r)?.extra?.activeStreak) },
    { key:'bestStreak', label:'Best Streak', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(scoutOf(r)?.extra?.bestActiveStreak) },
    { key:'postDate', label:'Post Date', type:'number', sortable:true, defaultDirection:'desc', getValue:r => finite(r?.lastSeenPost) },
    { key:'scoutAge', label:'Scout Age', type:'number', sortable:true, defaultDirection:'asc', getValue:(r,now) => { const c=finite(scoutOf(r)?.capturedAt); return c===null?null:Math.max(0,now-c); } }
  ]);

  const COLUMN_MAP = Object.freeze(Object.fromEntries(COLUMNS.map(c => [c.key, c])));
  function getColumn(key) { return COLUMN_MAP[String(key || '')] || null; }

  function missing(value, type) {
    if (value === null || value === undefined || value === '') return true;
    if ((type === 'number' || type === 'rank') && !Number.isFinite(Number(value))) return true;
    return false;
  }

  function tieBreak(a, b) {
    const an = lower(a?.name || profileOf(a)?.name);
    const bn = lower(b?.name || profileOf(b)?.name);
    const byName = an.localeCompare(bn);
    if (byName) return byName;
    return (finite(a?.userId) || finite(a?.id) || 0) - (finite(b?.userId) || finite(b?.id) || 0);
  }

  function sortRows(rows, sortState = DEFAULT_SORT, nowMs = Date.now()) {
    const col = getColumn(sortState?.key) || getColumn(DEFAULT_SORT.key);
    const direction = sortState?.direction === 'asc' ? 'asc' : 'desc';
    const sign = direction === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      const av = col.getValue(a, nowMs);
      const bv = col.getValue(b, nowMs);
      const am = missing(av, col.type);
      const bm = missing(bv, col.type);
      if (am !== bm) return am ? 1 : -1;
      if (am && bm) return tieBreak(a, b);
      const cmp = col.type === 'text' ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp ? cmp * sign : tieBreak(a, b);
    });
  }

  function numFilter(filters, key) {
    const raw = filters?.[key];
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = typeof raw === 'number' ? {valid:Number.isFinite(raw),empty:false,value:raw} : parseCompactNumber(raw);
    return parsed.valid && !parsed.empty ? parsed.value : null;
  }

  function sameText(actual, expected) {
    const wanted = lower(expected);
    return !wanted || lower(actual) === wanted;
  }

  function applyFilters(rows, filters = {}, nowMs = Date.now()) {
    const q = lower(filters.search);
    const minMan = numFilter(filters,'minMan');
    const minInt = numFilter(filters,'minInt');
    const minEnd = numFilter(filters,'minEnd');
    const minTotal = numFilter(filters,'minTotal');
    const minEe = numFilter(filters,'minEe');
    const maxEe = numFilter(filters,'maxEe');
    const minActivity30 = numFilter(filters,'minActivity30');
    const maxIdleDays = numFilter(filters,'maxIdleDays');
    const minFit = numFilter(filters,'minFit');
    const minMatch = numFilter(filters,'minMatch');
    const minLevel = numFilter(filters,'minLevel');
    const maxLevel = numFilter(filters,'maxLevel');
    const minNetworth = numFilter(filters,'minNetworth');
    const minActiveStreak = numFilter(filters,'minActiveStreak');
    const minBestStreak = numFilter(filters,'minBestStreak');
    const minStatEnhancers = numFilter(filters,'minStatEnhancers');
    const minXanax30 = numFilter(filters,'minXanax30');
    const minRefills30 = numFilter(filters,'minRefills30');
    const minAttacks30 = numFilter(filters,'minAttacks30');
    const minRwHits30 = numFilter(filters,'minRwHits30');
    const maxDataAgeDays = numFilter(filters,'maxDataAgeDays');
    const company = normalizeCompany(filters.preferredCompany);
    const scoutStatus = lower(filters.scoutStatus);
    const faction = lower(filters.faction || 'any');
    const pipelineStage = text(filters.pipelineStage || filters.stage);
    const sourceType = text(filters.sourceType || filters.source).toUpperCase();
    const currentCompany = lower(filters.currentCompany);
    const lookingFor = lower(filters.lookingFor);
    const availability = lower(filters.availability);
    const activeOnly = filters.activeOnly === true || String(filters.activeOnly).toLowerCase() === 'true';
    const activeAgeDays = numFilter(filters,'activeAgeDays') ?? 30;

    return (rows || []).filter(row => {
      const p = profileOf(row);
      const s = scoutOf(row);
      const w = window30(row);
      const name = lower(row?.name || p?.name);
      const id = String(row?.userId || row?.id || '');
      if (q && !name.includes(q) && !id.includes(q) && !lower(lookingForOf(row)).includes(q) && !lower(currentCompanyOf(row)).includes(q)) return false;
      if (pipelineStage && pipelineStageOf(row).toLowerCase() !== pipelineStage.toLowerCase()) return false;
      if (sourceType && sourceTypeOf(row) !== sourceType) return false;
      if (currentCompany && !lower(currentCompanyOf(row)).includes(currentCompany)) return false;
      if (lookingFor && !lower(lookingForOf(row)).includes(lookingFor)) return false;
      if (availability && !sameText(availabilityOf(row), availability)) return false;
      if (activeOnly && !isActiveCandidate(row, nowMs, activeAgeDays)) return false;
      if (minMan !== null && (finite(row?.stats?.man) === null || Number(row.stats.man) < minMan)) return false;
      if (minInt !== null && (finite(row?.stats?.int) === null || Number(row.stats.int) < minInt)) return false;
      if (minEnd !== null && (finite(row?.stats?.end) === null || Number(row.stats.end) < minEnd)) return false;
      if (minTotal !== null && (finite(row?.stats?.total) === null || Number(row.stats.total) < minTotal)) return false;
      const ee = finite(row?.ee);
      if (minEe !== null && (ee === null || ee < minEe)) return false;
      if (maxEe !== null && (ee === null || ee > maxEe)) return false;
      if (company && normalizeCompany(row?.preferredCompany || row?.company) !== company) return false;
      const act = finite(w?.activityHours);
      if (minActivity30 !== null && (act === null || act < minActivity30)) return false;
      const idle = idleSeconds(row, nowMs);
      if (maxIdleDays !== null && (idle === null || idle > maxIdleDays * 86400)) return false;
      const fit = fitOf(row);
      if (minFit !== null && (fit === null || fit < minFit)) return false;
      const matchScore = finite(row?.matchScore);
      if (minMatch !== null && (matchScore === null || matchScore < minMatch)) return false;
      const level = finite(p?.level);
      if (minLevel !== null && (level === null || level < minLevel)) return false;
      if (maxLevel !== null && (level === null || level > maxLevel)) return false;
      if (minNetworth !== null && (finite(s?.extra?.networth) === null || Number(s.extra.networth) < minNetworth)) return false;
      if (scoutStatus && scoutStatus !== 'any' && classifyScoutStatus(row, nowMs) !== scoutStatus) return false;
      const factionId = finite(p?.factionId) || 0;
      if (faction === 'none' && factionId) return false;
      if (faction === 'has' && !factionId) return false;
      if (minActiveStreak !== null && (finite(s?.extra?.activeStreak) === null || Number(s.extra.activeStreak) < minActiveStreak)) return false;
      if (minBestStreak !== null && (finite(s?.extra?.bestActiveStreak) === null || Number(s.extra.bestActiveStreak) < minBestStreak)) return false;
      if (minStatEnhancers !== null && (finite(s?.extra?.statEnhancers30) === null || Number(s.extra.statEnhancers30) < minStatEnhancers)) return false;
      if (minXanax30 !== null && (finite(w?.xanax) === null || Number(w.xanax) < minXanax30)) return false;
      if (minRefills30 !== null && (finite(w?.refills) === null || Number(w.refills) < minRefills30)) return false;
      if (minAttacks30 !== null && (finite(w?.attacks) === null || Number(w.attacks) < minAttacks30)) return false;
      if (minRwHits30 !== null && (finite(w?.rwHits) === null || Number(w.rwHits) < minRwHits30)) return false;
      if (maxDataAgeDays !== null) {
        const captured = finite(s?.capturedAt);
        if (captured === null || Math.max(0, nowMs - captured) > maxDataAgeDays * 86400000) return false;
      }
      return true;
    });
  }

  function activeFilterCount(filters = {}) {
    return Object.entries(filters).filter(([key, value]) => {
      if (key === 'search') return text(value) !== '';
      if (key === 'activeAgeDays') return false;
      if (value === null || value === undefined || value === '' || value === false || value === 'any') return false;
      return true;
    }).length;
  }

  function processRows(rows, filters = {}, sortState = DEFAULT_SORT, nowMs = Date.now()) {
    return sortRows(applyFilters(rows, filters, nowMs), sortState, nowMs);
  }

  return Object.freeze({
    PIPELINE_STAGES,
    DEFAULT_VISIBLE_COLUMNS,
    DEFAULT_SORT,
    SCOUT_STATUS_ORDER,
    SCOUT_STATUS_RANK,
    COMPANY_KEYS,
    COLUMNS,
    parseCompactNumber,
    normalizeCompany,
    parsePreferredCompany,
    formatCompany,
    idleSeconds,
    classifyScoutStatus,
    pipelineStageOf,
    sourceTypeOf,
    currentCompanyOf,
    lookingForOf,
    availabilityOf,
    isActiveCandidate,
    getColumn,
    sortRows,
    applyFilters,
    processRows,
    activeFilterCount
  });
});

/* bundled runtime: global-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_GlobalCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GLOBAL_SCHEMA_VERSION = 1;
  const GLOBAL_FIELDS = Object.freeze([
    'playerId','name','observedAt','level','ee','activity30','xanax30','refills30',
    'attacks30','rwHits30','networth','fit','fitType','lastActive','scoutStatus','sourceVersion'
  ]);
  const MATERIAL_FIELDS = Object.freeze([
    'level','ee','activity30','xanax30','refills30','attacks30','rwHits30',
    'networth','fit','fitType','lastActive'
  ]);
  const PERMANENT_CODES = new Set(['INVALID_SCHEMA','INVALID_BODY','INVALID_ACTION','INVALID_PLAYER','INVALID_DATA']);

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const x = Number(value);
    return Number.isFinite(x) && x >= 0 ? x : null;
  }

  function safeText(value, max) {
    let s = String(value ?? '').trim().slice(0, max);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return s;
  }

  function sanitizeObservation(input, sourceVersion) {
    const playerId = Number(input?.playerId ?? input?.userId ?? input?.id);
    const observedAt = Number(input?.observedAt ?? input?.capturedAt);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) throw new Error('Invalid playerId');
    if (!Number.isFinite(observedAt) || observedAt <= 0) throw new Error('Invalid observedAt');

    return {
      playerId,
      name: safeText(input?.name, 32),
      observedAt,
      level: finiteOrNull(input?.level),
      ee: finiteOrNull(input?.ee),
      activity30: finiteOrNull(input?.activity30),
      xanax30: finiteOrNull(input?.xanax30),
      refills30: finiteOrNull(input?.refills30),
      attacks30: finiteOrNull(input?.attacks30),
      rwHits30: finiteOrNull(input?.rwHits30),
      networth: finiteOrNull(input?.networth),
      fit: finiteOrNull(input?.fit),
      fitType: safeText(input?.fitType || '', 24),
      lastActive: finiteOrNull(input?.lastActive),
      scoutStatus: safeText(input?.scoutStatus || '', 24),
      sourceVersion: safeText(sourceVersion || input?.sourceVersion || '', 16)
    };
  }

  function buildObservePayload(input, sourceVersion) {
    const obs = sanitizeObservation(input, sourceVersion);
    return {
      action: 'observe',
      schema: GLOBAL_SCHEMA_VERSION,
      player: { id: obs.playerId, name: obs.name, level: obs.level },
      observation: { ...obs }
    };
  }

  function materiallyEqual(a, b) {
    return MATERIAL_FIELDS.every(key => {
      const av = a?.[key] ?? null;
      const bv = b?.[key] ?? null;
      return av === bv;
    });
  }

  function normalizeServiceResponse(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, code: 'INVALID_RESPONSE' };
    return {
      ok: raw.ok === true,
      code: safeText(raw.code || '', 40),
      accepted: raw.accepted === true,
      deduped: raw.deduped === true,
      playerId: Number.isSafeInteger(Number(raw.playerId)) ? Number(raw.playerId) : null,
      observationCount: finiteOrNull(raw.observationCount),
      firstSeen: finiteOrNull(raw.firstSeen),
      lastSeen: finiteOrNull(raw.lastSeen),
      schemaVersion: finiteOrNull(raw.schemaVersion),
      serviceVersion: safeText(raw.serviceVersion || '', 24),
      dedupeWindowMinutes: finiteOrNull(raw.dedupeWindowMinutes),
      maxHistory: finiteOrNull(raw.maxHistory)
    };
  }

  function sanitizeHistoryObservation(input) {
    if (!input || typeof input !== 'object') return null;
    try {
      return sanitizeObservation({
        ...input,
        playerId: input.playerId ?? input.userId ?? input.id,
        observedAt: input.observedAt
      }, input.sourceVersion || '');
    } catch {
      return null;
    }
  }

  function normalizePlayerHistory(raw) {
    if (!raw || raw.ok !== true) return null;
    const playerId = Number(raw.playerId);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) return null;

    const latest = raw.latest ? sanitizeHistoryObservation({ ...raw.latest, playerId }) : null;
    const history = Array.isArray(raw.history)
      ? raw.history.map(item => sanitizeHistoryObservation({ ...item, playerId })).filter(Boolean).slice(0, 100)
      : [];

    return {
      ok: true,
      playerId,
      latest,
      history,
      observationCount: finiteOrNull(raw.observationCount) ?? history.length,
      firstSeen: finiteOrNull(raw.firstSeen),
      lastSeen: finiteOrNull(raw.lastSeen)
    };
  }

  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function pickPreferredValue(values = {}) {
    const order = [
      ['live', 'LIVE'],
      ['local', 'LOCAL'],
      ['global', 'GLOBAL'],
      ['historical', 'HISTORICAL'],
      ['forum', 'FORUM']
    ];
    for (const [key, provenance] of order) {
      if (hasValue(values[key])) return { value: values[key], provenance };
    }
    return { value: null, provenance: 'NONE' };
  }

  function classifyRetry(errorOrResponse) {
    if (errorOrResponse instanceof Error) return 'retry';
    const code = String(errorOrResponse?.code || '').toUpperCase();
    if (PERMANENT_CODES.has(code)) return 'permanent';
    if (errorOrResponse?.ok === true) return 'done';
    return 'retry';
  }

  function makeQueueId(observation) {
    const playerId = Number(observation?.playerId);
    const observedAt = Number(observation?.observedAt);
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !Number.isFinite(observedAt) || observedAt <= 0) {
      throw new Error('Invalid queue observation identity');
    }
    return `${playerId}:${observedAt}`;
  }

  return Object.freeze({
    GLOBAL_SCHEMA_VERSION,
    GLOBAL_FIELDS,
    MATERIAL_FIELDS,
    sanitizeObservation,
    buildObservePayload,
    materiallyEqual,
    normalizeServiceResponse,
    normalizePlayerHistory,
    pickPreferredValue,
    classifyRetry,
    makeQueueId
  });
});

/* bundled runtime: match-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_MatchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CRITERIA_KEYS = Object.freeze([
    'man', 'int', 'end', 'ee', 'fit', 'activity30', 'xanax30', 'refills30', 'attacks30', 'rwHits30',
    'company', 'role', 'salary', 'availability'
  ]);

  const AVAILABILITY_VALUES = Object.freeze(['immediate', 'soon', 'flexible', 'not_available']);

  const DEFAULT_CRITERIA = Object.freeze({
    man: { enabled: false, target: 0, weight: 10 },
    int: { enabled: false, target: 0, weight: 10 },
    end: { enabled: false, target: 0, weight: 10 },
    ee: { enabled: true, target: 7, weight: 15 },
    fit: { enabled: true, target: 70, weight: 20 },
    activity30: { enabled: true, target: 120, weight: 20 },
    xanax30: { enabled: false, target: 60, weight: 10 },
    refills30: { enabled: false, target: 25, weight: 10 },
    attacks30: { enabled: false, target: 200, weight: 10 },
    rwHits30: { enabled: false, target: 40, weight: 10 },
    company: { enabled: false, value: '', weight: 15 },
    role: { enabled: false, value: '', weight: 15 },
    salary: { enabled: false, max: 0, weight: 15 },
    availability: { enabled: false, value: '', weight: 10 }
  });

  const CRITERIA_LABELS = Object.freeze({
    man: 'Manual Labor',
    int: 'Intelligence',
    end: 'Endurance',
    ee: 'EE',
    fit: 'Fit',
    activity30: 'Activity 30d',
    xanax30: 'Xanax 30d',
    refills30: 'Refills 30d',
    attacks30: 'Attacks 30d',
    rwHits30: 'RW Hits 30d',
    company: 'Company',
    role: 'Role',
    salary: 'Salary',
    availability: 'Availability'
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finitePositiveOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function cleanText(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeRole(value) {
    return cleanText(value).toLowerCase();
  }

  function normalizeCompany(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function normalizeAvailability(value) {
    const raw = cleanText(value).toLowerCase().replace(/\s+/g, '_');
    const aliases = {
      now: 'immediate',
      available_now: 'immediate',
      asap: 'immediate',
      later: 'soon',
      negotiable: 'flexible'
    };
    const normalized = aliases[raw] || raw;
    return AVAILABILITY_VALUES.includes(normalized) ? normalized : '';
  }

  function scoreNumeric(actual, target, weight) {
    const a = finitePositiveOrNull(actual);
    const t = finitePositiveOrNull(target);
    const w = finitePositiveOrNull(weight) || 0;
    if (a === null || t === null || t <= 0 || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = Math.min(a / t, 1);
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function scoreSalary(expectedSalary, maxBudget, weight) {
    const salary = finitePositiveOrNull(expectedSalary);
    const budget = finitePositiveOrNull(maxBudget);
    const w = finitePositiveOrNull(weight) || 0;
    if (salary === null || budget === null || budget <= 0 || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = salary <= 0 ? 1 : Math.min(budget / salary, 1);
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function scoreCategorical(actual, expected, weight, normalizer) {
    const normalize = typeof normalizer === 'function' ? normalizer : normalizeRole;
    const a = normalize(actual);
    const e = normalize(expected);
    const w = finitePositiveOrNull(weight) || 0;
    if (!a || !e || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = a === e ? 1 : 0;
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function hasManualValue(source, key) {
    if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return false;
    const value = source[key];
    return value !== null && value !== undefined && value !== '';
  }

  function mergeCandidateValues(input) {
    const manual = input && input.manual && typeof input.manual === 'object' ? input.manual : {};
    const parsed = input && input.parsed && typeof input.parsed === 'object' ? input.parsed : {};
    const pick = (key) => hasManualValue(manual, key) ? manual[key] : parsed[key];
    const salary = finitePositiveOrNull(pick('expectedSalary'));
    return {
      desiredCompany: cleanText(pick('desiredCompany')),
      desiredRole: cleanText(pick('desiredRole')),
      expectedSalary: salary,
      availability: normalizeAvailability(pick('availability')),
      recruiterNote: cleanText(pick('recruiterNote'))
    };
  }

  function normalizeCandidate(input) {
    const source = input && typeof input === 'object' ? input : {};
    const hasManualObject = !!(source.manualFields && typeof source.manualFields === 'object' && !Array.isArray(source.manualFields));
    const manual = hasManualObject ? clone(source.manualFields) : {
      desiredCompany: source.desiredCompany,
      desiredRole: source.desiredRole,
      expectedSalary: source.expectedSalary,
      availability: source.availability
    };
    const parsed = source.parsed && typeof source.parsed === 'object' ? source.parsed : (hasManualObject ? {
      desiredCompany: source.desiredCompany,
      desiredRole: source.desiredRole,
      expectedSalary: source.expectedSalary,
      availability: source.availability
    } : {});
    const merged = mergeCandidateValues({ manual, parsed });
    return {
      userId: cleanText(source.userId || source.id || source.playerId),
      desiredCompany: merged.desiredCompany,
      desiredRole: merged.desiredRole,
      expectedSalary: merged.expectedSalary,
      availability: merged.availability,
      recruiterNote: cleanText(source.recruiterNote || merged.recruiterNote),
      manualFields: {
        desiredCompany: cleanText(manual.desiredCompany),
        desiredRole: cleanText(manual.desiredRole),
        expectedSalary: finitePositiveOrNull(manual.expectedSalary),
        availability: normalizeAvailability(manual.availability)
      },
      createdAt: cleanText(source.createdAt),
      updatedAt: cleanText(source.updatedAt)
    };
  }

  function normalizeCriterion(key, input, disableWhenMissing) {
    const base = clone(DEFAULT_CRITERIA[key]);
    const source = input && typeof input === 'object' ? input : {};
    if (disableWhenMissing && !input) base.enabled = false;
    base.enabled = source.enabled === undefined ? base.enabled : !!source.enabled;
    base.weight = finitePositiveOrNull(source.weight) ?? base.weight;
    if (Object.prototype.hasOwnProperty.call(base, 'target')) {
      base.target = finitePositiveOrNull(source.target) ?? base.target;
    }
    if (Object.prototype.hasOwnProperty.call(base, 'max')) {
      base.max = finitePositiveOrNull(source.max) ?? base.max;
    }
    if (Object.prototype.hasOwnProperty.call(base, 'value')) {
      const rawValue = source.value === undefined ? base.value : source.value;
      if (key === 'availability') base.value = normalizeAvailability(rawValue);
      else base.value = cleanText(rawValue);
    }
    return base;
  }

  function normalizeProfile(input) {
    const source = input && typeof input === 'object' ? input : {};
    const hasCriteria = !!(source.criteria && typeof source.criteria === 'object');
    const criteriaSource = hasCriteria ? source.criteria : {};
    const criteria = {};
    CRITERIA_KEYS.forEach((key) => {
      criteria[key] = normalizeCriterion(key, criteriaSource[key], hasCriteria);
    });
    return {
      profileId: cleanText(source.profileId) || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanText(source.name) || 'Smart Match',
      criteria,
      createdAt: cleanText(source.createdAt),
      updatedAt: cleanText(source.updatedAt)
    };
  }

  function createDefaultProfile(name) {
    return normalizeProfile({ name: cleanText(name) || 'Smart Match' });
  }

  function roundOne(value) {
    return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
  }

  function evaluateMatch(input) {
    const source = input && typeof input === 'object' ? input : {};
    const row = source.row && typeof source.row === 'object' ? source.row : {};
    const candidate = source.candidate && typeof source.candidate === 'object' ? source.candidate : {};
    const profile = normalizeProfile(source.profile || {});
    const values = {
      man: row.stats && row.stats.man !== undefined ? row.stats.man : row.man,
      int: row.stats && row.stats.int !== undefined ? row.stats.int : row.int,
      end: row.stats && row.stats.end !== undefined ? row.stats.end : row.end,
      ee: row.ee,
      fit: row.matchInputs && row.matchInputs.fit !== undefined ? row.matchInputs.fit : row.fit,
      activity30: row.matchInputs && row.matchInputs.activity30 !== undefined ? row.matchInputs.activity30 : row.activity30,
      xanax30: row.matchInputs && row.matchInputs.xanax30 !== undefined ? row.matchInputs.xanax30 : row.xanax30,
      refills30: row.matchInputs && row.matchInputs.refills30 !== undefined ? row.matchInputs.refills30 : row.refills30,
      attacks30: row.matchInputs && row.matchInputs.attacks30 !== undefined ? row.matchInputs.attacks30 : row.attacks30,
      rwHits30: row.matchInputs && row.matchInputs.rwHits30 !== undefined ? row.matchInputs.rwHits30 : row.rwHits30,
      company: candidate.desiredCompany || row.preferredCompany,
      role: candidate.desiredRole,
      salary: candidate.expectedSalary,
      availability: candidate.availability
    };

    const breakdown = {};
    let earnedWeight = 0;
    let availableWeight = 0;
    let knownCriteria = 0;
    let enabledCriteria = 0;

    CRITERIA_KEYS.forEach((key) => {
      const criterion = profile.criteria[key];
      if (!criterion || !criterion.enabled) return;
      enabledCriteria += 1;
      let score;
      if (key === 'salary') {
        score = scoreSalary(values[key], criterion.max, criterion.weight);
      } else if (key === 'company') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeCompany);
      } else if (key === 'role') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeRole);
      } else if (key === 'availability') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeAvailability);
      } else {
        score = scoreNumeric(values[key], criterion.target, criterion.weight);
      }
      breakdown[key] = Object.assign({ label: CRITERIA_LABELS[key] }, score);
      if (!score.known) return;
      knownCriteria += 1;
      earnedWeight += score.earned;
      availableWeight += score.available;
    });

    return {
      score: availableWeight > 0 ? roundOne((earnedWeight / availableWeight) * 100) : null,
      earnedWeight: roundOne(earnedWeight),
      availableWeight: roundOne(availableWeight),
      knownCriteria,
      enabledCriteria,
      completeness: enabledCriteria > 0 ? roundOne(knownCriteria / enabledCriteria) : null,
      breakdown
    };
  }

  return Object.freeze({
    CRITERIA_KEYS,
    AVAILABILITY_VALUES,
    createDefaultProfile,
    normalizeProfile,
    normalizeCandidate,
    normalizeRole,
    normalizeCompany,
    normalizeAvailability,
    scoreNumeric,
    scoreSalary,
    scoreCategorical,
    evaluateMatch,
    mergeCandidateValues
  });
});

/* bundled runtime: forum-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_ForumCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PIPELINE_STAGES = Object.freeze([
    'Not Contacted',
    'Shortlisted',
    'Contacted',
    'Replied',
    'Hired',
    'Rejected'
  ]);

  const AVAILABILITY_VALUES = Object.freeze(['Available', 'Unavailable', 'Unknown']);
  const SOURCE_TYPES = Object.freeze(['JOB SEEKER', 'TRAIN BUYER', 'COMPANY FORUM', 'FACTION FORUM', 'MANUAL']);
  const APPROVED_PLACEHOLDERS = Object.freeze([
    'name', 'player_id', 'looking_for', 'company_name', 'current_company', 'match_score', 'fit_score'
  ]);

  const COMPANY_ALIASES = Object.freeze([
    ['adult novelties', 'Adult Novelties'], ['adult novelty', 'Adult Novelties'], ['an', 'Adult Novelties'],
    ['amusement park', 'Amusement Park'], ['candle shop', 'Candle Shop'], ['car dealership', 'Car Dealership'],
    ['clothing store', 'Clothing Store'], ['cruise line', 'Cruise Line'], ['cyber cafe', 'Cyber Cafe'],
    ['detective agency', 'Detective Agency'], ['farm', 'Farm'], ['firework stand', 'Firework Stand'],
    ['fitness center', 'Fitness Center'], ['flower shop', 'Flower Shop'], ['furniture store', 'Furniture Store'],
    ['game shop', 'Game Shop'], ['gas station', 'Gas Station'], ['gents strip club', 'Gents Strip Club'],
    ['grocery store', 'Grocery Store'], ['gun shop', 'Gun Shop'], ['hair salon', 'Hair Salon'],
    ['ladies strip club', 'Ladies Strip Club'], ['law firm', 'Law Firm'], ['lingerie store', 'Lingerie Store'],
    ['logistics management', 'Logistics Management'], ['meat warehouse', 'Meat Warehouse'], ['mechanic shop', 'Mechanic Shop'],
    ['mining corporation', 'Mining Corporation'], ['music store', 'Music Store'], ['nightclub', 'Nightclub'],
    ['oil rig', 'Oil Rig'], ['private security firm', 'Private Security Firm'], ['property broker', 'Property Broker'],
    ['pub', 'Pub'], ['restaurant', 'Restaurant'], ['software corporation', 'Software Corporation'],
    ['sweet shop', 'Sweet Shop'], ['television network', 'Television Network'], ['theater', 'Theater'],
    ['toy shop', 'Toy Shop'], ['travel agency', 'Travel Agency'], ['wedding chapel', 'Wedding Chapel'], ['zoo', 'Zoo']
  ]);

  function text(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeStage(value) {
    const raw = text(value).toLowerCase();
    const found = PIPELINE_STAGES.find(stage => stage.toLowerCase() === raw);
    return found || 'Not Contacted';
  }

  function parseCompactStatNumber(value) {
    const raw = String(value == null ? '' : value).trim().replace(/,/g, '').replace(/\s+/g, '');
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/i);
    if (!match) return null;
    const multiplier = {k:1e3,m:1e6,b:1e9}[String(match[2] || '').toLowerCase()] || 1;
    const out = Number(match[1]) * multiplier;
    return Number.isFinite(out) ? Math.round(out) : null;
  }

  function normalizeWorkStats(input = {}) {
    const man = finite(input.man);
    const int = finite(input.int);
    const end = finite(input.end);
    return {man,int,end,total:man !== null && int !== null && end !== null ? man + int + end : null};
  }

  function parseWorkStats(value) {
    const raw = String(value == null ? '' : value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const number = '([0-9]+(?:[,.][0-9]+)*(?:\s*[kKmMbB])?)';
    const read = (fullPattern, abbreviation) => {
      const patterns = [
        new RegExp('\\b(?:' + fullPattern + ')\\b\\s*(?:[:=\\-]\\s*|\\s+)' + number, 'i'),
        new RegExp('\\b' + abbreviation + '\\b\\s*[:=\\-]\\s*' + number, 'i'),
        new RegExp('\\b' + abbreviation + '\\b\\s+' + '([0-9]+(?:[,.][0-9]+)*\\s*[kKmMbB])', 'i'),
        new RegExp('\\b' + abbreviation.toUpperCase() + '\\b\\s+' + number)
      ];
      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) return parseCompactStatNumber(match[1]);
      }
      return null;
    };
    return normalizeWorkStats({
      man:read('manual\\s+labou?r','man'),
      int:read('intelligence','int'),
      end:read('endurance','end')
    });
  }

  function normalizeAvailability(value) {
    const raw = text(value).toLowerCase().replace(/[_-]+/g, ' ');
    if (!raw) return 'Unknown';
    if (/^(available|immediate|immediately|now|asap|ready|yes)$/.test(raw) || /available\s+(now|immediately|today)/.test(raw)) return 'Available';
    if (/^(unavailable|not available|no|none)$/.test(raw) || /not\s+available/.test(raw)) return 'Unavailable';
    return 'Unknown';
  }

  function normalizeSource(input) {
    const source = input && typeof input === 'object' ? input : {};
    const sourceTypeRaw = text(source.sourceType).toUpperCase();
    const sourceType = SOURCE_TYPES.includes(sourceTypeRaw) ? sourceTypeRaw : 'COMPANY FORUM';
    const parsed = source.parsed && typeof source.parsed === 'object' ? source.parsed : {};
    const postedAt = finite(source.postedAt);
    const userId = finite(source.userId || source.playerId || source.id);
    const threadId = text(source.threadId);
    const postId = text(source.postId);
    return {
      sourceId: text(source.sourceId) || sourceIdFor({ sourceType, threadId, postId, userId }),
      userId: userId == null ? null : Math.trunc(userId),
      sourceType,
      threadId,
      postId,
      postedAt: postedAt == null ? null : postedAt,
      postUrl: text(source.postUrl || source.url || source.forumUrl),
      authorName: text(source.authorName || source.name),
      text: String(source.text ?? source.body ?? ''),
      parsed: {
        desiredCompany: text(parsed.desiredCompany),
        desiredCompanyStars: finite(parsed.desiredCompanyStars),
        desiredRole: text(parsed.desiredRole),
        wantsTrains: parsed.wantsTrains === true,
        trainAmountMin: finite(parsed.trainAmountMin),
        trainAmountMax: finite(parsed.trainAmountMax),
        primaryWorkStat: text(parsed.primaryWorkStat).toUpperCase(),
        availability: normalizeAvailability(parsed.availability),
        workStats: normalizeWorkStats(parsed.workStats)
      },
      importedAt: text(source.importedAt) || new Date().toISOString()
    };
  }

  function sourceIdFor(input) {
    const source = input && typeof input === 'object' ? input : {};
    const sourceType = text(source.sourceType).toUpperCase() || 'SOURCE';
    const threadId = text(source.threadId) || 'thread';
    const postId = text(source.postId) || 'post';
    const userId = text(source.userId || source.playerId || source.id) || 'user';
    return `${sourceType}:${threadId}:${postId}:${userId}`;
  }

  function findCompany(lower) {
    for (const [alias, label] of COMPANY_ALIASES) {
      if (alias.length <= 2) {
        const re = new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
        if (re.test(lower)) return label;
      } else if (lower.includes(alias)) {
        return label;
      }
    }
    return '';
  }

  function parseTrainRange(lower) {
    const range = lower.match(/\b(\d{1,4})\s*(?:-|to|–|—)\s*(\d{1,4})\s+trains?\b/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    const single = lower.match(/\b(?:buy(?:ing)?|purchase|looking\s+to\s+buy|want(?:ing)?|need(?:ing)?)\s+(?:around\s+|about\s+|up\s+to\s+)?(\d{1,4})\s+trains?\b/i)
      || lower.match(/\b(\d{1,4})\s+trains?\b/i);
    if (single) {
      const n = Number(single[1]);
      return { min: n, max: n };
    }
    return { min: null, max: null };
  }

  function parseForumIntent(value) {
    const raw = text(value);
    const lower = raw.toLowerCase();
    const desiredCompany = findCompany(lower);
    let desiredCompanyStars = null;
    const stars = lower.match(/\b(\d{1,2})\s*(?:\*|star(?:s)?)\s*(?=[a-z])/i)
      || lower.match(/\b(\d{1,2})\s*(?:\*|star(?:s)?)\b/i);
    if (stars) desiredCompanyStars = Math.max(0, Math.min(10, Number(stars[1])));

    const trainIntent = /\b(?:buying|buy\s+trains?|looking\s+to\s+buy|want(?:ing)?\s+to\s+buy|need(?:ing)?\s+trains?|train\s+buyer)\b/i.test(lower);
    const range = trainIntent ? parseTrainRange(lower) : { min: null, max: null };

    let primaryWorkStat = '';
    if (/\b(?:intelligence|int)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:intelligence|int)\b/i.test(lower)) primaryWorkStat = 'INT';
    else if (/\b(?:manual\s+labor|man)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:manual\s+labor|man)\b/i.test(lower)) primaryWorkStat = 'MAN';
    else if (/\b(?:endurance|end)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:endurance|end)\b/i.test(lower)) primaryWorkStat = 'END';

    let availability = 'Unknown';
    if (/\b(?:available\s+(?:now|immediately|today)|can\s+start\s+(?:now|immediately|today)|ready\s+now|asap)\b/i.test(lower)) availability = 'Available';
    else if (/\b(?:not\s+available|unavailable|cannot\s+start|can't\s+start)\b/i.test(lower)) availability = 'Unavailable';

    let desiredRole = '';
    const role = raw.match(/\b(?:role|position)\s*[:=-]\s*([^,.;\n]+)/i);
    if (role) desiredRole = text(role[1]);

    return {
      desiredCompany,
      desiredCompanyStars,
      desiredRole,
      wantsTrains: trainIntent,
      trainAmountMin: range.min,
      trainAmountMax: range.max,
      primaryWorkStat,
      availability
    };
  }

  function hasManual(candidate, key) {
    const manual = candidate && candidate.manualFields && typeof candidate.manualFields === 'object' ? candidate.manualFields : {};
    if (!Object.prototype.hasOwnProperty.call(manual, key)) return false;
    const value = manual[key];
    return value !== null && value !== undefined && value !== '';
  }

  function mergeCandidateFromSource(candidateInput, sourceInput) {
    const candidate = candidateInput && typeof candidateInput === 'object' ? { ...candidateInput } : {};
    const source = normalizeSource(sourceInput || {});
    const parsed = source.parsed || {};
    const discoverySources = Array.isArray(candidate.discoverySources) ? [...candidate.discoverySources] : [];
    if (source.sourceType && !discoverySources.includes(source.sourceType)) discoverySources.push(source.sourceType);

    const out = {
      ...candidate,
      userId: candidate.userId || source.userId,
      pipelineStage: normalizeStage(candidate.pipelineStage),
      recruiterNote: text(candidate.recruiterNote),
      expectedSalary: finite(candidate.expectedSalary),
      latestForumSourceId: source.sourceId || candidate.latestForumSourceId || '',
      discoverySources,
      createdAt: text(candidate.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!hasManual(candidate, 'desiredCompany') && !text(out.desiredCompany) && parsed.desiredCompany) out.desiredCompany = parsed.desiredCompany;
    if (!hasManual(candidate, 'desiredRole') && !text(out.desiredRole) && parsed.desiredRole) out.desiredRole = parsed.desiredRole;
    if (!hasManual(candidate, 'availability')) {
      const current = normalizeAvailability(out.availability);
      if (current === 'Unknown' && parsed.availability && parsed.availability !== 'Unknown') out.availability = parsed.availability;
      else out.availability = current;
    }

    const parsedStats = normalizeWorkStats(parsed.workStats);
    const existingStats = candidate.stats && typeof candidate.stats === 'object' ? {...candidate.stats} : {};
    const mergedStats = {...existingStats};
    for (const key of ['man','int','end']) if (finite(mergedStats[key]) === null && parsedStats[key] !== null) mergedStats[key] = parsedStats[key];
    const known = ['man','int','end'].map(key => finite(mergedStats[key]));
    if (known.every(value => value !== null)) mergedStats.total = known.reduce((sum,value) => sum + value,0);
    else if (finite(existingStats.total) === null) delete mergedStats.total;
    if (Object.keys(mergedStats).length) out.stats = mergedStats;

    out.forumParsed = {
      ...(candidate.forumParsed && typeof candidate.forumParsed === 'object' ? candidate.forumParsed : {}),
      desiredCompany: parsed.desiredCompany || '',
      desiredCompanyStars: parsed.desiredCompanyStars,
      desiredRole: parsed.desiredRole || '',
      wantsTrains: parsed.wantsTrains === true,
      trainAmountMin: parsed.trainAmountMin,
      trainAmountMax: parsed.trainAmountMax,
      primaryWorkStat: parsed.primaryWorkStat || '',
      availability: parsed.availability || 'Unknown',
      workStats: parsedStats
    };
    return out;
  }

  function sanitizeContinuation(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), 'https://api.torn.com');
      if (url.protocol !== 'https:' || url.hostname !== 'api.torn.com') return '';
      if (!url.pathname.startsWith('/v2/')) return '';
      url.searchParams.delete('key');
      url.searchParams.delete('comment');
      url.hash = '';
      const query = url.searchParams.toString();
      return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return '';
    }
  }

  function substituteMessage(template, values) {
    const source = values && typeof values === 'object' ? values : {};
    let output = String(template == null ? '' : template);
    for (const key of APPROVED_PLACEHOLDERS) {
      const replacement = source[key] == null ? '' : String(source[key]);
      output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), replacement);
    }
    output = output.replace(/\{[a-z0-9_]+\}/gi, '');
    output = output.replace(/[ \t]+([,.;:!?])/g, '$1');
    output = output.replace(/\(\s*\)/g, '');
    output = output.replace(/[ \t]{2,}/g, ' ');
    output = output.replace(/\n[ \t]+/g, '\n');
    output = output.replace(/\n{3,}/g, '\n\n');
    return output.trim();
  }

  return Object.freeze({
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    SOURCE_TYPES,
    APPROVED_PLACEHOLDERS,
    normalizeSource,
    sourceIdFor,
    normalizeStage,
    normalizeAvailability,
    parseForumIntent,
    parseWorkStats,
    mergeCandidateFromSource,
    sanitizeContinuation,
    substituteMessage
  });
});

/* bundled runtime: v45-runtime.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Runtime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_VERSION = 12;
  const PAGE_GROUPS = Object.freeze([
    Object.freeze({label:'RECRUITMENT', pages:Object.freeze([
      Object.freeze({id:'overview', label:'Overview'}),
      Object.freeze({id:'discover', label:'Discover'}),
      Object.freeze({id:'candidates', label:'Candidates'}),
      Object.freeze({id:'pipeline', label:'Pipeline'})
    ])}),
    Object.freeze({label:'INTELLIGENCE', pages:Object.freeze([
      Object.freeze({id:'scout', label:'Scout'}),
      Object.freeze({id:'smart-match', label:'Smart Match'}),
      Object.freeze({id:'global-intelligence', label:'Global Intelligence'})
    ])}),
    Object.freeze({label:'APPLICATION', pages:Object.freeze([
      Object.freeze({id:'settings', label:'Settings'}),
      Object.freeze({id:'data', label:'Data'}),
      Object.freeze({id:'logs', label:'Logs', advancedOnly:true})
    ])})
  ]);

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
    pipeline:{title:'Pipeline / Stage',body:'Stage changes only when you explicitly move a candidate, use the context menu, or edit the stage field.'},
    messagePlayer:{title:'Recruit Player',body:'Freshly checks the target through Torn v2, prepares the saved Company or Faction private-chat template, opens the player profile and fills Torn private chat. You still press Send.'},
    defaultMessage:{title:'Recruitment Templates',body:'Company and Faction private-chat templates are saved separately and remain browser-local.'},
    data:{title:'Data',body:'Shows local IndexedDB counts and export/reset controls. No workspace backup/import system is added in v4.5.'},
    logs:{title:'Logs',body:'Shows sanitized application events only. API keys, private messages, recruiter notes and forum bodies are excluded.'}
  });

  const PRIVATE_LOG_FIELDS = new Set(['apiKey','key','messageBody','forumBody','rawText','recruiterNote','defaultMessage','preparedMessage','companyRecruitmentMessage','factionRecruitmentMessage']);

  function normalizePage(value, complexity = 'simple') {
    const requested = String(value || '').trim().toLowerCase();
    const pages = PAGE_GROUPS.flatMap(group => group.pages);
    const found = pages.find(page => page.id === requested);
    if (!found) return 'overview';
    if (found.advancedOnly && complexity !== 'advanced') return 'overview';
    return found.id;
  }

  function visiblePages(complexity = 'simple') {
    return PAGE_GROUPS.map(group => ({
      label:group.label,
      pages:group.pages.filter(page => !page.advancedOnly || complexity === 'advanced').map(page => ({...page}))
    }));
  }

  function normalizeStage(value) {
    const raw = String(value || '').trim().toLowerCase();
    return 