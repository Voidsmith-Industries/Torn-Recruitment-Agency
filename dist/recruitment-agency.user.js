// ==UserScript==
// @name         R4G3RUNN3R's Recruitment Agency
// @namespace    r4g3runn3r.recruitment.agency
// @version      4.8.4
// @description  Sortable Company and Faction recruitment search with status, organisation, work-stat and Last Online filters plus safe messaging.
// @author       R4G3RUNN3R[3877028]
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%2311170d%22%2F%3E%3Ccircle%20cx%3D%2228%22%20cy%3D%2228%22%20r%3D%2213%22%20fill%3D%22none%22%20stroke%3D%22%23f3f7ee%22%20stroke-width%3D%226%22%2F%3E%3Cpath%20d%3D%22M37.5%2037.5L50%2050%22%20fill%3D%22none%22%20stroke%3D%22%23d9ff52%22%20stroke-width%3D%227%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E
// @license      MIT
// @match        https://www.torn.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @downloadURL  https://voidsmithindustries.com/torn/install/recruitment-agency.user.js
// @updateURL    https://voidsmithindustries.com/torn/install/recruitment-agency.user.js
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
    const number = '([0-9]+(?:[,.][0-9]+)*(?:\\s*[kKmMbB])?)';
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

  function dbUpgradePlan() {
    return Object.freeze({
      version:DB_VERSION,
      stores:Object.freeze({
        forumSources:Object.freeze({
          keyPath:'sourceId',
          indexes:Object.freeze([
            Object.freeze({name:'userId', keyPath:'userId'}),
            Object.freeze({name:'postedAt', keyPath:'postedAt'}),
            Object.freeze({name:'sourceType', keyPath:'sourceType'}),
            Object.freeze({name:'threadId', keyPath:'threadId'})
          ])
        }),
        forumSyncState:Object.freeze({keyPath:'feedId', indexes:Object.freeze([])})
      })
    });
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

  function kpiCounts(candidates = [], highMatchThreshold = 80) {
    const rows = Array.isArray(candidates) ? candidates : [];
    return {
      active:rows.filter(row => String(row.status || 'active').toLowerCase() !== 'inactive').length,
      highMatch:rows.filter(row => Number(row.matchScore) >= Number(highMatchThreshold || 80)).length,
      shortlisted:rows.filter(row => normalizeStage(row.pipelineStage) === 'Shortlisted').length,
      replied:rows.filter(row => normalizeStage(row.pipelineStage) === 'Replied').length
    };
  }

  return Object.freeze({
    DB_VERSION,
    PAGE_GROUPS,
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    STAGE_COLORS,
    AVAILABILITY_COLORS,
    DEFAULT_RECRUITMENT_MESSAGE,
    DEFAULT_COMPANY_RECRUITMENT_MESSAGE,
    DEFAULT_FACTION_RECRUITMENT_MESSAGE,
    HELP_REGISTRY,
    normalizePage,
    visiblePages,
    normalizeStage,
    normalizeAvailability,
    normalizeCandidateRecord,
    dbUpgradePlan,
    normalizeRecruitmentSettings,
    sanitizeLogDetails,
    makeLogEntry,
    kpiCounts
  });
});

/* bundled runtime: v45-candidates.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Candidates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PIPELINE_STAGES = Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const AVAILABILITY_VALUES = Object.freeze(['Available','Unavailable','Unknown']);

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const out = Number(value);
    return Number.isFinite(out) ? out : null;
  }

  function text(value) { return String(value ?? '').trim(); }

  function normalizeStage(value) {
    const raw = text(value).toLowerCase();
    return PIPELINE_STAGES.find(stage => stage.toLowerCase() === raw) || 'Not Contacted';
  }

  function normalizeAvailability(value) {
    const raw = text(value).toLowerCase();
    if (!raw) return 'Unknown';
    return AVAILABILITY_VALUES.find(item => item.toLowerCase() === raw) || 'Unknown';
  }

  function composeCandidateView(input = {}) {
    const candidate = input.candidate || {};
    const source = input.source || {};
    const result = input.result || {};
    const scout = input.scout || result.scout || {};
    const profile = scout.profile || result.api || result.profile || {};
    const match = input.match || result.matchResult || {};
    const userId = text(candidate.userId || result.userId || result.id || profile.id);
    const name = text(candidate.name || result.name || profile.name) || (userId ? `User ${userId}` : 'Unknown player');
    const desiredCompany = text(candidate.desiredCompany || source.parsed?.desiredCompany || result.preferredCompany || result.company);
    const desiredRole = text(candidate.desiredRole || source.parsed?.desiredRole);
    const wantsTrains = candidate.wantsTrains ?? source.parsed?.wantsTrains ?? false;
    const trainMin = finite(candidate.trainAmountMin ?? source.parsed?.trainAmountMin);
    const trainMax = finite(candidate.trainAmountMax ?? source.parsed?.trainAmountMax);
    const lookingForParts = [];
    if (desiredCompany) lookingForParts.push(desiredCompany);
    if (desiredRole) lookingForParts.push(desiredRole);
    if (wantsTrains) {
      if (trainMin !== null && trainMax !== null) lookingForParts.push(`${trainMin}-${trainMax} trains`);
      else lookingForParts.push('trains');
    }
    return {
      userId,
      name,
      pipelineStage:normalizeStage(candidate.pipelineStage),
      availability:normalizeAvailability(candidate.availability || source.parsed?.availability),
      recruiterNote:text(candidate.recruiterNote),
      expectedSalary:finite(candidate.expectedSalary),
      desiredCompany,
      desiredRole,
      lookingFor:lookingForParts.join(' · ') || 'Unknown',
      latestForumSourceId:text(candidate.latestForumSourceId || source.sourceId),
      sourceType:text(source.sourceType || result.sourceType || candidate.discoverySources?.[0]),
      forumUrl:text(source.postUrl || source.url || source.forumUrl),
      currentCompany:text(result.currentCompany || profile.company?.name || profile.company_name),
      matchScore:finite(match.score ?? result.matchScore),
      fitScore:finite(result.fit ?? scout.currentFit ?? scout.fit ?? scout.originalFit),
      ee:finite(result.ee),
      man:finite(result.stats?.man),
      int:finite(result.stats?.int),
      end:finite(result.stats?.end),
      lastActive:finite(profile.lastActionTs ?? result.lastActionTs),
      localOnly:true
    };
  }

  function contextMenuModel(view = {}) {
    const availability = normalizeAvailability(view.availability);
    return [
      {id:'message',label:'Message Player'},
      {id:'details',label:'View Details'},
      {id:'profile',label:'Open Torn Profile'},
      {id:'forum',label:'Open Latest Forum Post',disabled:!text(view.forumUrl)},
      {separator:true},
      {id:'stage',label:'Move to Stage',children:PIPELINE_STAGES.map(stage => ({id:`stage:${stage}`,label:stage,checked:normalizeStage(view.pipelineStage)===stage}))},
      {id:'availability',label:'Availability',children:AVAILABILITY_VALUES.map(value => ({id:`availability:${value}`,label:value,checked:availability===value}))},
      {separator:true},
      {id:'scout',label:'Scout Player'},
      {id:'edit',label:'Edit Candidate'},
      {id:'delete',label:'Delete Candidate'}
    ];
  }

  function changeStage(candidate = {}, stage) {
    const next = normalizeStage(stage);
    return {...candidate,pipelineStage:next,updatedAt:new Date().toISOString()};
  }

  function changeAvailability(candidate = {}, availability) {
    return {...candidate,availability:normalizeAvailability(availability),updatedAt:new Date().toISOString()};
  }

  function pipelineBuckets(candidates = []) {
    const buckets = Object.fromEntries(PIPELINE_STAGES.map(stage => [stage,[]]));
    for (const candidate of candidates || []) buckets[normalizeStage(candidate.pipelineStage)].push(candidate);
    return buckets;
  }

  function messageValues(view = {}, ownCompanyName = '') {
    return {
      name:text(view.name),
      player_id:text(view.userId),
      looking_for:text(view.lookingFor === 'Unknown' ? '' : view.lookingFor),
      company_name:text(ownCompanyName),
      current_company:text(view.currentCompany),
      match_score:view.matchScore == null ? '' : String(view.matchScore),
      fit_score:view.fitScore == null ? '' : String(view.fitScore)
    };
  }

  function tornProfileUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/profiles.php?XID=${id}` : '';
  }

  function tornMessageUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/messages.php#/p=compose&XID=${id}` : '';
  }

  return Object.freeze({
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    composeCandidateView,
    contextMenuModel,
    changeStage,
    changeAvailability,
    pipelineBuckets,
    messageValues,
    tornProfileUrl,
    tornMessageUrl
  });
});

/* bundled runtime: v45-discovery.js */
(function (root, factory) {
  let forum = root && root.RA_ForumCore;
  if (!forum && typeof module === 'object' && module.exports) forum = require('./forum-core');
  const api = factory(forum);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Discovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ForumCore) {
  'use strict';
  if (!ForumCore) throw new Error('RA_ForumCore is required.');

  const SOURCE_TYPES = Object.freeze({
    company:'COMPANY FORUM',
    faction:'FACTION FORUM',
    training:'TRAIN BUYER',
    manual:'MANUAL'
  });

  function text(value) { return String(value ?? '').trim(); }
  function finite(value) { const out=Number(value); return Number.isFinite(out) ? out : null; }

  function feedDefinitions(recruitment = {}) {
    return [
      {feedId:'company',label:'Company Forum',sourceType:SOURCE_TYPES.company,threadId:text(recruitment.companyThreadId),enabled:!!text(recruitment.companyThreadId)},
      {feedId:'faction',label:'Faction Forum',sourceType:SOURCE_TYPES.faction,threadId:text(recruitment.factionThreadId),enabled:!!text(recruitment.factionThreadId)},
      {feedId:'training',label:'Train Buyers',sourceType:SOURCE_TYPES.training,threadId:text(recruitment.trainingThreadId),enabled:!!text(recruitment.trainingThreadId)}
    ];
  }

  function stripHtml(value) {
    return text(value).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  }

  function postToSource(post = {}, feed = {}, observedAt = Date.now()) {
    const userId = finite(post.author?.id ?? post.user_id ?? post.userId);
    if (!userId) return null;
    const body = stripHtml(post.content ?? post.body ?? post.text);
    if (!body) return null;
    const postedRaw = finite(post.created_time ?? post.created_at ?? post.postedAt);
    const postedAt = postedRaw === null ? Number(observedAt) : (postedRaw < 1e12 ? postedRaw * 1000 : postedRaw);
    const source = ForumCore.normalizeSource({
      sourceType:feed.sourceType,
      threadId:feed.threadId,
      postId:post.id ?? post.post_id,
      userId,
      postedAt,
      observedAt,
      authorName:text(post.author?.username ?? post.author?.name ?? post.name),
      body,
      parsed:{...ForumCore.parseForumIntent(body),workStats:ForumCore.parseWorkStats(body)},
      url:text(post.url || feed.url)
    });
    source.body = body;
    source.authorName = text(post.author?.username ?? post.author?.name ?? post.name);
    return source;
  }

  function initialCounters(previous = {}) {
    return {
      pagesChecked:Number(previous.pagesChecked || 0),
      postsExamined:Number(previous.postsExamined || 0),
      recentPosts:Number(previous.recentPosts || 0),
      candidatesCreated:Number(previous.candidatesCreated || 0),
      candidatesUpdated:Number(previous.candidatesUpdated || 0),
      explicitTrainBuyers:Number(previous.explicitTrainBuyers || 0),
      companyLookups:Number(previous.companyLookups || 0)
    };
  }

  async function processDiscoveryPage(options = {}) {
    const feed = options.feed || {};
    const posts = Array.isArray(options.posts) ? options.posts : [];
    const persistSource = options.persistSource;
    const getCandidate = options.getCandidate;
    const persistCandidate = options.persistCandidate;
    const persistCounters = options.persistCounters;
    const persistCheckpoint = options.persistCheckpoint;
    if (![persistSource,getCandidate,persistCandidate,persistCounters,persistCheckpoint].every(fn => typeof fn === 'function')) throw new Error('Discovery persistence callbacks are required.');

    const counters = initialCounters(options.counters);
    counters.pagesChecked += 1;
    const recentCutoff = Number(options.recentCutoff || 0);

    for (const post of posts) {
      counters.postsExamined += 1;
      const source = postToSource(post,feed,options.observedAt || Date.now());
      if (!source) continue;
      if (!recentCutoff || Number(source.postedAt || 0) >= recentCutoff) counters.recentPosts += 1;
      await persistSource(source);
      const existing = await getCandidate(source.userId);
      const merged = ForumCore.mergeCandidateFromSource(existing || {userId:source.userId,pipelineStage:'Not Contacted'}, source);
      merged.name = text(existing?.name || source.authorName || merged.name);
      merged.latestForumSourceId = source.sourceId;
      merged.updatedAt = new Date(options.observedAt || Date.now()).toISOString();
      await persistCandidate(merged, source);
      if (existing) counters.candidatesUpdated += 1;
      else counters.candidatesCreated += 1;
      if (source.parsed?.wantsTrains) counters.explicitTrainBuyers += 1;
    }

    await persistCounters({...counters});
    const safeContinuation = ForumCore.sanitizeContinuation(options.continuation || '');
    await persistCheckpoint({
      feedId:text(feed.feedId),
      next:safeContinuation,
      updatedAt:Number(options.observedAt || Date.now()),
      resumeAvailable:!!safeContinuation,
      counters:{...counters}
    });
    return {counters,safeContinuation};
  }

  function addCandidateRecord(input = {}, existing = null, now = Date.now()) {
    const userId = text(input.userId || input.id);
    if (!/^\d+$/.test(userId)) throw new Error('A valid Torn player ID is required.');
    const base = existing || {userId,pipelineStage:'Not Contacted',discoverySources:[]};
    const manualFields = {...(base.manualFields || {})};
    for (const key of ['desiredCompany','desiredRole','expectedSalary','availability']) {
      if (Object.prototype.hasOwnProperty.call(input,key)) manualFields[key]=input[key];
    }
    return {
      ...base,
      ...input,
      userId,
      pipelineStage:ForumCore.normalizeStage(base.pipelineStage || input.pipelineStage),
      availability:Object.prototype.hasOwnProperty.call(input,'availability') ? ForumCore.normalizeAvailability(input.availability) : ForumCore.normalizeAvailability(base.availability),
      manualFields,
      discoverySources:[...new Set([...(base.discoverySources || []),SOURCE_TYPES.manual])],
      createdAt:base.createdAt || new Date(now).toISOString(),
      updatedAt:new Date(now).toISOString()
    };
  }

  function fillCompaniesPlan(candidates = []) {
    return (candidates || []).filter(candidate => !text(candidate.currentCompany)).map(candidate => ({
      userId:Number(candidate.userId),
      status:'pending',
      error:''
    })).filter(item => Number.isFinite(item.userId) && item.userId > 0);
  }

  return Object.freeze({
    SOURCE_TYPES,
    feedDefinitions,
    stripHtml,
    postToSource,
    initialCounters,
    processDiscoveryPage,
    addCandidateRecord,
    fillCompaniesPlan
  });
});

/* bundled runtime: v45-messaging.js */
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
    const job = response?.job ?? response?.user?.job ?? null;
    const type = text(job?.type).toLowerCase();
    if (job && type === 'company') {
      const currentId = text(job.id ?? job.company_id ?? job.companyId);
      return {
        eligible:false,
        currentName:text(job.name ?? job.company_name ?? job.companyName) || (currentId ? `Company #${currentId}` : 'a company'),
        currentId
      };
    }
    return {eligible:true,currentName:'',currentId:''};
  }

  function factionRecruitmentEligibility(response = {}) {
    const faction = response?.faction ?? response?.user?.faction ?? null;
    if (faction && (faction.id != null || text(faction.name))) {
      const currentId = text(faction.id ?? faction.faction_id ?? faction.factionId);
      return {
        eligible:false,
        currentName:text(faction.name ?? faction.faction_name ?? faction.factionName) || (currentId ? `Faction #${currentId}` : 'a faction'),
        currentId
      };
    }
    return {eligible:true,currentName:'',currentId:''};
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

/* bundled runtime: v46-domain-core.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V46DomainCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHARED_PLAYER_FIELDS = Object.freeze([
    'name','level','ee','man','int','end','total','factionId','factionName',
    'currentCompany','currentCompanyId','currentCompanyRating','currentCompanyPosition','companyCheckedAt',
    'networth','fit','fitType','lastActive','onlineStatus','lastScoutAt','lastGlobalAt',
    'activity30','xanax30','refills30','attacks30','rwHits30','scoutStatus'
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

/* bundled runtime: v46-storage-core.js */
(function (root, factory) {
  let Domain = root && root.RA_V46DomainCore;
  if (!Domain && typeof module === 'object' && module.exports) Domain = require('./v46-domain-core');
  const api = factory(Domain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V46StorageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Domain) {
  'use strict';
  if (!Domain) throw new Error('RA_V46DomainCore is required.');

  const DB_VERSION = 13;
  const BACKFILL_MARKER = 'v46-foundation-backfill-v1';
  const STORE_DEFINITIONS = Object.freeze({
    playerIntelligence:Object.freeze({keyPath:'userId',indexes:Object.freeze([
      Object.freeze({name:'nameLower',keyPath:'nameLower'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    companyRecruitment:Object.freeze({keyPath:'userId',indexes:Object.freeze([
      Object.freeze({name:'pipelineStage',keyPath:'pipelineStage'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    factionRecruitment:Object.freeze({keyPath:'userId',indexes:Object.freeze([
      Object.freeze({name:'pipelineStage',keyPath:'pipelineStage'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])})
  });

  function text(value) { return String(value ?? '').trim(); }
  function legacyTimestamp(value, fallback = Date.now()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : Number(fallback);
  }
  function definedPatch(input = {}) {
    const out = {};
    for (const [key,value] of Object.entries(input)) if (value !== undefined) out[key] = value;
    return out;
  }

  function applyUpgrade(db) {
    for (const [storeName, definition] of Object.entries(STORE_DEFINITIONS)) {
      if (db.objectStoreNames.contains(storeName)) continue;
      const store = db.createObjectStore(storeName,{keyPath:definition.keyPath});
      for (const index of definition.indexes) store.createIndex(index.name,index.keyPath,{unique:false});
    }
  }

  function createRepositories(idb) {
    if (!idb || !['get','getAll','put'].every(name => typeof idb[name] === 'function')) {
      throw new Error('A compatible IndexedDB adapter is required.');
    }

    const players = {
      async ensure(userId, sharedPatch = {}, source = 'manual', observedAt = Date.now()) {
        const id = Domain.normalizeUserId(userId);
        const existing = await idb.get('playerIntelligence',id);
        const next = Domain.mergePlayerIntelligence(existing,{...definedPatch(sharedPatch),userId:id},source,observedAt);
        next.nameLower = text(next.name).toLowerCase();
        await idb.put('playerIntelligence',next);
        return next;
      }
    };

    async function ensureCompany(userId, recruitmentPatch = {}, options = {}) {
      const id = Domain.normalizeUserId(userId);
      const observedAt = legacyTimestamp(options.observedAt,Date.now());
      await players.ensure(id,{...candidateSharedPatch(recruitmentPatch),...definedPatch(options.sharedPatch || {})},options.source || 'company',observedAt);
      const existing = await idb.get('companyRecruitment',id);
      const input = {...(existing || {}),...recruitmentPatch,userId:id};
      if (!Object.prototype.hasOwnProperty.call(recruitmentPatch,'updatedAt')) input.updatedAt = observedAt;
      const next = Domain.normalizeCompanyRecruitment(input,observedAt,{ambiguous:options.ambiguous === true,assumed:options.assumed === true});
      await idb.put('companyRecruitment',next);
      return next;
    }

    async function ensureFaction(userId, recruitmentPatch = {}, options = {}) {
      const id = Domain.normalizeUserId(userId);
      const observedAt = legacyTimestamp(options.observedAt,Date.now());
      await players.ensure(id,{...candidateSharedPatch(recruitmentPatch),...definedPatch(options.sharedPatch || {})},options.source || 'faction',observedAt);
      const existing = await idb.get('factionRecruitment',id);
      const input = {...(existing || {}),...recruitmentPatch,userId:id};
      if (!Object.prototype.hasOwnProperty.call(recruitmentPatch,'updatedAt')) input.updatedAt = observedAt;
      const next = Domain.normalizeFactionRecruitment(input,observedAt,{ambiguous:options.ambiguous === true});
      await idb.put('factionRecruitment',next);
      return next;
    }

    function addObservation(map,userId,patch,source,observedAt) {
      let id;
      try { id = Domain.normalizeUserId(userId); } catch { return; }
      const clean = definedPatch(patch);
      const list = map.get(id) || [];
      list.push({patch:clean,source,observedAt:legacyTimestamp(observedAt,Date.now())});
      map.set(id,list);
    }

    function candidateSharedPatch(candidate = {}) {
      const stats = candidate.stats && typeof candidate.stats === 'object' ? candidate.stats : {};
      return definedPatch({
        name:candidate.name,
        ee:candidate.ee,
        man:stats.man ?? candidate.man,
        int:stats.int ?? candidate.int,
        end:stats.end ?? candidate.end,
        total:stats.total ?? candidate.total,
        currentCompany:candidate.currentCompany,
        currentCompanyId:candidate.currentCompanyId,
        currentCompanyRating:candidate.currentCompanyRating,
        currentCompanyPosition:candidate.currentCompanyPosition,
        companyCheckedAt:candidate.companyCheckedAt
      });
    }

    function scoutSharedPatch(snapshot = {}) {
      const profile = snapshot.profile || {};
      return definedPatch({
        name:profile.name,
        level:profile.level,
        factionId:profile.factionId,
        factionName:profile.factionName,
        networth:snapshot.extra?.networth,
        fit:snapshot.currentFit ?? snapshot.originalFit,
        fitType:snapshot.official ? 'official' : (snapshot.provisionalSource ? 'provisional' : 'unmeasured'),
        lastActive:profile.lastActionTs ? Number(profile.lastActionTs) * 1000 : null,
        lastScoutAt:snapshot.capturedAt
      });
    }

    function globalSharedPatch(global = {}) {
      return definedPatch({
        name:global.name,
        level:global.level,
        ee:global.ee,
        activity30:global.activity30,
        xanax30:global.xanax30,
        refills30:global.refills30,
        attacks30:global.attacks30,
        rwHits30:global.rwHits30,
        networth:global.networth,
        fit:global.fit,
        fitType:global.fitType,
        lastActive:global.lastActive,
        scoutStatus:global.scoutStatus,
        lastGlobalAt:global.observedAt
      });
    }

    function hasKnownDomainEvidence(candidate = {}, forumSources = []) {
      const labels = [
        ...(Array.isArray(candidate.discoverySources) ? candidate.discoverySources : []),
        ...forumSources.map(source => source?.sourceType)
      ].map(value => text(value).toUpperCase());
      return labels.some(label => ['COMPANY FORUM','TRAIN BUYER','MANUAL','FACTION FORUM'].includes(label));
    }

    async function backfillLegacy(observedAt = Date.now()) {
      const existingMarker = await idb.get('meta',BACKFILL_MARKER);
      if (existingMarker?.complete === true && existingMarker.counts) return {...existingMarker.counts};

      const [candidates,forumSources,scouts,globals,users] = await Promise.all([
        idb.getAll('candidateLocal'),
        idb.getAll('forumSources'),
        idb.getAll('scoutLatest'),
        idb.getAll('globalLatest'),
        idb.getAll('users')
      ]);

      const observations = new Map();
      for (const row of candidates) {
        addObservation(observations,row.userId,candidateSharedPatch(row),'legacy-candidate',row.updatedAt || row.createdAt || observedAt);
      }
      for (const row of forumSources) {
        addObservation(observations,row.userId,{name:row.authorName},'legacy-forum',row.lastSeenPost || row.postedAt || row.observedAt || observedAt);
      }
      for (const row of users) {
        addObservation(observations,row.userId,{...candidateSharedPatch(row),name:row.name,ee:row.ee},'legacy-user',row.lastSeenPost || row.postedAt || row.postDate || observedAt);
      }
      for (const row of scouts) {
        addObservation(observations,row.userId,scoutSharedPatch(row),'scout',row.capturedAt || observedAt);
      }
      for (const row of globals) {
        addObservation(observations,row.userId ?? row.playerId,globalSharedPatch(row),'global',row.observedAt || observedAt);
      }

      for (const [userId,list] of observations.entries()) {
        list.sort((a,b)=>a.observedAt-b.observedAt);
        for (const item of list) await players.ensure(userId,item.patch,item.source,item.observedAt);
      }

      let companyCount = 0;
      let factionCount = 0;
      let ambiguousCount = 0;
      for (const candidate of candidates) {
        let userId;
        try { userId = Domain.normalizeUserId(candidate.userId); } catch { continue; }
        const userSources = forumSources.filter(source => text(source?.userId) === userId);
        const domains = Domain.classifyLegacyDomains(candidate,userSources);
        const at = legacyTimestamp(candidate.updatedAt || candidate.createdAt,observedAt);
        const ambiguous = domains.length > 1;
        const knownEvidence = hasKnownDomainEvidence(candidate,userSources);
        if (ambiguous) ambiguousCount += 1;

        if (domains.includes('company')) {
          const converted = Domain.legacyCandidateToCompany(candidate,at,{ambiguous,assumed:!knownEvidence});
          const existing = await idb.get('companyRecruitment',userId);
          const next = existing ? {...converted,...existing,
            discoverySources:[...new Set([...(converted.discoverySources || []),...(existing.discoverySources || [])])],
            migrationReviewRequired:converted.migrationReviewRequired || existing.migrationReviewRequired || false,
            legacySharedState:existing.legacySharedState || converted.legacySharedState,
            legacyDomainAssumed:existing.legacyDomainAssumed || converted.legacyDomainAssumed
          } : converted;
          await idb.put('companyRecruitment',next);
          companyCount += 1;
        }

        if (domains.includes('faction')) {
          const converted = Domain.legacyCandidateToFaction(candidate,at,{ambiguous});
          const existing = await idb.get('factionRecruitment',userId);
          const next = existing ? {...converted,...existing,
            discoverySources:[...new Set([...(converted.discoverySources || []),...(existing.discoverySources || [])])],
            migrationReviewRequired:converted.migrationReviewRequired || existing.migrationReviewRequired || false,
            legacySharedState:existing.legacySharedState || converted.legacySharedState
          } : converted;
          await idb.put('factionRecruitment',next);
          factionCount += 1;
        }
      }

      const counts = {players:observations.size,company:companyCount,faction:factionCount,ambiguous:ambiguousCount};
      await idb.put('meta',{key:BACKFILL_MARKER,complete:true,completedAt:legacyTimestamp(observedAt,Date.now()),counts});
      return counts;
    }

    return Object.freeze({
      players:Object.freeze({ensure:players.ensure}),
      company:Object.freeze({ensure:ensureCompany}),
      faction:Object.freeze({ensure:ensureFaction}),
      backfillLegacy
    });
  }

  return Object.freeze({DB_VERSION,BACKFILL_MARKER,STORE_DEFINITIONS,applyUpgrade,createRepositories,legacyTimestamp});
});

/* bundled runtime: v46-navigation.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V46Navigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPANY_PAGES = Object.freeze([
    Object.freeze({id:'company-candidates',label:'Search & Results',core:true}),
    Object.freeze({id:'company-overview',label:'Overview',flag:'companyOverview'}),
    Object.freeze({id:'company-today',label:'Today',flag:'companyToday'}),
    Object.freeze({id:'company-discover',label:'Discovery',flag:'companyDiscovery'}),
    Object.freeze({id:'company-pipeline',label:'Pipeline',flag:'companyPipeline'}),
    Object.freeze({id:'company-vacancies',label:'Vacancies',flag:'companyVacancies'}),
    Object.freeze({id:'company-campaigns',label:'Campaigns',flag:'companyCampaigns'}),
    Object.freeze({id:'company-followups',label:'Follow-ups',flag:'companyFollowups'}),
    Object.freeze({id:'company-timeline',label:'Timeline',flag:'companyTimeline'}),
    Object.freeze({id:'company-stage-aging',label:'Stage Aging',flag:'companyStageAging'}),
    Object.freeze({id:'company-contact-outcomes',label:'Contact Outcomes',flag:'companyContactOutcomes'}),
    Object.freeze({id:'company-recruitment-sessions',label:'Recruitment Sessions',flag:'companySessions'}),
    Object.freeze({id:'company-talent-pool',label:'Talent Pool',flag:'companyTalentPool'}),
    Object.freeze({id:'company-reactivation',label:'Reactivation',flag:'companyReactivation'}),
    Object.freeze({id:'company-opportunity',label:'Opportunity Queue',flag:'companyOpportunity'}),
    Object.freeze({id:'company-compare',label:'Compare',flag:'companyCompare'})
  ]);

  const FACTION_PAGES = Object.freeze([
    Object.freeze({id:'faction-candidates',label:'Search & Results',core:true}),
    Object.freeze({id:'faction-overview',label:'Overview',flag:'factionOverview'}),
    Object.freeze({id:'faction-today',label:'Today',flag:'factionToday'}),
    Object.freeze({id:'faction-discover',label:'Discovery',flag:'factionDiscovery'}),
    Object.freeze({id:'faction-pipeline',label:'Pipeline',flag:'factionPipeline'}),
    Object.freeze({id:'faction-requirements',label:'Requirements',flag:'factionRequirements'}),
    Object.freeze({id:'faction-campaigns',label:'Campaigns',flag:'factionCampaigns'}),
    Object.freeze({id:'faction-followups',label:'Follow-ups',flag:'factionFollowups'}),
    Object.freeze({id:'faction-timeline',label:'Timeline',flag:'factionTimeline'}),
    Object.freeze({id:'faction-stage-aging',label:'Stage Aging',flag:'factionStageAging'}),
    Object.freeze({id:'faction-contact-outcomes',label:'Contact Outcomes',flag:'factionContactOutcomes'}),
    Object.freeze({id:'faction-recruitment-sessions',label:'Recruitment Sessions',flag:'factionSessions'}),
    Object.freeze({id:'faction-reactivation',label:'Reactivation',flag:'factionReactivation'}),
    Object.freeze({id:'faction-opportunity',label:'Opportunity Queue',flag:'factionOpportunity'}),
    Object.freeze({id:'faction-compare',label:'Compare',flag:'factionCompare'})
  ]);

  const GROUPS = Object.freeze([
    Object.freeze({id:'company-recruitment',label:'COMPANY',pages:COMPANY_PAGES}),
    Object.freeze({id:'faction-recruitment',label:'FACTION',pages:FACTION_PAGES}),
    Object.freeze({id:'intelligence',label:'OPTIONAL TOOLS',pages:Object.freeze([
      Object.freeze({id:'scout',label:'Scout',flag:'scout'}),
      Object.freeze({id:'smart-match',label:'Smart Match',flag:'smartMatch'}),
      Object.freeze({id:'global-intelligence',label:'Global Intelligence',flag:'globalIntelligence'})
    ])}),
    Object.freeze({id:'application',label:'ADVANCED',pages:Object.freeze([
      Object.freeze({id:'data',label:'Data',flag:'data'}),
      Object.freeze({id:'logs',label:'Logs',flag:'logs',advancedOnly:true})
    ])})
  ]);

  const LEGACY_ROUTE_ALIASES = Object.freeze({
    overview:'company-overview',
    discover:'company-discover',
    candidates:'company-candidates',
    pipeline:'company-pipeline'
  });
  const GROUP_IDS = Object.freeze(GROUPS.map(group => group.id));
  const ROUTES = Object.freeze([...GROUPS.flatMap(group => group.pages.map(page => page.id)),'settings']);

  function complexityValue(value) {
    return String(value || '').trim().toLowerCase() === 'advanced' ? 'advanced' : 'simple';
  }

  function normalizeRoute(value, complexity = 'simple') {
    const raw = String(value || '').trim().toLowerCase();
    const requested = LEGACY_ROUTE_ALIASES[raw] || raw;
    if (!ROUTES.includes(requested)) return 'company-candidates';
    if (requested === 'logs' && complexityValue(complexity) !== 'advanced') return 'company-candidates';
    return requested;
  }

  function moduleEnabled(settings, page) {
    if (page.core) return true;
    if (page.advancedOnly && complexityValue(settings?.complexity) !== 'advanced') return false;
    return settings?.optionalModules?.[page.flag] === true;
  }

  function visibleGroups(settings = {}) {
    return GROUPS.map(group => ({
      id:group.id,
      label:group.label,
      pages:group.pages.filter(page => moduleEnabled(settings, page)).map(page => ({id:page.id,label:page.label}))
    })).filter(group => group.pages.length > 0);
  }

  function normalizeExpandedGroups(value) {
    if (value === undefined) return ['company-recruitment'];
    if (!Array.isArray(value)) return ['company-recruitment'];
    const requested = new Set(value.map(item => String(item || '').trim().toLowerCase()).map(id => id === 'recruitment' ? 'company-recruitment' : id));
    return GROUP_IDS.filter(id => requested.has(id));
  }

  function toggleExpandedGroup(current, groupId) {
    let id = String(groupId || '').trim().toLowerCase();
    if (id === 'recruitment') id = 'company-recruitment';
    const normalized = normalizeExpandedGroups(Array.isArray(current) ? current : undefined);
    if (!GROUP_IDS.includes(id)) return normalized;
    const open = new Set(normalized);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    return GROUP_IDS.filter(group => open.has(group));
  }

  return Object.freeze({COMPANY_PAGES,FACTION_PAGES,GROUPS,GROUP_IDS,ROUTES,LEGACY_ROUTE_ALIASES,normalizeRoute,visibleGroups,normalizeExpandedGroups,toggleExpandedGroup});
});

/* bundled runtime: v46-company-core.js */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VACANCY_STATES=Object.freeze(['Draft','Open','Paused','Filled','Archived']);
  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);
  const DAY_MS=86400000;

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,number(value)));}
  function unique(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}

  function normalizeKind(value){return text(value).toLowerCase()==='hard'?'Hard':'Preferred';}
  function normalizeRequirement(raw={},index=0){
    const field=text(raw.field);
    return {
      id:text(raw.id)||`${field||'criterion'}-${index+1}`,
      field,
      operator:text(raw.operator||'gte').toLowerCase(),
      value:raw.value,
      value2:raw.value2,
      kind:normalizeKind(raw.kind),
      label:text(raw.label)||field||`Criterion ${index+1}`,
      weight:Math.max(0,number(raw.weight,1))
    };
  }

  function normalizeBaseline(config={}){
    return {criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),updatedAt:number(config.updatedAt,0)};
  }

  function normalizeVacancy(raw={}){
    const statusRaw=text(raw.status).toLowerCase();
    const status=VACANCY_STATES.find(v=>v.toLowerCase()===statusRaw)||'Draft';
    return {
      vacancyId:text(raw.vacancyId??raw.id),
      name:text(raw.name),
      role:text(raw.role),
      openings:Math.max(1,Math.floor(number(raw.openings,1))),
      status,
      criteria:(Array.isArray(raw.criteria)?raw.criteria:[]).map(normalizeRequirement),
      weights:{...(raw.weights||{})},
      salaryBudget:raw.salaryBudget??null,
      expectedSalary:raw.expectedSalary??null,
      availability:text(raw.availability)||'Unknown',
      notes:text(raw.notes),
      version:Math.max(1,Math.floor(number(raw.version,1))),
      createdAt:number(raw.createdAt,0),
      updatedAt:number(raw.updatedAt,0)
    };
  }

  function compare(operator,actual,value,value2){
    if(actual===undefined||actual===null||actual==='')return {known:false,passed:false};
    const op=text(operator).toLowerCase();
    if(op==='gte'||op==='gt'||op==='lte'||op==='lt'){
      const a=Number(actual),b=Number(value);
      if(!Number.isFinite(a)||!Number.isFinite(b))return {known:false,passed:false};
      if(op==='gte')return {known:true,passed:a>=b};
      if(op==='gt')return {known:true,passed:a>b};
      if(op==='lte')return {known:true,passed:a<=b};
      return {known:true,passed:a<b};
    }
    if(op==='between'){
      const a=Number(actual),lo=Number(value),hi=Number(value2);
      if(![a,lo,hi].every(Number.isFinite))return {known:false,passed:false};
      return {known:true,passed:a>=Math.min(lo,hi)&&a<=Math.max(lo,hi)};
    }
    if(op==='contains')return {known:true,passed:text(actual).toLowerCase().includes(text(value).toLowerCase())};
    if(op==='oneof'){
      const allowed=(Array.isArray(value)?value:[value]).map(v=>text(v).toLowerCase());
      return {known:true,passed:allowed.includes(text(actual).toLowerCase())};
    }
    return {known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
  }

  function waiverFor(requirementId,waivers=[]){
    return (Array.isArray(waivers)?waivers:[]).find(w=>text(w.requirementId)===text(requirementId)&&['active','review due'].includes(text(w.state).toLowerCase()))||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[]){
    const normalized=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement);
    const results=normalized.map(req=>{
      const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);
      const waiver=req.kind==='Hard'&&!verdict.passed?waiverFor(req.id,waivers):null;
      return {...req,known:verdict.known,passed:verdict.passed,waived:Boolean(waiver),waiver,effectivePass:verdict.passed||Boolean(waiver)};
    });
    const hardFailures=results.filter(r=>r.kind==='Hard'&&!r.passed);
    const unwaivedHardFailures=hardFailures.filter(r=>!r.waived);
    const failures=results.filter(r=>!r.passed);
    const known=results.filter(r=>r.known);
    const totalWeight=known.reduce((sum,r)=>sum+(r.weight||1),0);
    const earned=known.filter(r=>r.passed).reduce((sum,r)=>sum+(r.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):0;
    const hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':'Eligible';
    return {results,failures,hardFailures,unwaivedHardFailures,hardFailed,eligibility,score};
  }

  function ratioScore(req,facts){
    const actual=Number(facts?.[req.field]);
    const target=Number(req.value);
    if(!Number.isFinite(actual)||!Number.isFinite(target))return null;
    if(['gte','gt'].includes(req.operator))return target<=0?100:clamp(actual/target*100);
    if(['lte','lt'].includes(req.operator))return actual<=target?100:(actual<=0?0:clamp(target/actual*100));
    return compare(req.operator,facts?.[req.field],req.value,req.value2).passed?100:0;
  }

  function evaluateVacancy(rawVacancy,facts={},waivers=[]){
    const vacancy=normalizeVacancy(rawVacancy);
    const criteria=evaluateCriteria(vacancy.criteria,facts,waivers);
    const measured=vacancy.criteria.map(req=>({req,score:ratioScore(req,facts)})).filter(v=>v.score!==null);
    const totalWeight=measured.reduce((sum,v)=>sum+(v.req.weight||1),0);
    const raw=totalWeight?measured.reduce((sum,v)=>sum+v.score*(v.req.weight||1),0)/totalWeight:0;
    const matchScore=Math.round(clamp(raw));
    return {
      vacancyId:vacancy.vacancyId,
      matchScore,
      eligible:!criteria.hardFailed,
      hardFailed:criteria.hardFailed,
      eligibility:criteria.hardFailed?'NOT ELIGIBLE':criteria.hardFailures.length?'Eligible by Waiver':'Eligible',
      criteria
    };
  }

  function suggestVacancy(vacancies=[],evaluations=[],pinnedVacancyId=''){
    const activeIds=new Set((Array.isArray(vacancies)?vacancies:[]).map(normalizeVacancy).filter(v=>v.status==='Open').map(v=>v.vacancyId));
    const eligible=(Array.isArray(evaluations)?evaluations:[]).filter(e=>e&&e.eligible===true&&activeIds.has(text(e.vacancyId))).sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.vacancyId).localeCompare(text(b.vacancyId)));
    const suggestedVacancyId=text(eligible[0]?.vacancyId);
    const pinned=text(pinnedVacancyId);
    return {suggestedVacancyId,pinnedVacancyId:pinned,bestChanged:Boolean(pinned&&suggestedVacancyId&&pinned!==suggestedVacancyId)};
  }

  function opportunityComponent(label,value,weight){
    const normalized=clamp(value);
    const w=Math.max(0,number(weight));
    return {label,value:normalized,weight:w,contribution:Math.round(normalized*w)/100};
  }

  function computeOpportunity(input={},weights={}){
    const availability=text(input.availability).toLowerCase()==='available'?100:text(input.availability).toLowerCase()==='unavailable'?0:50;
    const age=Math.max(0,number(input.lastActiveAgeHours,999));
    const activity=age<=6?100:age<=24?80:age<=72?55:age<=168?30:10;
    const freshMap={fresh:100,aging:70,stale:40,'very stale':15};
    const freshness=freshMap[text(input.intelligenceFreshness).toLowerCase()]??50;
    const rows=[
      opportunityComponent('Match',input.match,weights.match),
      opportunityComponent('Fit',input.fit,weights.fit),
      opportunityComponent('Availability',availability,weights.availability),
      opportunityComponent('Activity',activity,weights.activity),
      opportunityComponent('Freshness',freshness,weights.freshness),
      opportunityComponent('Follow-up',input.followUpDue?100:0,weights.followUp),
      {label:'Contact penalty',value:clamp(input.contactPenalty),weight:Math.max(0,number(weights.contactPenalty)),contribution:0}
    ];
    const rawScore=Math.round(rows.reduce((sum,row)=>sum+row.contribution,0)*100)/100;
    const penalty=Math.round(clamp(input.contactPenalty)*Math.max(0,number(weights.contactPenalty)))/100;
    const score=Math.round(clamp(rawScore-penalty));
    const explanation=rows.slice(0,6).map(row=>`${row.label}: ${row.value} × ${row.weight}% = ${row.contribution}`).join('; ')+(penalty?`; Contact penalty: -${penalty}`:'');
    return {score,rawScore,penalty,breakdown:rows,explanation};
  }

  function stageAgeStatus(record={},thresholds={},now=Date.now()){
    const changed=number(record.stageChangedAt??record.updatedAt,now);
    const daysInStage=Math.max(0,Math.floor((number(now)-changed)/DAY_MS));
    const threshold=Math.max(0,number(thresholds?.[record.pipelineStage],0));
    return {pipelineStage:text(record.pipelineStage),daysInStage,thresholdDays:threshold,stale:threshold>0&&daysInStage>=threshold};
  }

  function followUpTimestamp(followUp){
    if(Number.isFinite(Number(followUp?.dueAt)))return Number(followUp.dueAt);
    const raw=text(followUp?.date)+(text(followUp?.time)?`T${text(followUp.time)}`:'T23:59:59');
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed)?parsed:Infinity;
  }

  function buildTodayQueue(records=[],context={}){
    const now=number(context.now,Date.now());
    const opportunities=context.opportunities||{};
    const out=[];
    for(const record of Array.isArray(records)?records:[]){
      if(record?.archived===true)continue;
      const reasons=[];
      let priority=0;
      if(text(record.pipelineStage)==='Replied'){reasons.push('Reply waiting');priority=Math.max(priority,100);}
      const overdue=(Array.isArray(record.followUps)?record.followUps:[]).filter(f=>!['completed','cancelled'].includes(text(f.state).toLowerCase())&&followUpTimestamp(f)<now);
      if(overdue.length){reasons.push(`Overdue follow-up (${overdue.length})`);priority=Math.max(priority,85);}
      const aging=stageAgeStatus(record,context.stageThresholds||{},now);
      if(aging.stale){reasons.push('Stale stage');priority=Math.max(priority,75);}
      if(number(record.newlyEligibleAt,0)>0&&now-number(record.newlyEligibleAt)<=DAY_MS){reasons.push('Newly eligible');priority=Math.max(priority,70);}
      if(number(record.newlyDiscoveredAt,0)>0&&now-number(record.newlyDiscoveredAt)<=DAY_MS){reasons.push('Newly discovered');priority=Math.max(priority,60);}
      if(number(opportunities?.[record.userId],0)>=80){reasons.push('High opportunity');priority=Math.max(priority,55);}
      if(reasons.length)out.push({userId:text(record.userId),pipelineStage:text(record.pipelineStage),priority,reasons});
    }
    return out.sort((a,b)=>b.priority-a.priority||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  return Object.freeze({
    VACANCY_STATES,REQUIREMENT_KINDS,
    normalizeBaseline,normalizeVacancy,evaluateCriteria,evaluateVacancy,suggestVacancy,
    computeOpportunity,stageAgeStatus,buildTodayQueue
  });
});

/* bundled runtime: v46-company-storage.js */
(function(root,factory){
  let CompanyCore=root&&root.RA_V46CompanyCore;
  if(!CompanyCore&&typeof module==='object'&&module.exports)CompanyCore=require('./v46-company-core');
  const api=factory(CompanyCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(CompanyCore){
  'use strict';
  if(!CompanyCore)throw new Error('RA_V46CompanyCore is required.');

  const DB_VERSION=14;
  const STORE_DEFINITIONS=Object.freeze({
    companyVacancies:Object.freeze({keyPath:'vacancyId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    companyCampaigns:Object.freeze({keyPath:'campaignId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'vacancyId',keyPath:'vacancyId'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    companyRecruitmentConfig:Object.freeze({keyPath:'key',indexes:Object.freeze([])}),
    companyRecruitmentSessions:Object.freeze({keyPath:'sessionId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])})
  });

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function uniqueIds(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(v=>/^\d+$/.test(v)&&Number(v)>0))];}
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }

  function applyUpgrade(db){
    for(const[storeName,definition]of Object.entries(STORE_DEFINITIONS)){
      if(db.objectStoreNames.contains(storeName))continue;
      const store=db.createObjectStore(storeName,{keyPath:definition.keyPath});
      for(const index of definition.indexes)store.createIndex(index.name,index.keyPath,{unique:false});
    }
  }

  function normalizeConfig(raw={}){
    const thresholds={};
    for(const[key,value]of Object.entries(raw.stageThresholds||{})){
      const days=Math.max(0,Math.floor(number(value,0)));
      if(days>0)thresholds[text(key)]=days;
    }
    const weights={};
    for(const[key,value]of Object.entries(raw.opportunityWeights||{}))weights[text(key)]=Math.max(0,number(value,0));
    return {
      key:'company',
      baseline:CompanyCore.normalizeBaseline(raw.baseline||{}),
      stageThresholds:thresholds,
      opportunityWeights:weights,
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function normalizeCampaign(raw={}){
    const createdAt=number(raw.createdAt,Date.now());
    return {
      campaignId:text(raw.campaignId||raw.id)||makeId('campaign'),
      title:text(raw.title)||'Untitled Campaign',
      target:text(raw.target),
      startAt:raw.startAt??null,
      endAt:raw.endAt??null,
      vacancyId:text(raw.vacancyId),
      candidateIds:uniqueIds(raw.candidateIds),
      status:text(raw.status)||'Draft',
      metrics:{...(raw.metrics||{})},
      notes:text(raw.notes),
      createdAt,
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function normalizeSession(raw={}){
    const ids=uniqueIds(raw.candidateIds);
    return {
      sessionId:text(raw.sessionId||raw.id)||makeId('session'),
      title:text(raw.title)||'Recruitment Session',
      candidateIds:ids,
      cursor:Math.max(0,Math.min(ids.length,Math.floor(number(raw.cursor,0)))),
      status:text(raw.status)||'Draft',
      outcomes:Array.isArray(raw.outcomes)?raw.outcomes.map(item=>({...item})):[],
      filters:{...(raw.filters||{})},
      startedAt:raw.startedAt??null,
      completedAt:raw.completedAt??null,
      createdAt:number(raw.createdAt,Date.now()),
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function createRepositories(idb,core=CompanyCore){
    if(!idb||!['get','getAll','put'].every(name=>typeof idb[name]==='function'))throw new Error('A compatible IndexedDB adapter is required.');

    const vacancies={
      async save(raw){const next=core.normalizeVacancy({...raw,updatedAt:Date.now()});if(!next.vacancyId)throw new Error('Vacancy ID is required.');await idb.put('companyVacancies',next);return next;},
      async get(id){return idb.get('companyVacancies',text(id));},
      async list(){return(await idb.getAll('companyVacancies')).map(core.normalizeVacancy).sort((a,b)=>a.name.localeCompare(b.name)||a.vacancyId.localeCompare(b.vacancyId));},
      async listActive(){return(await vacancies.list()).filter(v=>v.status==='Open');},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('companyVacancies',text(id));}
    };

    const config={
      async get(){const existing=await idb.get('companyRecruitmentConfig','company');return normalizeConfig(existing||{});},
      async save(raw){const existing=await config.get();const next=normalizeConfig({...existing,...raw,key:'company',updatedAt:Date.now()});await idb.put('companyRecruitmentConfig',next);return next;}
    };

    const campaigns={
      async save(raw){const next=normalizeCampaign({...raw,updatedAt:Date.now()});await idb.put('companyCampaigns',next);return next;},
      async get(id){return idb.get('companyCampaigns',text(id));},
      async list(){return(await idb.getAll('companyCampaigns')).map(normalizeCampaign).sort((a,b)=>number(b.updatedAt)-number(a.updatedAt)||a.campaignId.localeCompare(b.campaignId));},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('companyCampaigns',text(id));}
    };

    const sessions={
      async save(raw){const next=normalizeSession({...raw,updatedAt:Date.now()});await idb.put('companyRecruitmentSessions',next);return next;},
      async get(id){return idb.get('companyRecruitmentSessions',text(id));},
      async list(){return(await idb.getAll('companyRecruitmentSessions')).map(normalizeSession).sort((a,b)=>number(b.updatedAt)-number(a.updatedAt)||a.sessionId.localeCompare(b.sessionId));},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('companyRecruitmentSessions',text(id));}
    };

    return Object.freeze({vacancies:Object.freeze(vacancies),config:Object.freeze(config),campaigns:Object.freeze(campaigns),sessions:Object.freeze(sessions)});
  }

  return Object.freeze({DB_VERSION,STORE_DEFINITIONS,applyUpgrade,normalizeConfig,normalizeCampaign,normalizeSession,createRepositories});
});

/* bundled runtime: v46-company-ui.js */
(function(root,factory){
  const deps={CompanyCore:root&&root.RA_V46CompanyCore};
  if(typeof module==='object'&&module.exports)deps.CompanyCore=require('./v46-company-core');
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore}=D;
  if(!CompanyCore)throw new Error('CompanyCore is required.');
  const COMPANY_STAGES=Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const TERMINAL_STAGES=new Set(['Hired','Rejected']);
  const VACANCY_STATES=Object.freeze(['Draft','Open','Paused','Filled','Archived']);
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function normalizeStage(value){const raw=text(value).toLowerCase();return COMPANY_STAGES.find(stage=>stage.toLowerCase()===raw)||'Not Contacted';}
  function dateText(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toLocaleString():'—';}

  function buildCandidateRows(companyRecords=[],playerRecords=[],options={}){
    const players=new Map((Array.isArray(playerRecords)?playerRecords:[]).map(player=>[text(player?.userId),player]));
    const eligibilityFor=typeof options.eligibilityFor==='function'?options.eligibilityFor:()=>null;
    const rows=[];
    for(const record of Array.isArray(companyRecords)?companyRecords:[]){
      if(!record||text(record.domain).toLowerCase()==='faction')continue;
      const userId=text(record.userId);if(!userId)continue;
      const player=players.get(userId)||{userId};
      const evaluation=eligibilityFor(record,player)||{};
      rows.push({
        userId,name:text(player.name)||`User ${userId}`,level:player.level??null,ee:player.ee??null,fit:player.fit??null,fitType:text(player.fitType),
        lastActive:player.lastActive??null,onlineStatus:text(player.onlineStatus),activity30:player.activity30??null,xanax30:player.xanax30??null,refills30:player.refills30??null,
        attacks30:player.attacks30??null,rwHits30:player.rwHits30??null,networth:player.networth??null,currentCompany:text(player.currentCompany),
        pipelineStage:normalizeStage(record.pipelineStage),availability:text(record.availability)||'Unknown',desiredCompany:text(record.desiredCompany),desiredRole:text(record.desiredRole),
        expectedSalary:record.expectedSalary??null,recruiterNote:text(record.recruiterNote),followUps:Array.isArray(record.followUps)?record.followUps.map(item=>({...item})):[],
        campaigns:Array.isArray(record.campaigns)?[...record.campaigns]:[],outcomes:Array.isArray(record.outcomes)?record.outcomes.map(item=>({...item})):[],tags:Array.isArray(record.tags)?[...record.tags]:[],
        doNotContact:record.doNotContact===true,archived:record.archived===true,createdAt:record.createdAt??null,updatedAt:record.updatedAt??null,
        stageChangedAt:record.stageChangedAt??record.updatedAt??null,newlyDiscoveredAt:record.newlyDiscoveredAt??null,newlyEligibleAt:record.newlyEligibleAt??null,
        eligibility:text(evaluation.eligibility)||'Unknown',eligibilityScore:Number.isFinite(Number(evaluation.score))?Number(evaluation.score):null,hardFailed:evaluation.hardFailed===true,
        companyRecord:record,playerRecord:player
      });
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function buildOverviewModel(rows=[],vacancies=[]){
    const stageCounts=Object.fromEntries(COMPANY_STAGES.map(stage=>[stage,0]));let activeCandidates=0,eligible=0,notCurrentlyEligible=0;
    for(const row of Array.isArray(rows)?rows:[]){const stage=normalizeStage(row.pipelineStage);stageCounts[stage]++;if(!row.archived&&!TERMINAL_STAGES.has(stage))activeCandidates++;if(['Eligible','Eligible by Waiver'].includes(text(row.eligibility)))eligible++;if(text(row.eligibility)==='NOT CURRENTLY ELIGIBLE')notCurrentlyEligible++;}
    const open=(Array.isArray(vacancies)?vacancies:[]).filter(v=>text(v?.status)==='Open');return {totalCandidates:(Array.isArray(rows)?rows:[]).length,activeCandidates,stageCounts,eligible,notCurrentlyEligible,openVacancies:open.length,openings:open.reduce((sum,v)=>sum+Math.max(0,number(v?.openings,0)),0)};
  }
  function buildTodayModel(rows=[],context={}){const queue=CompanyCore.buildTodayQueue(rows,context);const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));return queue.map(item=>{const row=byId.get(text(item.userId))||{};return{...item,name:text(row.name)||`User ${item.userId}`,availability:text(row.availability)||'Unknown',eligibility:text(row.eligibility)||'Unknown',fit:row.fit??null,desiredRole:text(row.desiredRole)};});}
  function buildPipelineModel(rows=[]){const buckets=Object.fromEntries(COMPANY_STAGES.map(stage=>[stage,[]]));for(const row of Array.isArray(rows)?rows:[]){if(!row||text(row.companyRecord?.domain).toLowerCase()==='faction')continue;buckets[normalizeStage(row.pipelineStage)].push(row);}return buckets;}

  function kpi(label,value){return `<div class="ra-kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;}
  function score(value){return Number.isFinite(Number(value))?Number(value).toFixed(1):'—';}
  function money(value){return Number.isFinite(Number(value))?`$${Math.round(Number(value)).toLocaleString()}`:'—';}
  function stageOptions(selected){return COMPANY_STAGES.map(stage=>`<option value="${esc(stage)}" ${stage===selected?'selected':''}>${esc(stage)}</option>`).join('');}
  function vacancyStateOptions(selected){return VACANCY_STATES.map(state=>`<option value="${state}" ${state===selected?'selected':''}>${state}</option>`).join('');}
  function playerOptions(rows=[],selected=''){return rows.map(row=>`<option value="${esc(row.userId)}" ${text(row.userId)===text(selected)?'selected':''}>${esc(row.name)} [${esc(row.userId)}]</option>`).join('');}

  function renderOverview(model={}){const counts=model.stageCounts||{};return `<div class="ra-kpis">${kpi('Active Candidates',number(model.activeCandidates))}${kpi('Eligible',number(model.eligible))}${kpi('Open Vacancies',number(model.openVacancies))}${kpi('Openings',number(model.openings))}</div><section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Recruitment</h3><p>Company-only workflow state over shared Player Intelligence.</p></div></div><div class="ra-detail-grid"><span>Not Currently Eligible<b>${number(model.notCurrentlyEligible)}</b></span><span>Replied<b>${number(counts.Replied)}</b></span><span>Shortlisted<b>${number(counts.Shortlisted)}</b></span><span>Hired<b>${number(counts.Hired)}</b></span></div><div class="ra-actions" style="margin-top:10px"><button class="ra-btn ra-primary" data-go-page="company-today">Open Today</button><button class="ra-btn" data-go-page="company-vacancies">Manage Vacancies</button><button class="ra-btn" data-go-page="company-candidates">Company Candidates</button></div></section>`;}
  function renderToday(items=[]){const rows=(Array.isArray(items)?items:[]).map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.pipelineStage)}</td><td>${esc((item.reasons||[]).join(' · '))}</td><td>${esc(item.eligibility)}</td><td>${score(item.fit)}</td></tr>`).join('');return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Today</h3><p>Priority work only. Viewing this queue never changes pipeline state.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Why now</th><th>Eligibility</th><th>Fit</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Nothing requires attention.</td></tr>'}</tbody></table></div></section>`;}

  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus);if(status.toLowerCase()==='online')return '<span class="ra-online-live">Online</span>';if(status.toLowerCase()==='idle')return '<span class="ra-online-idle">Idle</span>';if(status.toLowerCase()==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function sortHeader(key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-company-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  function renderCandidates(rows=[],options={}){
    const filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'};const total=Number.isFinite(Number(options.total))?Number(options.total):(Array.isArray(rows)?rows:[]).length;
    const body=(Array.isArray(rows)?rows:[]).map(row=>{const message=row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-company-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-company-recruit="${esc(row.userId)}">Message</button>`;return `<tr data-context-id="${esc(row.userId)}"><td><a class="ra-link" href="https://www.torn.com/profiles.php?XID=${esc(row.userId)}" target="_blank" rel="noopener">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small></td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${lastOnlineHtml(row)}</td><td>${esc(row.currentOrganizationLabel||'Unknown')}</td><td>${message}</td></tr>`;}).join('');
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Search configured recruitment forums and Torn users, then filter the combined candidate intelligence.</p></div></div><div class="ra-formgrid ra-core-search-grid"><div class="ra-field"><label>Name / ID</label><input id="ra-company-filter-search" value="${esc(filters.search||'')}" placeholder="Player name or ID"></div><div class="ra-field"><label>Status</label><select id="ra-company-filter-status"><option value="">Any</option><option value="Online" ${text(filters.onlineStatus).toLowerCase()==='online'?'selected':''}>Online</option><option value="Idle" ${text(filters.onlineStatus).toLowerCase()==='idle'?'selected':''}>Idle</option><option value="Offline" ${text(filters.onlineStatus).toLowerCase()==='offline'?'selected':''}>Offline</option></select></div><div class="ra-field"><label>Current Company</label><input id="ra-company-filter-organization" value="${esc(filters.organization||'')}" placeholder="Company name"></div><div class="ra-field"><label>Company Presence</label><select id="ra-company-filter-organization-presence"><option value="any" ${!filters.organizationPresence||filters.organizationPresence==='any'?'selected':''}>Any</option><option value="none" ${filters.organizationPresence==='none'?'selected':''}>None</option><option value="has" ${filters.organizationPresence==='has'?'selected':''}>Has Company</option></select></div><div class="ra-field"><label>END ≥</label><input id="ra-company-filter-end" value="${esc(filters.minEnd||'')}" placeholder="e.g. 100k"></div><div class="ra-field"><label>MAN ≥</label><input id="ra-company-filter-man" value="${esc(filters.minMan||'')}" placeholder="e.g. 50k"></div><div class="ra-field"><label>INT ≥</label><input id="ra-company-filter-int" value="${esc(filters.minInt||'')}" placeholder="e.g. 50k"></div></div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-company-search-apply">Search</button><button type="button" class="ra-btn" id="ra-company-search-clear">Clear</button></div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${(Array.isArray(rows)?rows:[]).length} matching of ${total} Company candidate(s).</p></div></div><div class="ra-table-wrap"><table class="ra-table ra-core-results"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>Current Company</th><th>Message</th></tr></thead><tbody>${body||'<tr><td colspan="7">No matching Company candidates.</td></tr>'}</tbody></table></div></section>`;
  }
  function renderPipeline(model={}){return `<div class="ra-pipeline">${COMPANY_STAGES.map(stage=>`<section class="ra-stage" data-company-stage="${esc(stage)}"><div class="ra-stage-head"><b>${esc(stage)}</b><span>${(model[stage]||[]).length}</span></div><div class="ra-stage-drop">${(model[stage]||[]).map(row=>`<article class="ra-stage-card" data-context-id="${esc(row.userId)}"><b>${esc(row.name)}</b><div>${esc(row.eligibility)} · Fit ${score(row.fit)}</div><div>${esc(row.desiredRole||'No role specified')}</div><select class="ra-btn" data-company-stage-select="${esc(row.userId)}">${stageOptions(row.pipelineStage)}</select></article>`).join('')}</div></section>`).join('')}</div>`;}

  function renderCriterionRow(raw={},scope='baseline'){
    const req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||'ee',operator:text(raw.operator)||'gte',kind:text(raw.kind)||'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    return `<div class="ra-formgrid" data-criterion-row data-criterion-id="${esc(req.id)}" style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input data-criterion-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select data-criterion-field="field">${CRITERION_FIELDS.map(field=>`<option value="${field}" ${field===req.field?'selected':''}>${field}</option>`).join('')}</select></div><div class="ra-field"><label>Operator</label><select data-criterion-field="operator">${CRITERION_OPERATORS.map(op=>`<option value="${op}" ${op===req.operator?'selected':''}>${op}</option>`).join('')}</select></div><div class="ra-field"><label>Type</label><select data-criterion-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind!=='Hard'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input data-criterion-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input data-criterion-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-remove-criterion="${esc(scope)}">×</button></div>`;
  }
  function renderVacanciesPage({config={},vacancies=[],rows=[]}={}){
    const baseline=config.baseline?.criteria||[];
    const vacancyCards=(Array.isArray(vacancies)?vacancies:[]).map(v=>`<section class="ra-panel" data-vacancy-card="${esc(v.vacancyId)}"><div class="ra-panel-head"><div><h3>${esc(v.name||'Untitled Vacancy')}</h3><p>${esc(v.vacancyId)} · ${number(v.openings,1)} opening${number(v.openings,1)===1?'':'s'}</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input data-vacancy-field="name" value="${esc(v.name)}"></div><div class="ra-field"><label>Role</label><input data-vacancy-field="role" value="${esc(v.role)}"></div><div class="ra-field"><label>Openings</label><input data-vacancy-field="openings" type="number" min="1" value="${number(v.openings,1)}"></div><div class="ra-field"><label>Status</label><select data-vacancy-field="status">${vacancyStateOptions(v.status)}</select></div><div class="ra-field"><label>Salary budget</label><input data-vacancy-field="salaryBudget" type="number" value="${esc(v.salaryBudget??'')}"></div><div class="ra-field"><label>Availability</label><select data-vacancy-field="availability"><option ${v.availability==='Unknown'?'selected':''}>Unknown</option><option ${v.availability==='Available'?'selected':''}>Available</option><option ${v.availability==='Unavailable'?'selected':''}>Unavailable</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-vacancy-field="notes">${esc(v.notes)}</textarea></div></div><h4>Vacancy criteria</h4><div data-criteria-host>${(v.criteria||[]).map(req=>renderCriterionRow(req,`vacancy:${v.vacancyId}`)).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" data-vacancy-add-criterion="${esc(v.vacancyId)}">Add criterion</button><button type="button" class="ra-btn ra-primary" data-vacancy-save="${esc(v.vacancyId)}">Save Vacancy</button><button type="button" class="ra-btn ra-danger" data-vacancy-delete="${esc(v.vacancyId)}">Delete</button></div></section>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Baseline</h3><p>Hard requirements block Hired unless explicitly waived. Preferred requirements influence quality only.</p></div></div><div id="ra-company-baseline-criteria" data-criteria-host>${baseline.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-baseline-add">Add criterion</button><button type="button" class="ra-btn ra-primary" id="ra-company-baseline-save">Save Baseline</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>New Vacancy</h3><p>One vacancy can represent multiple openings.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input id="ra-company-new-vacancy-name"></div><div class="ra-field"><label>Role</label><input id="ra-company-new-vacancy-role"></div><div class="ra-field"><label>Openings</label><input id="ra-company-new-vacancy-openings" type="number" min="1" value="1"></div><div class="ra-field"><label>Status</label><select id="ra-company-new-vacancy-status">${vacancyStateOptions('Draft')}</select></div></div><div class="ra-actions" style="margin-top:8px"><button type="button" class="ra-btn ra-primary" id="ra-company-vacancy-new">Create Vacancy</button></div></section><div class="ra-note" style="margin-bottom:8px">${rows.length} Company candidate(s) are evaluated locally against every Open vacancy. No Torn API calls are made by vacancy edits or rescoring.</div>${vacancyCards||'<section class="ra-panel"><div class="ra-muted">No vacancies yet.</div></section>'}`;
  }

  function renderFollowUpsPage(rows=[],options={}){
    const now=number(options.now,Date.now());const items=[];for(const row of rows)for(const follow of row.companyRecord?.followUps||[])items.push({row,follow});items.sort((a,b)=>number(a.follow.dueAt,Infinity)-number(b.follow.dueAt,Infinity));
    const body=items.map(({row,follow})=>{const open=!['completed','cancelled'].includes(text(follow.state).toLowerCase());const overdue=open&&number(follow.dueAt,Infinity)<now;return `<tr><td>${esc(row.name)}</td><td>${dateText(follow.dueAt)}</td><td>${esc(follow.reason||'—')}</td><td>${esc(follow.note||'—')}</td><td>${overdue?'Overdue':esc(follow.state||'open')}</td><td>${open?`<button type="button" class="ra-btn" data-followup-complete="${esc(follow.followUpId)}" data-followup-user="${esc(row.userId)}">Complete</button>`:'—'}</td></tr>`;}).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Add Follow-up</h3><p>Due work stays local and never changes stage automatically.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-company-followup-player">${playerOptions(rows)}</select></div><div class="ra-field"><label>Due</label><input id="ra-company-followup-due" type="datetime-local"></div><div class="ra-field"><label>Reason</label><input id="ra-company-followup-reason"></div><div class="ra-field"><label>Note</label><input id="ra-company-followup-note"></div><div class="ra-field"><label>Repeat</label><select id="ra-company-followup-recurrence-unit"><option value="">None</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><div class="ra-field"><label>Every</label><input id="ra-company-followup-recurrence-interval" type="number" min="1" value="1"></div></div><div class="ra-actions" style="margin-top:8px"><button type="button" class="ra-btn ra-primary" id="ra-company-followup-add">Add Follow-up</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Follow-ups</h3><p>Overdue and upcoming follow-ups across Company recruitment.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Due</th><th>Reason</th><th>Note</th><th>Status</th><th>Action</th></tr></thead><tbody>${body||'<tr><td colspan="6">No follow-ups.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderContactOutcomesPage(rows=[]){
    const outcomes=[];for(const row of rows)for(const outcome of row.companyRecord?.outcomes||[])outcomes.push({row,outcome});outcomes.sort((a,b)=>number(b.outcome.at,0)-number(a.outcome.at,0));
    const outcomeRows=outcomes.map(({row,outcome})=>`<tr><td>${esc(row.name)}</td><td>${esc(row.pipelineStage)}</td><td>${esc(outcome.result)}</td><td>${esc(outcome.channel)}</td><td>${esc(outcome.note||'—')}</td><td>${dateText(outcome.at)}</td></tr>`).join('');
    const dncRows=rows.map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(row.pipelineStage)}</td><td>${row.doNotContact?'Do Not Contact':'Contact allowed'}</td><td>${esc(row.companyRecord?.doNotContactReason||'—')}</td><td><input data-dnc-reason="${esc(row.userId)}" value="${esc(row.companyRecord?.doNotContactReason||'')}"></td><td><button type="button" class="ra-btn ${row.doNotContact?'':'ra-danger'}" data-company-dnc="${esc(row.userId)}" data-dnc-enable="${row.doNotContact?'false':'true'}">${row.doNotContact?'Remove DNC':'Set DNC'}</button></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Record Contact Outcome</h3><p>Outcomes do not imply or change a pipeline stage.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-company-outcome-player">${playerOptions(rows)}</select></div><div class="ra-field"><label>Result</label><select id="ra-company-outcome-result"><option>Interested</option><option>Not Interested</option><option>No Response</option><option>Needs Follow-up</option><option>Other</option></select></div><div class="ra-field"><label>Channel</label><select id="ra-company-outcome-channel"><option>Torn message</option><option>Forum</option><option>Chat</option><option>Other</option></select></div><div class="ra-field"><label>Note</label><input id="ra-company-outcome-note"></div></div><div class="ra-actions" style="margin-top:8px"><button type="button" class="ra-btn ra-primary" id="ra-company-outcome-add">Record Outcome</button></div></section><section class="ra-panel"><h3>Do Not Contact</h3><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Status</th><th>Current reason</th><th>Reason</th><th>Action</th></tr></thead><tbody>${dncRows||'<tr><td colspan="6">No candidates.</td></tr>'}</tbody></table></div></section><section class="ra-panel"><h3>Contact Outcomes</h3><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Result</th><th>Channel</th><th>Note</th><th>When</th></tr></thead><tbody>${outcomeRows||'<tr><td colspan="6">No contact outcomes.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderStageAgingPage(rows=[]){const sorted=[...rows].sort((a,b)=>Number(b.aging?.stale)-Number(a.aging?.stale)||number(b.aging?.daysInStage)-number(a.aging?.daysInStage));const body=sorted.map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(row.pipelineStage)}</td><td>${number(row.aging?.daysInStage)}</td><td>${number(row.aging?.thresholdDays)||'—'}</td><td>${row.aging?.stale?'<b>Stale</b>':'Within threshold'}</td></tr>`).join('');return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Stage Aging</h3><p>Warnings only. Aging never moves a candidate automatically.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Days in stage</th><th>Warning at</th><th>Status</th></tr></thead><tbody>${body||'<tr><td colspan="5">No candidates.</td></tr>'}</tbody></table></div></section>`;}

  function renderTimelinePage(rows=[]){
    const items=[];for(const row of rows){for(const event of row.companyRecord?.timelineEvents||[])items.push({row,kind:'system',at:number(event.at),entry:event});for(const note of row.companyRecord?.timelineNotes||[])items.push({row,kind:'note',at:number(note.at),entry:note});}items.sort((a,b)=>b.at-a.at);
    const body=items.map(item=>item.kind==='system'?`<tr><td>${esc(item.row.name)}</td><td>${dateText(item.at)}</td><td>System event <span class="ra-muted">Immutable</span></td><td>${esc(item.entry.type)}</td><td>${esc(JSON.stringify(item.entry.payload||{}))}</td><td>—</td></tr>`:`<tr><td>${esc(item.row.name)}</td><td>${dateText(item.at)}</td><td>Recruiter note</td><td>Note</td><td data-timeline-note-text="${esc(item.entry.noteId)}">${esc(item.entry.text)}</td><td><button type="button" class="ra-btn" data-timeline-note-edit="${esc(item.entry.noteId)}" data-timeline-user="${esc(item.row.userId)}">Edit</button> <button type="button" class="ra-btn ra-danger" data-timeline-note-delete="${esc(item.entry.noteId)}" data-timeline-user="${esc(item.row.userId)}">Delete</button></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Add Recruiter Timeline Note</h3><p>Recruiter notes are editable; system events are not.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-company-timeline-player">${playerOptions(rows)}</select></div><div class="ra-field"><label>Note</label><input id="ra-company-timeline-note"></div></div><div class="ra-actions" style="margin-top:8px"><button type="button" class="ra-btn ra-primary" id="ra-company-timeline-add">Add Note</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Timeline</h3><p>Newest first across Company recruitment.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>When</th><th>Kind</th><th>Type</th><th>Details</th><th>Action</th></tr></thead><tbody>${body||'<tr><td colspan="6">No timeline history.</td></tr>'}</tbody></table></div></section>`;
  }

  return Object.freeze({COMPANY_STAGES,VACANCY_STATES,buildCandidateRows,buildOverviewModel,buildTodayModel,buildPipelineModel,renderOverview,renderToday,renderCandidates,renderPipeline,renderCriterionRow,renderVacanciesPage,renderFollowUpsPage,renderContactOutcomesPage,renderStageAgingPage,renderTimelinePage});
});

/* bundled runtime: v46-company-operations.js */
(function(root,factory){
  let CompanyCore=root&&root.RA_V46CompanyCore;
  if(!CompanyCore&&typeof module==='object'&&module.exports)CompanyCore=require('./v46-company-core');
  const api=factory(CompanyCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyOperations=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(CompanyCore){
  'use strict';
  if(!CompanyCore)throw new Error('CompanyCore is required.');

  const UNIT_MS=Object.freeze({hours:3600000,days:86400000,weeks:604800000});
  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const cloneRecord=record=>({...record,followUps:(record.followUps||[]).map(x=>({...x,recurrence:x.recurrence?{...x.recurrence}:null})),outcomes:(record.outcomes||[]).map(x=>({...x})),timelineEvents:(record.timelineEvents||[]).map(x=>({...x,payload:x.payload?{...x.payload}:x.payload})),timelineNotes:(record.timelineNotes||[]).map(x=>({...x}))});
  const makeId=(prefix,at)=>`${prefix}-${number(at,Date.now())}-${Math.random().toString(36).slice(2,8)}`;

  function normalizeRecurrence(raw){
    if(!raw)return null;
    const unit=Object.hasOwn(UNIT_MS,text(raw.unit).toLowerCase())?text(raw.unit).toLowerCase():'days';
    const interval=Math.max(1,Math.floor(number(raw.interval,1)));
    return{unit,interval};
  }

  function addSystemEvent(record,type,payload={},at=Date.now(),eventId=''){
    const next=cloneRecord(record||{});const when=number(at,Date.now());
    next.timelineEvents.push({eventId:text(eventId)||makeId('event',when),type:text(type)||'event',at:when,payload:{...(payload||{})}});
    next.updatedAt=when;return next;
  }

  function addFollowUp(record,raw={},at=Date.now()){
    const next=cloneRecord(record||{});const when=number(at,Date.now());
    const followUp={followUpId:text(raw.followUpId)||makeId('followup',when),dueAt:number(raw.dueAt,when),reason:text(raw.reason),note:text(raw.note),state:text(raw.state)||'open',recurrence:normalizeRecurrence(raw.recurrence),createdAt:raw.createdAt??when,updatedAt:when};
    next.followUps.push(followUp);next.updatedAt=when;
    return addSystemEvent(next,'follow-up-added',{followUpId:followUp.followUpId,dueAt:followUp.dueAt,reason:followUp.reason},when);
  }

  function completeFollowUp(record,followUpId,at=Date.now()){
    const next=cloneRecord(record||{});const id=text(followUpId);const when=number(at,Date.now());const index=next.followUps.findIndex(x=>text(x.followUpId)===id);if(index<0)throw new Error('Follow-up not found.');
    const current={...next.followUps[index],state:'completed',completedAt:when,updatedAt:when};next.followUps[index]=current;
    if(current.recurrence){const step=UNIT_MS[current.recurrence.unit]*current.recurrence.interval;next.followUps.push({...current,followUpId:makeId('followup',when),parentFollowUpId:id,dueAt:number(current.dueAt,when)+step,state:'open',completedAt:null,createdAt:when,updatedAt:when});}
    next.updatedAt=when;return addSystemEvent(next,'follow-up-completed',{followUpId:id},when);
  }

  function recordContactOutcome(record,raw={},at=Date.now()){
    const next=cloneRecord(record||{});const when=number(at,Date.now());const outcome={outcomeId:text(raw.outcomeId)||makeId('outcome',when),result:text(raw.result)||'Other',channel:text(raw.channel)||'Other',note:text(raw.note),at:raw.at??when};next.outcomes.push(outcome);next.updatedAt=when;
    return addSystemEvent(next,'contact-outcome',{outcomeId:outcome.outcomeId,result:outcome.result,channel:outcome.channel},when);
  }

  function setDoNotContact(record,enabled,reason='',at=Date.now()){
    const next=cloneRecord(record||{});const when=number(at,Date.now());next.doNotContact=enabled===true;next.doNotContactReason=next.doNotContact?text(reason):'';next.doNotContactChangedAt=when;next.updatedAt=when;
    return addSystemEvent(next,'dnc-changed',{enabled:next.doNotContact,reason:next.doNotContactReason},when);
  }

  function canMessage(record,override=false){return !(record?.doNotContact===true&&override!==true);}
  function stageAging(record,thresholds={},now=Date.now()){return CompanyCore.stageAgeStatus(record,thresholds,now);}

  function addTimelineNote(record,raw={},at=Date.now()){
    const next=cloneRecord(record||{});const when=number(at,Date.now());next.timelineNotes.push({noteId:text(raw.noteId)||makeId('note',when),text:text(raw.text),at:raw.at??when,updatedAt:when});next.updatedAt=when;return next;
  }
  function editTimelineNote(record,noteId,value,at=Date.now()){
    const next=cloneRecord(record||{});const id=text(noteId);if(next.timelineEvents.some(event=>text(event.eventId)===id))throw new Error('System timeline events are immutable.');const index=next.timelineNotes.findIndex(note=>text(note.noteId)===id);if(index<0)throw new Error('Timeline note not found.');const when=number(at,Date.now());next.timelineNotes[index]={...next.timelineNotes[index],text:text(value),updatedAt:when};next.updatedAt=when;return next;
  }
  function deleteTimelineNote(record,noteId,at=Date.now()){
    const next=cloneRecord(record||{});const id=text(noteId);if(next.timelineEvents.some(event=>text(event.eventId)===id))throw new Error('System timeline events are immutable.');const before=next.timelineNotes.length;next.timelineNotes=next.timelineNotes.filter(note=>text(note.noteId)!==id);if(next.timelineNotes.length===before)throw new Error('Timeline note not found.');next.updatedAt=number(at,Date.now());return next;
  }

  function combinedTimeline(record={}){
    const system=(record.timelineEvents||[]).map(event=>({...event,entryType:'system',at:number(event.at,0)}));const notes=(record.timelineNotes||[]).map(note=>({...note,entryType:'recruiter-note',at:number(note.at,0)}));return[...system,...notes].sort((a,b)=>b.at-a.at||text(a.eventId||a.noteId).localeCompare(text(b.eventId||b.noteId)));
  }

  function changeStage(record,stage,at=Date.now()){
    const before=text(record?.pipelineStage)||'Not Contacted';const after=text(stage)||before;if(before===after)return cloneRecord(record||{});const when=number(at,Date.now());let next=cloneRecord(record||{});next.pipelineStage=after;next.stageChangedAt=when;next.updatedAt=when;next=addSystemEvent(next,'stage-changed',{from:before,to:after},when);return next;
  }

  return Object.freeze({normalizeRecurrence,addSystemEvent,addFollowUp,completeFollowUp,recordContactOutcome,setDoNotContact,canMessage,stageAging,addTimelineNote,editTimelineNote,deleteTimelineNote,combinedTimeline,changeStage});
});

/* bundled runtime: v46-company-workflow.js */
(function(root,factory){
  let Operations=root&&root.RA_V46CompanyOperations;
  if(!Operations&&typeof module==='object'&&module.exports)Operations=require('./v46-company-operations');
  const api=factory(Operations);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyWorkflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Operations){
  'use strict';
  if(!Operations)throw new Error('Company Operations is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const clone=record=>({...record,campaigns:unique(record?.campaigns),cycles:(record?.cycles||[]).map(item=>({...item})),timelineEvents:(record?.timelineEvents||[]).map(item=>({...item,payload:item?.payload?{...item.payload}:item?.payload})),timelineNotes:(record?.timelineNotes||[]).map(item=>({...item})),followUps:(record?.followUps||[]).map(item=>({...item})),outcomes:(record?.outcomes||[]).map(item=>({...item}))});
  const sessionClone=session=>({...session,candidateIds:unique(session?.candidateIds),outcomes:(session?.outcomes||[]).map(item=>({...item})),filters:{...(session?.filters||{})}});
  const makeId=(prefix,at)=>`${prefix}-${number(at,Date.now())}-${Math.random().toString(36).slice(2,8)}`;

  function addCampaignMembership(record,campaignId,at=Date.now()){
    const id=text(campaignId);if(!id)throw new Error('Campaign ID is required.');
    let next=clone(record||{});next.campaigns=unique([...next.campaigns,id]);next.updatedAt=number(at,Date.now());
    return Operations.addSystemEvent(next,'campaign-membership-added',{campaignId:id},next.updatedAt);
  }

  function removeCampaignMembership(record,campaignId,at=Date.now()){
    const id=text(campaignId);if(!id)throw new Error('Campaign ID is required.');
    let next=clone(record||{});next.campaigns=next.campaigns.filter(value=>value!==id);next.updatedAt=number(at,Date.now());
    return Operations.addSystemEvent(next,'campaign-membership-removed',{campaignId:id},next.updatedAt);
  }

  function setTalentPool(record,enabled,reason='',at=Date.now()){
    let next=clone(record||{});const when=number(at,Date.now());next.talentPool=enabled===true;next.talentPoolReason=next.talentPool?text(reason):'';next.talentPoolChangedAt=when;next.updatedAt=when;
    return Operations.addSystemEvent(next,'talent-pool-changed',{enabled:next.talentPool,reason:next.talentPoolReason},when);
  }

  function reactivate(record,reason='',at=Date.now(),cycleId=''){
    let next=clone(record||{});const when=number(at,Date.now());const previousStage=text(next.pipelineStage)||'Not Contacted';
    next.cycles.push({cycleId:text(cycleId)||makeId('cycle',when),startedAt:when,reason:text(reason),previousStage});
    next.pipelineStage='Not Contacted';next.stageChangedAt=when;next.archived=false;next.updatedAt=when;
    return Operations.addSystemEvent(next,'reactivated',{reason:text(reason),previousStage,cycleId:next.cycles.at(-1).cycleId},when);
  }

  function currentSessionCandidate(session={}){
    const ids=unique(session.candidateIds);const cursor=Math.max(0,Math.floor(number(session.cursor,0)));return ids[cursor]||'';
  }

  function recordSessionAction(session,raw={},at=Date.now()){
    const next=sessionClone(session||{});const when=number(at,Date.now());const current=currentSessionCandidate(next);const userId=text(raw.userId);const action=text(raw.action);
    if(!current)throw new Error('Recruitment session has no current candidate.');
    if(userId!==current)throw new Error('Action must target the current session candidate.');
    if(!action)throw new Error('An explicit session action is required.');
    next.outcomes.push({userId,action,note:text(raw.note),at:when});
    next.cursor=Math.min(next.candidateIds.length,Math.max(0,Math.floor(number(next.cursor,0)))+1);
    next.status=next.cursor>=next.candidateIds.length?'Completed':'Active';
    if(next.status==='Completed')next.completedAt=when;
    if(!next.startedAt)next.startedAt=when;
    next.updatedAt=when;
    return next;
  }

  return Object.freeze({addCampaignMembership,removeCampaignMembership,setTalentPool,reactivate,currentSessionCandidate,recordSessionAction});
});

/* bundled runtime: v46-company-workflow-ui.js */
(function(root,factory){
  let Workflow=root&&root.RA_V46CompanyWorkflow;
  if(!Workflow&&typeof module==='object'&&module.exports)Workflow=require('./v46-company-workflow');
  const api=factory(Workflow);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyWorkflowUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Workflow){
  'use strict';
  if(!Workflow)throw new Error('Company Workflow is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const terminal=new Set(['Hired','Rejected']);
  function candidateOptions(rows=[],selected='',filter=()=>true){return rows.filter(filter).map(row=>`<option value="${esc(row.userId)}" ${text(row.userId)===text(selected)?'selected':''}>${esc(row.name)} [${esc(row.userId)}]</option>`).join('');}
  function vacancyOptions(vacancies=[],selected=''){return `<option value="">No vacancy</option>`+vacancies.map(v=>`<option value="${esc(v.vacancyId)}" ${text(v.vacancyId)===text(selected)?'selected':''}>${esc(v.name||v.role||v.vacancyId)}</option>`).join('');}
  function rowMap(rows=[]){return new Map(rows.map(row=>[text(row.userId),row]));}

  function renderCampaignsPage({campaigns=[],rows=[],vacancies=[]}={}){
    const players=rowMap(rows);
    const cards=campaigns.map(campaign=>{
      const members=unique(campaign.candidateIds).map(id=>players.get(id)).filter(Boolean);
      const available=rows.filter(row=>!unique(campaign.candidateIds).includes(text(row.userId)));
      return `<section class="ra-panel" data-campaign-card="${esc(campaign.campaignId)}"><div class="ra-panel-head"><div><h3>${esc(campaign.title||'Untitled Campaign')}</h3><p>${esc(campaign.target||'No target specified')} · ${esc(campaign.status||'Draft')}</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input data-campaign-field="title" value="${esc(campaign.title)}"></div><div class="ra-field"><label>Target</label><input data-campaign-field="target" value="${esc(campaign.target)}"></div><div class="ra-field"><label>Vacancy</label><select data-campaign-field="vacancyId">${vacancyOptions(vacancies,campaign.vacancyId)}</select></div><div class="ra-field"><label>Status</label><select data-campaign-field="status"><option ${campaign.status==='Draft'?'selected':''}>Draft</option><option ${campaign.status==='Active'?'selected':''}>Active</option><option ${campaign.status==='Paused'?'selected':''}>Paused</option><option ${campaign.status==='Completed'?'selected':''}>Completed</option><option ${campaign.status==='Archived'?'selected':''}>Archived</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-campaign-field="notes">${esc(campaign.notes)}</textarea></div></div><div class="ra-actions"><button class="ra-btn ra-primary" data-campaign-save="${esc(campaign.campaignId)}">Save Campaign</button><button class="ra-btn ra-danger" data-campaign-delete="${esc(campaign.campaignId)}">Delete</button></div><h4>Members</h4><div>${members.map(row=>`<div class="ra-actions" style="justify-content:space-between;margin:4px 0"><span>${esc(row.name)} <span class="ra-muted">[${esc(row.userId)}]</span></span><button class="ra-btn ra-danger" data-campaign-remove-member="${esc(campaign.campaignId)}" data-campaign-user="${esc(row.userId)}">Remove</button></div>`).join('')||'<div class="ra-muted">No members.</div>'}</div><div class="ra-actions" style="margin-top:8px"><select class="ra-btn" data-campaign-member-select="${esc(campaign.campaignId)}"><option value="">Add candidate…</option>${candidateOptions(available)}</select><button class="ra-btn" data-campaign-add-member="${esc(campaign.campaignId)}">Add Member</button></div></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Create Campaign</h3><p>Campaigns organize Company recruitment work. Membership is many-to-many.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input id="ra-company-campaign-title"></div><div class="ra-field"><label>Target</label><input id="ra-company-campaign-target"></div><div class="ra-field"><label>Vacancy</label><select id="ra-company-campaign-vacancy">${vacancyOptions(vacancies)}</select></div><div class="ra-field"><label>Status</label><select id="ra-company-campaign-status"><option>Draft</option><option>Active</option><option>Paused</option><option>Completed</option><option>Archived</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea id="ra-company-campaign-notes"></textarea></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-company-campaign-new">Create Campaign</button></div></section>${cards||'<section class="ra-panel"><div class="ra-muted">No campaigns yet.</div></section>'}`;
  }

  function renderTalentPoolPage(rows=[]){
    const pooled=rows.filter(row=>row.talentPool===true||row.companyRecord?.talentPool===true);
    const available=rows.filter(row=>!(row.talentPool===true||row.companyRecord?.talentPool===true));
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Add to Talent Pool</h3><p>Keep promising candidates without changing their Company pipeline stage.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-company-talent-player"><option value="">Choose candidate…</option>${candidateOptions(available)}</select></div><div class="ra-field"><label>Reason</label><input id="ra-company-talent-reason"></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-company-talent-add">Add to Talent Pool</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Talent Pool</h3><p>Reusable prospects remain tied to the same Torn player identity.</p></div></div>${pooled.map(row=>`<div class="ra-actions" style="justify-content:space-between;margin:6px 0"><div><b>${esc(row.name)}</b> <span class="ra-muted">[${esc(row.userId)}]</span><div class="ra-note">${esc(row.talentPoolReason||row.companyRecord?.talentPoolReason||'No reason recorded')}</div></div><button class="ra-btn ra-danger" data-talent-remove="${esc(row.userId)}">Remove</button></div>`).join('')||'<div class="ra-muted">Talent Pool is empty.</div>'}</section><section class="ra-panel"><h3>Available Candidates</h3>${available.map(row=>`<div>${esc(row.name)} <span class="ra-muted">[${esc(row.userId)}] · ${esc(row.pipelineStage)}</span></div>`).join('')||'<div class="ra-muted">Everyone is already pooled.</div>'}</section>`;
  }

  function renderReactivationPage(rows=[]){
    const eligible=rows.filter(row=>row.archived===true||terminal.has(text(row.pipelineStage))||row.talentPool===true||row.companyRecord?.talentPool===true);
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Reactivation</h3><p>Start a new Company recruitment cycle without creating a second player identity.</p></div></div>${eligible.map(row=>`<div class="ra-panel" style="margin:6px 0"><b>${esc(row.name)}</b> <span class="ra-muted">[${esc(row.userId)}] · ${esc(row.pipelineStage)}</span><div class="ra-formgrid" style="margin-top:6px"><div class="ra-field"><label>Reason</label><input data-reactivate-reason="${esc(row.userId)}" placeholder="Why reopen this candidate?"></div><div class="ra-field"><label>Previous cycles</label><input disabled value="${number(row.companyRecord?.cycles?.length,0)}"></div></div><div class="ra-actions" style="margin-top:6px"><button class="ra-btn ra-primary" data-reactivate-player="${esc(row.userId)}">Start New Cycle</button></div></div>`).join('')||'<div class="ra-muted">No candidates are currently eligible for reactivation.</div>'}</section>`;
  }

  function renderRecruitmentSessionsPage({sessions=[],rows=[]}={}){
    const players=rowMap(rows);
    const activeCandidates=rows.filter(row=>!row.archived&&!terminal.has(text(row.pipelineStage)));
    const cards=sessions.map(session=>{
      const currentId=Workflow.currentSessionCandidate(session);const current=players.get(text(currentId));const progress=`${Math.min(number(session.cursor,0),unique(session.candidateIds).length)}/${unique(session.candidateIds).length}`;
      return `<section class="ra-panel" data-session-card="${esc(session.sessionId)}"><div class="ra-panel-head"><div><h3>${esc(session.title||'Recruitment Session')}</h3><p>${esc(session.status||'Draft')} · ${esc(progress)}</p></div></div>${current?`<div class="ra-kpi"><span>Current candidate</span><b>${esc(current.name)}</b><div class="ra-note">${esc(current.userId)} · ${esc(current.pipelineStage)}</div></div><div class="ra-field" style="margin-top:8px"><label>Action note</label><input data-session-note="${esc(session.sessionId)}"></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" data-session-action="${esc(session.sessionId)}" data-session-user="${esc(current.userId)}" value="Contacted">Contacted</button><button class="ra-btn" data-session-action="${esc(session.sessionId)}" data-session-user="${esc(current.userId)}" value="Shortlisted">Shortlisted</button><button class="ra-btn" data-session-action="${esc(session.sessionId)}" data-session-user="${esc(current.userId)}" value="Rejected">Rejected</button><button class="ra-btn" data-session-action="${esc(session.sessionId)}" data-session-user="${esc(current.userId)}" value="Skip">Skip</button></div>`:'<div class="ra-muted">No current candidate. Session is complete or empty.</div>'}<details style="margin-top:8px"><summary>Session history</summary>${(session.outcomes||[]).map(outcome=>`<div>${esc(outcome.userId)} · ${esc(outcome.action)}${outcome.note?` · ${esc(outcome.note)}`:''}</div>`).join('')||'<div class="ra-muted">No actions yet.</div>'}</details></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Create Recruitment Session</h3><p>Sessions process a frozen candidate queue one explicit action at a time.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input id="ra-company-session-title"></div><div class="ra-field"><label>Candidate source</label><select id="ra-company-session-source"><option value="active">All active Company candidates (${activeCandidates.length})</option></select></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-company-session-new">Create Session</button></div></section>${cards||'<section class="ra-panel"><div class="ra-muted">No recruitment sessions yet.</div></section>'}`;
  }

  return Object.freeze({renderCampaignsPage,renderTalentPoolPage,renderReactivationPage,renderRecruitmentSessionsPage});
});

/* bundled runtime: v46-company-opportunity-ui.js */
(function(root,factory){
  let CompanyCore=root&&root.RA_V46CompanyCore;
  if(!CompanyCore&&typeof module==='object'&&module.exports)CompanyCore=require('./v46-company-core');
  const api=factory(CompanyCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyOpportunityUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(CompanyCore){
  'use strict';
  if(!CompanyCore)throw new Error('CompanyCore is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hours=(now,at)=>Math.max(0,(number(now)-number(at,0))/3600000);
  const money=value=>Number.isFinite(Number(value))?`$${Math.round(Number(value)).toLocaleString()}`:'—';
  const metric=value=>Number.isFinite(Number(value))?Number(value).toLocaleString():'—';
  const score=value=>Number.isFinite(Number(value))?Math.round(Number(value)):'—';

  function freshness(lastScoutAt,now){
    if(!Number.isFinite(Number(lastScoutAt))||Number(lastScoutAt)<=0)return 'Very stale';
    const age=hours(now,lastScoutAt);
    if(age<=24)return 'Fresh';
    if(age<=72)return 'Aging';
    if(age<=168)return 'Stale';
    return 'Very stale';
  }

  function selectedVacancy(row={}){
    const preferred=text(row.pinnedVacancyId)||text(row.suggestedVacancyId);
    const evaluations=Array.isArray(row.vacancyEvaluations)?row.vacancyEvaluations:[];
    const evaluation=evaluations.find(item=>text(item.vacancyId)===preferred)||[...evaluations].sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.vacancyId).localeCompare(text(b.vacancyId)))[0]||null;
    const selectedId=text(evaluation?.vacancyId)||preferred;
    const option=(Array.isArray(row.vacancyOptions)?row.vacancyOptions:[]).find(item=>text(item.vacancyId)===selectedId);
    return{selectedVacancyId:selectedId,selectedVacancyName:text(option?.name)||selectedId||'No active vacancy',evaluation};
  }

  function followUpDue(record={},now=Date.now()){
    return (Array.isArray(record.followUps)?record.followUps:[]).some(item=>{
      if(['completed','cancelled'].includes(text(item.state).toLowerCase()))return false;
      const due=Number(item.dueAt);
      return Number.isFinite(due)&&due<=Number(now);
    });
  }

  function buildOpportunityRows(rows=[],options={}){
    const now=number(options.now,Date.now());
    const weights={...(options.weights||{})};
    return (Array.isArray(rows)?rows:[]).map(row=>{
      const vacancy=selectedVacancy(row);
      const input={
        match:number(vacancy.evaluation?.matchScore,0),
        fit:number(row.fit,0),
        availability:text(row.availability),
        lastActiveAgeHours:Number.isFinite(Number(row.lastActive))?hours(now,row.lastActive):999,
        intelligenceFreshness:freshness(row.playerRecord?.lastScoutAt,now),
        contactPenalty:row.doNotContact===true||row.companyRecord?.doNotContact===true?100:0,
        followUpDue:followUpDue(row.companyRecord||row,now)
      };
      return{
        userId:text(row.userId),name:text(row.name)||`User ${text(row.userId)}`,
        pipelineStage:text(row.pipelineStage),eligibility:text(row.eligibility),availability:text(row.availability)||'Unknown',fit:row.fit??null,ee:row.ee??null,
        selectedVacancyId:vacancy.selectedVacancyId,selectedVacancyName:vacancy.selectedVacancyName,
        opportunity:CompanyCore.computeOpportunity(input,weights),
        intelligenceFreshness:input.intelligenceFreshness,
        companyRecord:row.companyRecord,playerRecord:row.playerRecord
      };
    }).sort((a,b)=>number(b.opportunity?.score)-number(a.opportunity?.score)||a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function renderBreakdown(opportunity={}){
    return (opportunity.breakdown||[]).map(item=>`<span>${esc(item.label)}: ${score(item.value)} × ${score(item.weight)}%${item.label==='Contact penalty'?'':` = ${esc(item.contribution)}`}</span>`).join('<br>');
  }

  function renderOpportunityPage(rows=[]){
    const body=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td><b>${esc(row.name)}</b><div class="ra-muted">${esc(row.userId)} · ${esc(row.pipelineStage)}</div></td><td><b>${score(row.opportunity?.score)}</b></td><td>${esc(row.selectedVacancyName)}</td><td>${esc(row.eligibility||'Unknown')}</td><td>${score(row.fit)}</td><td>${esc(row.intelligenceFreshness)}</td><td><details><summary>Breakdown</summary><div class="ra-note">${renderBreakdown(row.opportunity)}</div><div class="ra-muted">${esc(row.opportunity?.explanation)}</div></details></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Opportunity Queue</h3><p>Explainable local priority scoring. Viewing or rescoring never changes Company pipeline state.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Opportunity</th><th>Vacancy</th><th>Eligibility</th><th>Fit</th><th>Freshness</th><th>Why</th></tr></thead><tbody>${body||'<tr><td colspan="7">No Company opportunities.</td></tr>'}</tbody></table></div></section>`;
  }

  function bestVacancyName(row={}){
    const chosen=selectedVacancy(row);
    return chosen.selectedVacancyName;
  }

  function renderComparePage(rows=[],selectedIds=[]){
    const selected=new Set((Array.isArray(selectedIds)?selectedIds:[]).map(text));
    const choices=(Array.isArray(rows)?rows:[]).map(row=>`<label style="display:inline-flex;align-items:center;gap:5px;margin:4px 10px 4px 0"><input type="checkbox" data-company-compare-select="${esc(row.userId)}" ${selected.has(text(row.userId))?'checked':''}> ${esc(row.name)} [${esc(row.userId)}]</label>`).join('');
    const picked=(Array.isArray(rows)?rows:[]).filter(row=>selected.has(text(row.userId))).slice(0,4);
    const cards=picked.map(row=>`<section class="ra-panel" style="min-width:240px;flex:1"><h3>${esc(row.name)}</h3><div class="ra-detail-grid"><span>Player ID<b>${esc(row.userId)}</b></span><span>Stage<b>${esc(row.pipelineStage)}</b></span><span>Eligibility<b>${esc(row.eligibility||'Unknown')}</b></span><span>Availability<b>${esc(row.availability||'Unknown')}</b></span><span>Fit<b>${score(row.fit)}</b></span><span>EE<b>${metric(row.ee)}</b></span><span>Current Company<b>${esc(row.playerRecord?.currentCompany||'—')}</b></span><span>Desired Role<b>${esc(row.desiredRole||'—')}</b></span><span>Expected Salary<b>${money(row.expectedSalary)}</b></span><span>Best Vacancy<b>${esc(bestVacancyName(row))}</b></span></div></section>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Compare</h3><p>Select up to four Torn players to compare shared player facts with Company-specific recruitment results.</p></div></div><div>${choices||'<span class="ra-muted">No Company players available.</span>'}</div></section><div style="display:flex;gap:10px;flex-wrap:wrap">${cards||'<section class="ra-panel"><div class="ra-muted">Select players above to compare them.</div></section>'}</div>`;
  }

  return Object.freeze({freshness,selectedVacancy,buildOpportunityRows,renderOpportunityPage,renderComparePage});
});

/* bundled runtime: v46-company-platform.js */
(function(root,factory){
  const deps={
    CompanyCore:root&&root.RA_V46CompanyCore,
    CompanyUI:root&&root.RA_V46CompanyUI,
    Operations:root&&root.RA_V46CompanyOperations,
    Workflow:root&&root.RA_V46CompanyWorkflow,
    WorkflowUI:root&&root.RA_V46CompanyWorkflowUI,
    OpportunityUI:root&&root.RA_V46CompanyOpportunityUI,
    Messaging:root&&root.RA_V45Messaging
  };
  if(typeof module==='object'&&module.exports){
    deps.CompanyCore=require('./v46-company-core');
    deps.CompanyUI=require('./v46-company-ui');
    deps.Operations=require('./v46-company-operations');
    deps.Workflow=require('./v46-company-workflow');
    deps.WorkflowUI=require('./v46-company-workflow-ui');
    deps.OpportunityUI=require('./v46-company-opportunity-ui');
    deps.Messaging=require('./v45-messaging');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,CompanyUI,Operations,Workflow,WorkflowUI,OpportunityUI,Messaging}=D;
  if(!CompanyCore||!CompanyUI||!Operations||!Workflow||!WorkflowUI||!OpportunityUI||!Messaging)throw new Error('CompanyCore, CompanyUI, Operations, Workflow, WorkflowUI, OpportunityUI and Messaging are required.');

  const COMPANY_ROUTES=Object.freeze([
    'company-overview','company-today','company-discover','company-candidates','company-pipeline',
    'company-vacancies','company-campaigns','company-followups','company-timeline','company-stage-aging',
    'company-contact-outcomes','company-recruitment-sessions','company-talent-pool','company-reactivation',
    'company-opportunity','company-compare'
  ]);
  const IMPLEMENTED_ROUTES=new Set([
    'company-overview','company-today','company-candidates','company-pipeline','company-vacancies',
    'company-campaigns','company-followups','company-timeline','company-stage-aging','company-contact-outcomes',
    'company-recruitment-sessions','company-talent-pool','company-reactivation','company-opportunity','company-compare'
  ]);
  const META=Object.freeze({
    'company-overview':['Company Overview','Company recruitment status and work needing attention.'],
    'company-today':['Company Today','Prioritized Company recruitment work for today.'],
    'company-discover':['Company Discover','Company-only recruitment discovery and enrichment.'],
    'company-candidates':['Company Candidates','Search and manage Company recruitment candidates.'],
    'company-pipeline':['Company Pipeline','Move Company candidates through explicit recruitment stages.'],
    'company-vacancies':['Company Vacancies','Define and manage Company hiring needs.'],
    'company-campaigns':['Company Campaigns','Organize Company recruitment campaigns.'],
    'company-followups':['Company Follow-ups','Track Company candidate follow-ups.'],
    'company-timeline':['Company Timeline','Review Company recruitment history.'],
    'company-stage-aging':['Company Stage Aging','Review candidates aging in their current Company stage.'],
    'company-contact-outcomes':['Company Contact Outcomes','Track Company recruitment contact outcomes independently of stage.'],
    'company-recruitment-sessions':['Company Recruitment Sessions','Work focused Company recruitment queues.'],
    'company-talent-pool':['Company Talent Pool','Maintain reusable Company talent prospects.'],
    'company-reactivation':['Company Reactivation','Restart Company recruitment cycles without duplicating identity.'],
    'company-opportunity':['Company Opportunity Queue','Review explainable Company recruitment opportunities.'],
    'company-compare':['Company Compare','Compare Company candidates side by side.']
  });
  const DEFAULT_OPPORTUNITY_WEIGHTS=Object.freeze({match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});

  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const SORT_KEYS=new Set(['player','end','man','int','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,compareSelection:new Set(),searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT}};
  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.playerRecord||{};const name=text(row.currentCompany||player.currentCompany);const rawId=row.currentCompanyId??player.currentCompanyId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Company #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(key==='end'||key==='man'||key==='int'){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }
  const terminalStage=stage=>['Hired','Rejected'].includes(text(stage));

  function isCompanyRoute(value){return COMPANY_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['company-overview'];return{title,description};}
  function opportunityWeights(config={}){return{...DEFAULT_OPPORTUNITY_WEIGHTS,...(config.opportunityWeights||{})};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}
  function dbDelete(db,store,key){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error(`Failed to delete from ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.companyRepositories?.config?.get)return app._test.companyRepositories.config.get();return(await dbGet(app._test.state.db,'companyRecruitmentConfig','company'))||{key:'company',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.companyRepositories?.config?.save)return app._test.companyRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentConfig',next);return next;}
  async function getVacancies(app){if(app?._test?.companyRepositories?.vacancies?.list)return app._test.companyRepositories.vacancies.list();return dbGetAll(app._test.state.db,'companyVacancies');}
  async function saveVacancy(app,vacancy){if(app?._test?.companyRepositories?.vacancies?.save)return app._test.companyRepositories.vacancies.save(vacancy);const next=CompanyCore.normalizeVacancy({...vacancy,updatedAt:Date.now()});await dbPut(app._test.state.db,'companyVacancies',next);return next;}
  async function removeVacancy(app,vacancyId){if(app?._test?.companyRepositories?.vacancies?.remove)return app._test.companyRepositories.vacancies.remove(vacancyId);return dbDelete(app._test.state.db,'companyVacancies',text(vacancyId));}
  async function getCampaigns(app){if(app?._test?.companyRepositories?.campaigns?.list)return app._test.companyRepositories.campaigns.list();return dbGetAll(app._test.state.db,'companyCampaigns');}
  async function getCampaign(app,campaignId){if(app?._test?.companyRepositories?.campaigns?.get)return app._test.companyRepositories.campaigns.get(campaignId);return dbGet(app._test.state.db,'companyCampaigns',text(campaignId));}
  async function saveCampaign(app,campaign){if(app?._test?.companyRepositories?.campaigns?.save)return app._test.companyRepositories.campaigns.save(campaign);const next={...campaign,campaignId:text(campaign.campaignId)||makeId('campaign'),candidateIds:[...new Set((campaign.candidateIds||[]).map(text).filter(Boolean))],updatedAt:Date.now()};await dbPut(app._test.state.db,'companyCampaigns',next);return next;}
  async function removeCampaign(app,campaignId){if(app?._test?.companyRepositories?.campaigns?.remove)return app._test.companyRepositories.campaigns.remove(campaignId);return dbDelete(app._test.state.db,'companyCampaigns',text(campaignId));}
  async function getSessions(app){if(app?._test?.companyRepositories?.sessions?.list)return app._test.companyRepositories.sessions.list();return dbGetAll(app._test.state.db,'companyRecruitmentSessions');}
  async function getSession(app,sessionId){if(app?._test?.companyRepositories?.sessions?.get)return app._test.companyRepositories.sessions.get(sessionId);return dbGet(app._test.state.db,'companyRecruitmentSessions',text(sessionId));}
  async function saveSession(app,session){if(app?._test?.companyRepositories?.sessions?.save)return app._test.companyRepositories.sessions.save(session);const next={...session,sessionId:text(session.sessionId)||makeId('session'),candidateIds:[...new Set((session.candidateIds||[]).map(text).filter(Boolean))],updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentSessions',next);return next;}
  async function saveCompanyPatch(app,userId,patch){const id=text(userId);if(app?._test?.repositories?.company?.ensure)return app._test.repositories.company.ensure(id,patch,{source:'company-platform',observedAt:Date.now()});const existing=await dbGet(app._test.state.db,'companyRecruitment',id);if(!existing)throw new Error('Company candidate was not found.');const next={...existing,...patch,userId:id,domain:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitment',next);return next;}

  function evaluateCandidateVacancies(row,vacancies=[]){
    const open=(Array.isArray(vacancies)?vacancies:[]).filter(v=>text(v?.status)==='Open');
    const facts={level:row.level,ee:row.ee,fit:row.fit,activity30:row.activity30,xanax30:row.xanax30,refills30:row.refills30,attacks30:row.attacks30,rwHits30:row.rwHits30,networth:row.networth,availability:row.availability,desiredRole:row.desiredRole};
    const waivers=row.companyRecord?.waivers||[];
    const evaluations=open.map(vacancy=>CompanyCore.evaluateVacancy(vacancy,facts,waivers));
    const selection=CompanyCore.suggestVacancy(open,evaluations,row.companyRecord?.pinnedVacancyId||'');
    return{evaluations,selection};
  }
  function canMoveToStage(row,stage){return !(text(stage)==='Hired'&&row?.hardFailed===true);}

  async function buildRows(app){
    const db=app._test.state.db;
    const[companyRecords,players,candidateLocals,config,vacancies]=await Promise.all([dbGetAll(db,'companyRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getVacancies(app)]);
    const baseline=CompanyCore.normalizeBaseline(config.baseline||{});
    const rows=CompanyUI.buildCandidateRows(companyRecords,players,{eligibilityFor:(record,player)=>CompanyCore.evaluateCriteria(baseline.criteria,player,record.waivers||[])});
    const vacancyMap=new Map(vacancies.map(v=>[text(v.vacancyId),v]));
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return rows.map(row=>{
      const result=evaluateCandidateVacancies(row,vacancies);
      const evaluationMap=new Map(result.evaluations.map(e=>[text(e.vacancyId),e]));
      const options=vacancies.filter(v=>text(v.status)==='Open').map(v=>({vacancyId:text(v.vacancyId),name:text(v.name)||text(v.role)||text(v.vacancyId),matchScore:evaluationMap.get(text(v.vacancyId))?.matchScore??null,eligible:evaluationMap.get(text(v.vacancyId))?.eligible===true}));
      const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.playerRecord||{};
      return{...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),talentPool:row.companyRecord?.talentPool===true,talentPoolReason:text(row.companyRecord?.talentPoolReason),vacancyEvaluations:result.evaluations,pinnedVacancyId:text(result.selection.pinnedVacancyId),suggestedVacancyId:text(result.selection.suggestedVacancyId),suggestedVacancyName:text(vacancyMap.get(text(result.selection.suggestedVacancyId))?.name),vacancyOptions:options};
    });
  }

  async function buildOpportunityRows(app,rows,now=Date.now()){
    const config=await getConfig(app);
    return OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
  }

  async function persistRoute(app,page){const state=app?._test?.state;if(!state?.db)return false;state.page=page;state.settings=state.settings||{};state.settings.activePage=page;const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};meta.settings={...(meta.settings||{}),activePage:page};await dbPut(state.db,'meta',meta);return true;}
  function claimRoute(app,page){const state=app?._test?.state,route=text(page);if(!state||!IMPLEMENTED_ROUTES.has(route))return false;state.page=route;state.settings=state.settings||{};state.settings.activePage=route;return true;}
  function navigate(page,persist=true){const route=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(route))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(route,persist));claimRoute(runtime.app,route);return renderPage(route,{persist});}
  function readCriteria(host){if(!host)return[];return[...host.querySelectorAll('[data-criterion-row]')].map((row,index)=>{const get=key=>row.querySelector(`[data-criterion-field="${key}"]`)?.value??'';const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;return{id:text(row.dataset.criterionId)||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};});}
  async function rowFor(userId){const rows=await buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error('Company candidate was not found.');return row;}
  async function saveOperationalRecord(userId,next){await saveCompanyPatch(runtime.app,userId,next);return next;}

  async function changeCompanyStage(userId,stage){const row=await rowFor(userId);if(!canMoveToStage(row,stage))throw new Error('This candidate cannot be moved to Hired while an unwaived Company baseline Hard requirement is failing.');return saveOperationalRecord(userId,Operations.changeStage(row.companyRecord,text(stage),Date.now()));}
  async function setVacancyPin(userId,vacancyId){await saveCompanyPatch(runtime.app,userId,{pinnedVacancyId:text(vacancyId),updatedAt:Date.now()});return true;}
  async function addFollowUpFromUi(){const userId=text(document.getElementById('ra-company-followup-player')?.value);const row=await rowFor(userId);const dueRaw=text(document.getElementById('ra-company-followup-due')?.value);const dueAt=Date.parse(dueRaw);if(!Number.isFinite(dueAt))throw new Error('Choose a valid follow-up date and time.');const unit=text(document.getElementById('ra-company-followup-recurrence-unit')?.value);const recurrence=unit?{unit,interval:Math.max(1,number(document.getElementById('ra-company-followup-recurrence-interval')?.value,1))}:null;const next=Operations.addFollowUp(row.companyRecord,{dueAt,reason:text(document.getElementById('ra-company-followup-reason')?.value),note:text(document.getElementById('ra-company-followup-note')?.value),recurrence},Date.now());return saveOperationalRecord(userId,next);}
  async function completeFollowUp(userId,followUpId){const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.completeFollowUp(row.companyRecord,followUpId,Date.now()));}
  async function recordOutcomeFromUi(){const userId=text(document.getElementById('ra-company-outcome-player')?.value);const row=await rowFor(userId);const next=Operations.recordContactOutcome(row.companyRecord,{result:text(document.getElementById('ra-company-outcome-result')?.value),channel:text(document.getElementById('ra-company-outcome-channel')?.value),note:text(document.getElementById('ra-company-outcome-note')?.value)},Date.now());return saveOperationalRecord(userId,next);}
  async function toggleDnc(userId,enabled){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-dnc-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Operations.setDoNotContact(row.companyRecord,enabled,reason,Date.now()));}
  async function addTimelineNoteFromUi(){const userId=text(document.getElementById('ra-company-timeline-player')?.value);const row=await rowFor(userId);const value=text(document.getElementById('ra-company-timeline-note')?.value);if(!value)throw new Error('Timeline note cannot be empty.');return saveOperationalRecord(userId,Operations.addTimelineNote(row.companyRecord,{text:value},Date.now()));}
  async function editTimelineNote(userId,noteId){const row=await rowFor(userId);const current=(row.companyRecord.timelineNotes||[]).find(note=>text(note.noteId)===text(noteId));if(!current)throw new Error('Timeline note not found.');const value=text(globalThis.prompt?.('Edit recruiter timeline note:',current.text));if(!value)return false;return saveOperationalRecord(userId,Operations.editTimelineNote(row.companyRecord,noteId,value,Date.now()));}
  async function deleteTimelineNote(userId,noteId){if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this recruiter timeline note?'))return false;const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.deleteTimelineNote(row.companyRecord,noteId,Date.now()));}
  async function recruitPlayer(userId,override=false){const row=await rowFor(userId);if(!Operations.canMessage(row.companyRecord,override))throw new Error('This candidate is marked Do Not Contact. Use the explicit override only when you deliberately intend to contact them.');if(override&&typeof globalThis.confirm==='function'&&!globalThis.confirm('This candidate is marked Do Not Contact. Override it for this recruitment chat only?'))return false;if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');return runtime.app.recruitCandidate?.('company',text(userId),row.name);}

  async function createCampaignFromUi(){return saveCampaign(runtime.app,{campaignId:makeId('campaign'),title:text(document.getElementById('ra-company-campaign-title')?.value)||'Untitled Campaign',target:text(document.getElementById('ra-company-campaign-target')?.value),vacancyId:text(document.getElementById('ra-company-campaign-vacancy')?.value),status:text(document.getElementById('ra-company-campaign-status')?.value)||'Draft',notes:text(document.getElementById('ra-company-campaign-notes')?.value),candidateIds:[],createdAt:Date.now()});}
  async function saveCampaignFromCard(campaignId,card){const existing=await getCampaign(runtime.app,campaignId)||{campaignId,candidateIds:[]};const field=key=>card?.querySelector(`[data-campaign-field="${key}"]`)?.value??'';return saveCampaign(runtime.app,{...existing,campaignId,title:text(field('title'))||existing.title,target:text(field('target')),vacancyId:text(field('vacancyId')),status:text(field('status'))||existing.status,notes:text(field('notes'))});}
  async function changeCampaignMembership(campaignId,userId,add){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Company campaign was not found.');const row=await rowFor(userId);const ids=[...new Set((campaign.candidateIds||[]).map(text).filter(Boolean))];campaign.candidateIds=add?[...new Set([...ids,text(userId)])]:ids.filter(id=>id!==text(userId));const nextRecord=add?Workflow.addCampaignMembership(row.companyRecord,campaignId,Date.now()):Workflow.removeCampaignMembership(row.companyRecord,campaignId,Date.now());await Promise.all([saveCampaign(runtime.app,campaign),saveOperationalRecord(userId,nextRecord)]);return true;}
  async function setTalentPoolFromUi(enabled,userId=''){const id=text(userId)||text(document.getElementById('ra-company-talent-player')?.value);if(!id)throw new Error('Choose a Company candidate.');const row=await rowFor(id);const reason=enabled?text(document.getElementById('ra-company-talent-reason')?.value):'';return saveOperationalRecord(id,Workflow.setTalentPool(row.companyRecord,enabled,reason,Date.now()));}
  async function reactivateFromUi(userId){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-reactivate-reason="${userId}"]`)?.value);if(!reason)throw new Error('A reactivation reason is required.');return saveOperationalRecord(userId,Workflow.reactivate(row.companyRecord,reason,Date.now()));}
  async function createSessionFromUi(){const rows=await buildRows(runtime.app);const candidateIds=rows.filter(row=>!row.archived&&!terminalStage(row.pipelineStage)).map(row=>text(row.userId));if(!candidateIds.length)throw new Error('No active Company candidates are available for this session.');return saveSession(runtime.app,{sessionId:makeId('session'),title:text(document.getElementById('ra-company-session-title')?.value)||'Recruitment Session',candidateIds,cursor:0,status:'Active',outcomes:[],filters:{source:text(document.getElementById('ra-company-session-source')?.value)||'active'},startedAt:Date.now(),createdAt:Date.now()});}
  async function recordSessionActionFromUi(sessionId,userId,action){const session=await getSession(runtime.app,sessionId);if(!session)throw new Error('Recruitment session was not found.');const note=text(document.querySelector(`[data-session-note="${sessionId}"]`)?.value);return saveSession(runtime.app,Workflow.recordSessionAction(session,{userId,action,note},Date.now()));}

  function bindContentControls(currentPage){
    const page=text(currentPage||runtime.app?._test?.state?.page);
    document.getElementById('ra-company-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.searchFilters={search:text(document.getElementById('ra-company-filter-search')?.value),minEnd:text(document.getElementById('ra-company-filter-end')?.value),minMan:text(document.getElementById('ra-company-filter-man')?.value),minInt:text(document.getElementById('ra-company-filter-int')?.value),onlineStatus:text(document.getElementById('ra-company-filter-status')?.value),organization:text(document.getElementById('ra-company-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-company-filter-organization-presence')?.value)||'any'};try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('company',runtime.searchFilters);await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-company-search-clear')?.addEventListener('click',()=>{runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('company-candidates',{persist:false}).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-sort]').forEach(button=>{button.onclick=()=>{runtime.sort=toggleSort(runtime.sort,button.dataset.companySort);renderPage('company-candidates',{persist:false}).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-go-page]').forEach(button=>{if(!isCompanyRoute(button.dataset.goPage))return;button.onclick=event=>{event?.preventDefault?.();navigate(button.dataset.goPage,true).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-company-stage-select]').forEach(select=>{select.onchange=()=>changeCompanyStage(select.dataset.companyStageSelect,select.value).then(()=>renderPage(page,{persist:false})).catch(error=>{reportError(error);renderPage(page,{persist:false}).catch(reportError);});});
    document.querySelectorAll('#ra-content [data-company-vacancy-pin]').forEach(select=>{select.onchange=()=>setVacancyPin(select.dataset.companyVacancyPin,select.value).then(()=>renderPage('company-candidates',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruit,false).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit-override]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruitOverride,true).catch(reportError);});
    document.querySelectorAll('#ra-content [data-remove-criterion]').forEach(button=>{button.onclick=()=>button.closest('[data-criterion-row]')?.remove();});
    document.getElementById('ra-company-baseline-add')?.addEventListener('click',()=>document.getElementById('ra-company-baseline-criteria')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('baseline')},'baseline')));
    document.getElementById('ra-company-baseline-save')?.addEventListener('click',()=>saveConfig(runtime.app,{baseline:{criteria:readCriteria(document.getElementById('ra-company-baseline-criteria'))}}).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError));
    document.getElementById('ra-company-vacancy-new')?.addEventListener('click',()=>{const vacancy={vacancyId:makeId('vacancy'),name:text(document.getElementById('ra-company-new-vacancy-name')?.value)||'Untitled Vacancy',role:text(document.getElementById('ra-company-new-vacancy-role')?.value),openings:Math.max(1,Math.floor(number(document.getElementById('ra-company-new-vacancy-openings')?.value,1))),status:text(document.getElementById('ra-company-new-vacancy-status')?.value)||'Draft',criteria:[]};saveVacancy(runtime.app,vacancy).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-vacancy-add-criterion]').forEach(button=>{button.onclick=()=>button.closest('[data-vacancy-card]')?.querySelector('[data-criteria-host]')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('vacancy-criterion')},`vacancy:${button.dataset.vacancyAddCriterion}`));});
    document.querySelectorAll('#ra-content [data-vacancy-save]').forEach(button=>{button.onclick=()=>{const card=button.closest('[data-vacancy-card]');if(!card)return;const field=key=>card.querySelector(`[data-vacancy-field="${key}"]`)?.value??'';const vacancy={vacancyId:button.dataset.vacancySave,name:text(field('name')),role:text(field('role')),openings:Math.max(1,Math.floor(number(field('openings'),1))),status:text(field('status'))||'Draft',salaryBudget:field('salaryBudget')===''?null:number(field('salaryBudget')),availability:text(field('availability'))||'Unknown',notes:text(field('notes')),criteria:readCriteria(card.querySelector('[data-criteria-host]'))};saveVacancy(runtime.app,vacancy).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-vacancy-delete]').forEach(button=>{button.onclick=()=>{if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this Company vacancy?'))return;removeVacancy(runtime.app,button.dataset.vacancyDelete).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);};});
    document.getElementById('ra-company-followup-add')?.addEventListener('click',()=>addFollowUpFromUi().then(()=>renderPage('company-followups',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-followup-complete]').forEach(button=>{button.onclick=()=>completeFollowUp(button.dataset.followupUser,button.dataset.followupComplete).then(()=>renderPage('company-followups',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-outcome-add')?.addEventListener('click',()=>recordOutcomeFromUi().then(()=>renderPage('company-contact-outcomes',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-company-dnc]').forEach(button=>{button.onclick=()=>toggleDnc(button.dataset.companyDnc,button.dataset.dncEnable==='true').then(()=>renderPage('company-contact-outcomes',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-timeline-add')?.addEventListener('click',()=>addTimelineNoteFromUi().then(()=>renderPage('company-timeline',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-timeline-note-edit]').forEach(button=>{button.onclick=()=>editTimelineNote(button.dataset.timelineUser,button.dataset.timelineNoteEdit).then(()=>renderPage('company-timeline',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-timeline-note-delete]').forEach(button=>{button.onclick=()=>deleteTimelineNote(button.dataset.timelineUser,button.dataset.timelineNoteDelete).then(()=>renderPage('company-timeline',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-campaign-new')?.addEventListener('click',()=>createCampaignFromUi().then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-campaign-save]').forEach(button=>{button.onclick=()=>saveCampaignFromCard(button.dataset.campaignSave,button.closest('[data-campaign-card]')).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-campaign-delete]').forEach(button=>{button.onclick=()=>{if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this Company campaign?'))return;removeCampaign(runtime.app,button.dataset.campaignDelete).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-campaign-add-member]').forEach(button=>{button.onclick=()=>{const id=text(document.querySelector(`[data-campaign-member-select="${button.dataset.campaignAddMember}"]`)?.value);if(!id)return;changeCampaignMembership(button.dataset.campaignAddMember,id,true).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-campaign-remove-member]').forEach(button=>{button.onclick=()=>changeCampaignMembership(button.dataset.campaignRemoveMember,button.dataset.campaignUser,false).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-talent-add')?.addEventListener('click',()=>setTalentPoolFromUi(true).then(()=>renderPage('company-talent-pool',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-talent-remove]').forEach(button=>{button.onclick=()=>setTalentPoolFromUi(false,button.dataset.talentRemove).then(()=>renderPage('company-talent-pool',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-reactivate-player]').forEach(button=>{button.onclick=()=>reactivateFromUi(button.dataset.reactivatePlayer).then(()=>renderPage('company-reactivation',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-session-new')?.addEventListener('click',()=>createSessionFromUi().then(()=>renderPage('company-recruitment-sessions',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-session-action]').forEach(button=>{button.onclick=()=>recordSessionActionFromUi(button.dataset.sessionAction,button.dataset.sessionUser,button.value).then(()=>renderPage('company-recruitment-sessions',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-compare-select]').forEach(input=>{input.onchange=()=>{const id=text(input.dataset.companyCompareSelect);if(input.checked){if(runtime.compareSelection.size>=4){input.checked=false;reportError(new Error('Compare supports up to four players.'));return;}runtime.compareSelection.add(id);}else runtime.compareSelection.delete(id);renderPage('company-compare',{persist:false}).catch(reportError);};});
  }

  function syncActiveNav(page){document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));}
  function reportError(error){console.error('[RA v4.6 Company]',error);try{globalThis.alert?.(`Company Recruitment failed: ${error?.message||error}`);}catch{}}

  async function renderPage(page,options={}){
    const app=runtime.app;page=text(page);
    if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
    if(options.persist!==false)claimRoute(app,page);
    const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
    if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
    const rows=await buildRows(app);
    let html='';
    if(page==='company-overview')html=CompanyUI.renderOverview(CompanyUI.buildOverviewModel(rows,await getVacancies(app)));
    else if(page==='company-today'){
      const config=await getConfig(app),now=Date.now();
      const opportunityRows=OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
      const opportunities=Object.fromEntries(opportunityRows.map(row=>[row.userId,row.opportunity.score]));
      html=CompanyUI.renderToday(CompanyUI.buildTodayModel(rows,{now,stageThresholds:config.stageThresholds||{},opportunities}));
    }
    else if(page==='company-candidates'){const filtered=filterRows(rows,runtime.searchFilters);const sorted=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));html=CompanyUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length});}
    else if(page==='company-pipeline')html=CompanyUI.renderPipeline(CompanyUI.buildPipelineModel(rows));
    else if(page==='company-vacancies')html=CompanyUI.renderVacanciesPage({config:await getConfig(app),vacancies:await getVacancies(app),rows});
    else if(page==='company-followups')html=CompanyUI.renderFollowUpsPage(rows,{now:Date.now()});
    else if(page==='company-contact-outcomes')html=CompanyUI.renderContactOutcomesPage(rows);
    else if(page==='company-stage-aging'){const config=await getConfig(app);html=CompanyUI.renderStageAgingPage(rows.map(row=>({...row,aging:Operations.stageAging(row.companyRecord,config.stageThresholds||{},Date.now())})));}
    else if(page==='company-timeline')html=CompanyUI.renderTimelinePage(rows);
    else if(page==='company-campaigns')html=WorkflowUI.renderCampaignsPage({campaigns:await getCampaigns(app),rows,vacancies:await getVacancies(app)});
    else if(page==='company-talent-pool')html=WorkflowUI.renderTalentPoolPage(rows);
    else if(page==='company-reactivation')html=WorkflowUI.renderReactivationPage(rows);
    else if(page==='company-recruitment-sessions')html=WorkflowUI.renderRecruitmentSessionsPage({sessions:await getSessions(app),rows});
    else if(page==='company-opportunity')html=OpportunityUI.renderOpportunityPage(await buildOpportunityRows(app,rows,Date.now()));
    else if(page==='company-compare')html=OpportunityUI.renderComparePage(rows,[...runtime.compareSelection]);
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls(page);if(options.persist!==false)await persistRoute(app,page);return true;
  }

  function bindNav(){if(!runtime.app)return;document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};});}
  function syncNavigation(){bindNav();return true;}
  function install(app,options={}){if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');uninstall();runtime.app=app;runtime.installed=true;bindNav();const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);return true;}
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.compareSelection.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({COMPANY_ROUTES,isCompanyRoute,routeMeta,install,uninstall,renderPage,syncNavigation,_test:{buildRows,buildOpportunityRows,persistRoute,dbGetAll,dbGet,dbPut,dbDelete,evaluateCandidateVacancies,canMoveToStage,readCriteria,getCampaigns,getSessions,opportunityWeights,filterRows,sortRows,toggleSort,organizationInfo,IMPLEMENTED_ROUTES}});
});

/* bundled runtime: v47-faction-core.js */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const FACTION_STAGES=Object.freeze([
    'Prospect','Contacted','Replied','Evaluating','Invite Ready','Joined','Rejected','Deferred'
  ]);
  const PROFILE_STATES=Object.freeze(['Draft','Active','Paused','Archived']);
  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);
  const DAY_MS=86400000;

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,number(value)));}

  function normalizeKind(value){return text(value).toLowerCase()==='hard'?'Hard':'Preferred';}
  function normalizeRequirement(raw={},index=0){
    const field=text(raw.field);
    return {
      id:text(raw.id)||`${field||'criterion'}-${index+1}`,
      field,
      operator:text(raw.operator||'gte').toLowerCase(),
      value:raw.value,
      value2:raw.value2,
      kind:normalizeKind(raw.kind),
      label:text(raw.label)||field||`Criterion ${index+1}`,
      weight:Math.max(0,number(raw.weight,1))
    };
  }

  function normalizeBaseline(config={}){
    return {
      criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),
      updatedAt:number(config.updatedAt,0)
    };
  }

  function normalizeSpecialistProfile(raw={}){
    const statusRaw=text(raw.status).toLowerCase();
    const status=PROFILE_STATES.find(value=>value.toLowerCase()===statusRaw)||'Draft';
    return {
      profileId:text(raw.profileId??raw.id),
      name:text(raw.name),
      status,
      criteria:(Array.isArray(raw.criteria)?raw.criteria:[]).map(normalizeRequirement),
      notes:text(raw.notes),
      version:Math.max(1,Math.floor(number(raw.version,1))),
      createdAt:number(raw.createdAt,0),
      updatedAt:number(raw.updatedAt,0)
    };
  }

  function compare(operator,actual,value,value2){
    if(actual===undefined||actual===null||actual==='')return {known:false,passed:false};
    const op=text(operator).toLowerCase();
    if(op==='gte'||op==='gt'||op==='lte'||op==='lt'){
      const a=Number(actual),b=Number(value);
      if(!Number.isFinite(a)||!Number.isFinite(b))return {known:false,passed:false};
      if(op==='gte')return {known:true,passed:a>=b};
      if(op==='gt')return {known:true,passed:a>b};
      if(op==='lte')return {known:true,passed:a<=b};
      return {known:true,passed:a<b};
    }
    if(op==='between'){
      const a=Number(actual),lo=Number(value),hi=Number(value2);
      if(![a,lo,hi].every(Number.isFinite))return {known:false,passed:false};
      return {known:true,passed:a>=Math.min(lo,hi)&&a<=Math.max(lo,hi)};
    }
    if(op==='contains')return {known:true,passed:text(actual).toLowerCase().includes(text(value).toLowerCase())};
    if(op==='oneof'){
      const allowed=(Array.isArray(value)?value:[value]).map(item=>text(item).toLowerCase());
      return {known:true,passed:allowed.includes(text(actual).toLowerCase())};
    }
    return {known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
  }

  function waiverFor(requirementId,waivers=[],scope={}){
    const wantedContext=text(scope.context||'baseline').toLowerCase();
    const wantedProfile=text(scope.profileId);
    return (Array.isArray(waivers)?waivers:[]).find(waiver=>{
      if(text(waiver.requirementId)!==text(requirementId))return false;
      if(!['active','review due'].includes(text(waiver.state).toLowerCase()))return false;
      const waiverContext=text(waiver.context||'baseline').toLowerCase();
      if(waiverContext!==wantedContext)return false;
      if(wantedContext==='specialist')return text(waiver.profileId)===wantedProfile;
      return !text(waiver.profileId);
    })||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[],scope={context:'baseline'}){
    const normalized=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement);
    const results=normalized.map(req=>{
      const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);
      const waiver=req.kind==='Hard'&&!verdict.passed?waiverFor(req.id,waivers,scope):null;
      return {
        ...req,
        known:verdict.known,
        passed:verdict.passed,
        waived:Boolean(waiver),
        waiver,
        effectivePass:verdict.passed||Boolean(waiver)
      };
    });
    const hardFailures=results.filter(result=>result.kind==='Hard'&&!result.passed);
    const unwaivedHardFailures=hardFailures.filter(result=>!result.waived);
    const failures=results.filter(result=>!result.passed);
    const known=results.filter(result=>result.known);
    const totalWeight=known.reduce((sum,result)=>sum+(result.weight||1),0);
    const earned=known.filter(result=>result.passed).reduce((sum,result)=>sum+(result.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):0;
    const hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':'Eligible';
    return {results,failures,hardFailures,unwaivedHardFailures,hardFailed,eligibility,score};
  }

  function ratioScore(req,facts){
    const actual=Number(facts?.[req.field]);
    const target=Number(req.value);
    if(!Number.isFinite(actual)||!Number.isFinite(target))return null;
    if(['gte','gt'].includes(req.operator))return target<=0?100:clamp(actual/target*100);
    if(['lte','lt'].includes(req.operator))return actual<=target?100:(actual<=0?0:clamp(target/actual*100));
    return compare(req.operator,facts?.[req.field],req.value,req.value2).passed?100:0;
  }

  function evaluateSpecialistProfile(rawProfile,facts={},waivers=[]){
    const profile=normalizeSpecialistProfile(rawProfile);
    const criteria=evaluateCriteria(profile.criteria,facts,waivers,{context:'specialist',profileId:profile.profileId});
    const measured=profile.criteria.map(req=>({req,score:ratioScore(req,facts)})).filter(row=>row.score!==null);
    const totalWeight=measured.reduce((sum,row)=>sum+(row.req.weight||1),0);
    const raw=totalWeight?measured.reduce((sum,row)=>sum+row.score*(row.req.weight||1),0)/totalWeight:0;
    const matchScore=Math.round(clamp(raw));
    return {
      profileId:profile.profileId,
      matchScore,
      eligible:!criteria.hardFailed,
      hardFailed:criteria.hardFailed,
      eligibility:criteria.hardFailed?'NOT ELIGIBLE':criteria.hardFailures.length?'Eligible by Waiver':'Eligible',
      criteria
    };
  }

  function suggestSpecialistProfile(profiles=[],evaluations=[],pinnedProfileId=''){
    const activeIds=new Set((Array.isArray(profiles)?profiles:[])
      .map(normalizeSpecialistProfile)
      .filter(profile=>profile.status==='Active')
      .map(profile=>profile.profileId));
    const eligible=(Array.isArray(evaluations)?evaluations:[])
      .filter(evaluation=>evaluation&&evaluation.eligible===true&&activeIds.has(text(evaluation.profileId)))
      .sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.profileId).localeCompare(text(b.profileId)));
    const suggestedProfileId=text(eligible[0]?.profileId);
    const pinned=text(pinnedProfileId);
    return {
      suggestedProfileId,
      pinnedProfileId:pinned,
      bestChanged:Boolean(pinned&&suggestedProfileId&&pinned!==suggestedProfileId)
    };
  }

  function opportunityComponent(label,value,weight){
    const normalized=clamp(value);
    const w=Math.max(0,number(weight));
    return {label,value:normalized,weight:w,contribution:Math.round(normalized*w)/100};
  }

  function computeOpportunity(input={},weights={}){
    const availability=text(input.availability).toLowerCase()==='available'?100:text(input.availability).toLowerCase()==='unavailable'?0:50;
    const age=Math.max(0,number(input.lastActiveAgeHours,999));
    const activity=age<=6?100:age<=24?80:age<=72?55:age<=168?30:10;
    const freshMap={fresh:100,aging:70,stale:40,'very stale':15};
    const freshness=freshMap[text(input.intelligenceFreshness).toLowerCase()]??50;
    const rows=[
      opportunityComponent('Match',input.match,weights.match),
      opportunityComponent('Fit',input.fit,weights.fit),
      opportunityComponent('Availability',availability,weights.availability),
      opportunityComponent('Activity',activity,weights.activity),
      opportunityComponent('Freshness',freshness,weights.freshness),
      opportunityComponent('Follow-up',input.followUpDue?100:0,weights.followUp),
      {label:'Contact penalty',value:clamp(input.contactPenalty),weight:Math.max(0,number(weights.contactPenalty)),contribution:0}
    ];
    const rawScore=Math.round(rows.reduce((sum,row)=>sum+row.contribution,0)*100)/100;
    const penalty=Math.round(clamp(input.contactPenalty)*Math.max(0,number(weights.contactPenalty)))/100;
    const score=Math.round(clamp(rawScore-penalty));
    const explanation=rows.slice(0,6)
      .map(row=>`${row.label}: ${row.value} × ${row.weight}% = ${row.contribution}`)
      .join('; ')+(penalty?`; Contact penalty: -${penalty}`:'');
    return {score,rawScore,penalty,breakdown:rows,explanation};
  }

  function stageAgeStatus(record={},thresholds={},now=Date.now()){
    const changed=number(record.stageChangedAt??record.updatedAt,now);
    const daysInStage=Math.max(0,Math.floor((number(now)-changed)/DAY_MS));
    const threshold=Math.max(0,number(thresholds?.[record.pipelineStage],0));
    return {
      pipelineStage:text(record.pipelineStage),
      daysInStage,
      thresholdDays:threshold,
      stale:threshold>0&&daysInStage>=threshold
    };
  }

  function followUpTimestamp(followUp){
    if(Number.isFinite(Number(followUp?.dueAt)))return Number(followUp.dueAt);
    const raw=text(followUp?.date)+(text(followUp?.time)?`T${text(followUp.time)}`:'T23:59:59');
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed)?parsed:Infinity;
  }

  function buildTodayQueue(records=[],context={}){
    const now=number(context.now,Date.now());
    const opportunities=context.opportunities||{};
    const out=[];
    for(const record of Array.isArray(records)?records:[]){
      if(record?.archived===true)continue;
      const reasons=[];
      let priority=0;
      if(text(record.pipelineStage)==='Replied'){
        reasons.push('Reply waiting');
        priority=Math.max(priority,100);
      }
      const overdue=(Array.isArray(record.followUps)?record.followUps:[])
        .filter(followUp=>!['completed','cancelled'].includes(text(followUp.state).toLowerCase())&&followUpTimestamp(followUp)<now);
      if(overdue.length){
        reasons.push(`Overdue follow-up (${overdue.length})`);
        priority=Math.max(priority,85);
      }
      const aging=stageAgeStatus(record,context.stageThresholds||{},now);
      if(aging.stale){
        reasons.push('Stale stage');
        priority=Math.max(priority,75);
      }
      if(number(record.newlyEligibleAt,0)>0&&now-number(record.newlyEligibleAt)<=DAY_MS){
        reasons.push('Newly eligible');
        priority=Math.max(priority,70);
      }
      if(number(record.newlyDiscoveredAt,0)>0&&now-number(record.newlyDiscoveredAt)<=DAY_MS){
        reasons.push('Newly discovered');
        priority=Math.max(priority,60);
      }
      if(number(opportunities?.[record.userId],0)>=80){
        reasons.push('High opportunity');
        priority=Math.max(priority,55);
      }
      if(reasons.length)out.push({userId:text(record.userId),pipelineStage:text(record.pipelineStage),priority,reasons});
    }
    return out.sort((a,b)=>b.priority-a.priority||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    REQUIREMENT_KINDS,
    normalizeBaseline,
    normalizeSpecialistProfile,
    evaluateCriteria,
    evaluateSpecialistProfile,
    suggestSpecialistProfile,
    computeOpportunity,
    stageAgeStatus,
    buildTodayQueue
  });
});

/* bundled runtime: v47-faction-storage.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('RA_V47FactionCore is required.');

  const DB_VERSION=15;
  const STORE_DEFINITIONS=Object.freeze({
    factionSpecialistProfiles:Object.freeze({keyPath:'profileId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    factionCampaigns:Object.freeze({keyPath:'campaignId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'profileId',keyPath:'profileId'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])}),
    factionRecruitmentConfig:Object.freeze({keyPath:'key',indexes:Object.freeze([])}),
    factionRecruitmentSessions:Object.freeze({keyPath:'sessionId',indexes:Object.freeze([
      Object.freeze({name:'status',keyPath:'status'}),
      Object.freeze({name:'updatedAt',keyPath:'updatedAt'})
    ])})
  });

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function uniqueIds(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(value=>/^\d+$/.test(value)&&Number(value)>0))];}
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }

  function applyUpgrade(db){
    if(!db||!db.objectStoreNames||typeof db.createObjectStore!=='function')throw new Error('A compatible IndexedDB database is required.');
    for(const[storeName,definition]of Object.entries(STORE_DEFINITIONS)){
      if(db.objectStoreNames.contains(storeName))continue;
      const store=db.createObjectStore(storeName,{keyPath:definition.keyPath});
      for(const index of definition.indexes)store.createIndex(index.name,index.keyPath,{unique:false});
    }
  }

  function normalizeConfig(raw={}){
    const thresholds={};
    for(const[key,value]of Object.entries(raw.stageThresholds||{})){
      const days=Math.max(0,Math.floor(number(value,0)));
      if(days>0)thresholds[text(key)]=days;
    }
    const weights={};
    for(const[key,value]of Object.entries(raw.opportunityWeights||{}))weights[text(key)]=Math.max(0,number(value,0));
    return {
      key:'faction',
      baseline:FactionCore.normalizeBaseline(raw.baseline||{}),
      stageThresholds:thresholds,
      opportunityWeights:weights,
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function normalizeCampaign(raw={}){
    const createdAt=number(raw.createdAt,Date.now());
    return {
      campaignId:text(raw.campaignId||raw.id)||makeId('faction-campaign'),
      title:text(raw.title)||'Untitled Campaign',
      target:text(raw.target),
      startAt:raw.startAt??null,
      endAt:raw.endAt??null,
      profileId:text(raw.profileId),
      candidateIds:uniqueIds(raw.candidateIds),
      status:text(raw.status)||'Draft',
      metrics:{...(raw.metrics||{})},
      notes:text(raw.notes),
      createdAt,
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function normalizeSession(raw={}){
    const ids=uniqueIds(raw.candidateIds);
    return {
      sessionId:text(raw.sessionId||raw.id)||makeId('faction-session'),
      title:text(raw.title)||'Recruitment Session',
      candidateIds:ids,
      cursor:Math.max(0,Math.min(ids.length,Math.floor(number(raw.cursor,0)))),
      status:text(raw.status)||'Draft',
      outcomes:Array.isArray(raw.outcomes)?raw.outcomes.map(item=>({...item})):[],
      filters:{...(raw.filters||{})},
      startedAt:raw.startedAt??null,
      completedAt:raw.completedAt??null,
      createdAt:number(raw.createdAt,Date.now()),
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }

  function createRepositories(idb,core=FactionCore){
    if(!idb||!['get','getAll','put'].every(name=>typeof idb[name]==='function'))throw new Error('A compatible IndexedDB adapter is required.');

    const profiles={
      async save(raw){
        const next=core.normalizeSpecialistProfile({...raw,updatedAt:Date.now()});
        if(!next.profileId)throw new Error('Specialist profile ID is required.');
        await idb.put('factionSpecialistProfiles',next);
        return next;
      },
      async get(id){return idb.get('factionSpecialistProfiles',text(id));},
      async list(){
        return(await idb.getAll('factionSpecialistProfiles'))
          .map(core.normalizeSpecialistProfile)
          .sort((a,b)=>a.name.localeCompare(b.name)||a.profileId.localeCompare(b.profileId));
      },
      async listActive(){return(await profiles.list()).filter(profile=>profile.status==='Active');},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('factionSpecialistProfiles',text(id));}
    };

    const config={
      async get(){const existing=await idb.get('factionRecruitmentConfig','faction');return normalizeConfig(existing||{});},
      async save(raw){
        const existing=await config.get();
        const next=normalizeConfig({...existing,...raw,key:'faction',updatedAt:Date.now()});
        await idb.put('factionRecruitmentConfig',next);
        return next;
      }
    };

    const campaigns={
      async save(raw){const next=normalizeCampaign({...raw,updatedAt:Date.now()});await idb.put('factionCampaigns',next);return next;},
      async get(id){return idb.get('factionCampaigns',text(id));},
      async list(){return(await idb.getAll('factionCampaigns')).map(normalizeCampaign).sort((a,b)=>number(b.updatedAt)-number(a.updatedAt)||a.campaignId.localeCompare(b.campaignId));},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('factionCampaigns',text(id));}
    };

    const sessions={
      async save(raw){const next=normalizeSession({...raw,updatedAt:Date.now()});await idb.put('factionRecruitmentSessions',next);return next;},
      async get(id){return idb.get('factionRecruitmentSessions',text(id));},
      async list(){return(await idb.getAll('factionRecruitmentSessions')).map(normalizeSession).sort((a,b)=>number(b.updatedAt)-number(a.updatedAt)||a.sessionId.localeCompare(b.sessionId));},
      async remove(id){if(typeof idb.delete!=='function')throw new Error('Delete is unavailable.');return idb.delete('factionRecruitmentSessions',text(id));}
    };

    return Object.freeze({
      profiles:Object.freeze(profiles),
      config:Object.freeze(config),
      campaigns:Object.freeze(campaigns),
      sessions:Object.freeze(sessions)
    });
  }

  return Object.freeze({
    DB_VERSION,
    STORE_DEFINITIONS,
    applyUpgrade,
    normalizeConfig,
    normalizeCampaign,
    normalizeSession,
    createRepositories
  });
});

/* bundled runtime: v47-faction-ui.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const FACTION_STAGES=FactionCore.FACTION_STAGES;
  const TERMINAL_STAGES=new Set(['Joined','Rejected']);
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);
  const PROFILE_STATES=FactionCore.PROFILE_STATES;

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const score=value=>Number.isFinite(Number(value))?Number(value).toFixed(0):'—';
  const dateText=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toLocaleString():'—';};

  function normalizeStage(value){const raw=text(value).toLowerCase();return FACTION_STAGES.find(stage=>stage.toLowerCase()===raw)||'Prospect';}

  function buildCandidateRows(factionRecords=[],playerRecords=[],options={}){
    const players=new Map((Array.isArray(playerRecords)?playerRecords:[]).map(player=>[text(player?.userId),player]));
    const baseline=FactionCore.normalizeBaseline(options.baseline||{});
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const rows=[];
    for(const record of Array.isArray(factionRecords)?factionRecords:[]){
      if(!record||text(record.domain).toLowerCase()==='company')continue;
      const userId=text(record.userId);if(!userId)continue;
      const player=players.get(userId)||{userId};
      const waivers=Array.isArray(record.waivers)?record.waivers:[];
      const baselineEvaluation=FactionCore.evaluateCriteria(baseline.criteria,player,waivers,{context:'baseline'});
      const profileEvaluations=profiles.map(profile=>FactionCore.evaluateSpecialistProfile(profile,player,waivers));
      const suggestion=FactionCore.suggestSpecialistProfile(profiles,profileEvaluations,record.pinnedSpecialistProfileId||'');
      const evaluationMap=new Map(profileEvaluations.map(evaluation=>[text(evaluation.profileId),evaluation]));
      rows.push({
        userId,
        name:text(player.name)||`User ${userId}`,
        level:player.level??null,
        ee:player.ee??null,
        fit:player.fit??null,
        fitType:text(player.fitType),
        activity30:player.activity30??null,
        xanax30:player.xanax30??null,
        refills30:player.refills30??null,
        attacks30:player.attacks30??null,
        rwHits30:player.rwHits30??null,
        networth:player.networth??null,
        lastActive:player.lastActive??null,
        onlineStatus:text(player.onlineStatus),
        pipelineStage:normalizeStage(record.pipelineStage),
        availability:text(record.availability)||'Unknown',
        baselineEligibility:baselineEvaluation.eligibility,
        baselineScore:baselineEvaluation.score,
        hardFailed:baselineEvaluation.hardFailed===true,
        baselineEvaluation,
        pinnedSpecialistProfileId:text(record.pinnedSpecialistProfileId),
        specialistProfileId:text(record.specialistProfileId),
        suggestedProfileId:text(suggestion.suggestedProfileId),
        bestProfileChanged:suggestion.bestChanged===true,
        profileEvaluations,
        profileOptions:profiles.map(profile=>({
          profileId:profile.profileId,
          name:profile.name||profile.profileId,
          status:profile.status,
          matchScore:evaluationMap.get(profile.profileId)?.matchScore??null,
          eligible:evaluationMap.get(profile.profileId)?.eligible===true
        })),
        doNotContact:record.doNotContact===true,
        doNotContactReason:text(record.doNotContactReason),
        followUps:Array.isArray(record.followUps)?record.followUps.map(item=>({...item})):[],
        campaigns:Array.isArray(record.campaigns)?[...record.campaigns]:[],
        outcomes:Array.isArray(record.outcomes)?record.outcomes.map(item=>({...item})):[],
        waivers:Array.isArray(record.waivers)?record.waivers.map(item=>({...item})):[],
        tags:Array.isArray(record.tags)?[...record.tags]:[],
        archived:record.archived===true,
        stageChangedAt:record.stageChangedAt??record.updatedAt??null,
        newlyDiscoveredAt:record.newlyDiscoveredAt??null,
        newlyEligibleAt:record.newlyEligibleAt??null,
        createdAt:record.createdAt??null,
        updatedAt:record.updatedAt??null,
        factionRecord:record,
        player
      });
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function buildOverviewModel(rows=[],profiles=[]){
    const stageCounts=Object.fromEntries(FACTION_STAGES.map(stage=>[stage,0]));
    let activeCandidates=0,eligible=0,notCurrentlyEligible=0;
    for(const row of Array.isArray(rows)?rows:[]){
      const stage=normalizeStage(row.pipelineStage);stageCounts[stage]++;
      if(!row.archived&&!TERMINAL_STAGES.has(stage))activeCandidates++;
      if(['Eligible','Eligible by Waiver'].includes(text(row.baselineEligibility)))eligible++;
      if(text(row.baselineEligibility)==='NOT CURRENTLY ELIGIBLE')notCurrentlyEligible++;
    }
    return {
      totalCandidates:(Array.isArray(rows)?rows:[]).length,
      activeCandidates,
      eligible,
      notCurrentlyEligible,
      activeProfiles:(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).filter(profile=>profile.status==='Active').length,
      stageCounts
    };
  }

  function buildTodayModel(rows=[],context={}){
    const queue=FactionCore.buildTodayQueue(rows,context);
    const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    return queue.map(item=>{
      const row=byId.get(text(item.userId))||{};
      return {...item,name:text(row.name)||`User ${item.userId}`,baselineEligibility:text(row.baselineEligibility)||'Unknown',fit:row.fit??null,suggestedProfileId:text(row.suggestedProfileId),pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId)};
    });
  }

  function buildPipelineModel(rows=[]){
    const buckets=Object.fromEntries(FACTION_STAGES.map(stage=>[stage,[]]));
    for(const row of Array.isArray(rows)?rows:[]){if(!row||text(row.factionRecord?.domain).toLowerCase()==='company')continue;buckets[normalizeStage(row.pipelineStage)].push(row);}
    return buckets;
  }

  function kpi(label,value){return `<div class="ra-kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;}
  function stageOptions(selected){return FACTION_STAGES.map(stage=>`<option value="${esc(stage)}" ${stage===selected?'selected':''}>${esc(stage)}</option>`).join('');}

  function renderOverview(model={}){
    const counts=model.stageCounts||{};
    return `<div class="ra-kpis">${kpi('Active Candidates',number(model.activeCandidates))}${kpi('Baseline Eligible',number(model.eligible))}${kpi('Active Profiles',number(model.activeProfiles))}${kpi('Invite Ready',number(counts['Invite Ready']))}</div><section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Recruitment</h3><p>Faction-only workflow state over shared Player Intelligence.</p></div></div><div class="ra-detail-grid"><span>Not Currently Eligible<b>${number(model.notCurrentlyEligible)}</b></span><span>Replied<b>${number(counts.Replied)}</b></span><span>Evaluating<b>${number(counts.Evaluating)}</b></span><span>Joined<b>${number(counts.Joined)}</b></span></div><div class="ra-actions" style="margin-top:10px"><button class="ra-btn ra-primary" data-go-page="faction-today">Open Today</button><button class="ra-btn" data-go-page="faction-requirements">Requirements &amp; Profiles</button><button class="ra-btn" data-go-page="faction-candidates">Faction Candidates</button></div></section>`;
  }

  function renderToday(items=[]){
    const body=(Array.isArray(items)?items:[]).map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.pipelineStage)}</td><td>${esc((item.reasons||[]).join(' · '))}</td><td>${esc(item.baselineEligibility)}</td><td>${score(item.fit)}</td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Today</h3><p>Priority Faction recruitment work. Viewing never changes stage.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Why now</th><th>Baseline</th><th>Fit</th></tr></thead><tbody>${body||'<tr><td colspan="5">Nothing requires attention.</td></tr>'}</tbody></table></div></section>`;
  }

  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus);if(status.toLowerCase()==='online')return '<span class="ra-online-live">Online</span>';if(status.toLowerCase()==='idle')return '<span class="ra-online-idle">Idle</span>';if(status.toLowerCase()==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function sortHeader(key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-faction-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  function renderCandidates(rows=[],options={}){
    const filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'};const total=Number.isFinite(Number(options.total))?Number(options.total):(Array.isArray(rows)?rows:[]).length;
    const body=(Array.isArray(rows)?rows:[]).map(row=>{const message=row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-faction-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-faction-recruit="${esc(row.userId)}">Message</button>`;return `<tr data-context-id="${esc(row.userId)}"><td><a class="ra-link" href="https://www.torn.com/profiles.php?XID=${esc(row.userId)}" target="_blank" rel="noopener">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small></td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${lastOnlineHtml(row)}</td><td>${esc(row.currentOrganizationLabel||'Unknown')}</td><td>${message}</td></tr>`;}).join('');
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Search configured recruitment forums and Torn users, then filter the combined candidate intelligence.</p></div></div><div class="ra-formgrid ra-core-search-grid"><div class="ra-field"><label>Name / ID</label><input id="ra-faction-filter-search" value="${esc(filters.search||'')}" placeholder="Player name or ID"></div><div class="ra-field"><label>Status</label><select id="ra-faction-filter-status"><option value="">Any</option><option value="Online" ${text(filters.onlineStatus).toLowerCase()==='online'?'selected':''}>Online</option><option value="Idle" ${text(filters.onlineStatus).toLowerCase()==='idle'?'selected':''}>Idle</option><option value="Offline" ${text(filters.onlineStatus).toLowerCase()==='offline'?'selected':''}>Offline</option></select></div><div class="ra-field"><label>Current Faction</label><input id="ra-faction-filter-organization" value="${esc(filters.organization||'')}" placeholder="Faction name or ID"></div><div class="ra-field"><label>Faction Presence</label><select id="ra-faction-filter-organization-presence"><option value="any" ${!filters.organizationPresence||filters.organizationPresence==='any'?'selected':''}>Any</option><option value="none" ${filters.organizationPresence==='none'?'selected':''}>None</option><option value="has" ${filters.organizationPresence==='has'?'selected':''}>Has Faction</option></select></div><div class="ra-field"><label>END ≥</label><input id="ra-faction-filter-end" value="${esc(filters.minEnd||'')}" placeholder="e.g. 100k"></div><div class="ra-field"><label>MAN ≥</label><input id="ra-faction-filter-man" value="${esc(filters.minMan||'')}" placeholder="e.g. 50k"></div><div class="ra-field"><label>INT ≥</label><input id="ra-faction-filter-int" value="${esc(filters.minInt||'')}" placeholder="e.g. 50k"></div></div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-search-apply">Search</button><button type="button" class="ra-btn" id="ra-faction-search-clear">Clear</button></div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${(Array.isArray(rows)?rows:[]).length} matching of ${total} Faction candidate(s).</p></div></div><div class="ra-table-wrap"><table class="ra-table ra-core-results"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>Current Faction</th><th>Message</th></tr></thead><tbody>${body||'<tr><td colspan="7">No matching Faction candidates.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderPipeline(model={}){
    return `<div class="ra-pipeline">${FACTION_STAGES.map(stage=>`<section class="ra-stage" data-faction-stage="${esc(stage)}"><div class="ra-stage-head"><b>${esc(stage)}</b><span>${(model[stage]||[]).length}</span></div><div class="ra-stage-drop">${(model[stage]||[]).map(row=>`<article class="ra-stage-card" data-context-id="${esc(row.userId)}"><b>${esc(row.name)}</b><div>${esc(row.baselineEligibility)} · Fit ${score(row.fit)}</div><div>${esc(row.pinnedSpecialistProfileId||row.suggestedProfileId||'No specialist profile')}</div><select class="ra-btn" data-faction-stage-select="${esc(row.userId)}">${stageOptions(row.pipelineStage)}</select></article>`).join('')}</div></section>`).join('')}</div>`;
  }

  function renderCriterionRow(raw={},scope='baseline'){
    const req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||'level',operator:text(raw.operator)||'gte',kind:text(raw.kind)==='Hard'?'Hard':'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    return `<div class="ra-formgrid" data-faction-criterion-row data-faction-criterion-id="${esc(req.id)}" data-faction-criterion-scope="${esc(scope)}" style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input data-faction-criterion-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select data-faction-criterion-field="field">${CRITERION_FIELDS.map(field=>`<option value="${field}" ${field===req.field?'selected':''}>${field}</option>`).join('')}</select></div><div class="ra-field"><label>Operator</label><select data-faction-criterion-field="operator">${CRITERION_OPERATORS.map(op=>`<option value="${op}" ${op===req.operator?'selected':''}>${op}</option>`).join('')}</select></div><div class="ra-field"><label>Type</label><select data-faction-criterion-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind==='Preferred'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input data-faction-criterion-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input data-faction-criterion-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-faction-remove-criterion="${esc(scope)}">×</button></div>`;
  }


  function renderWaiverManagement({baseline={},profiles=[],rows=[]}={}){
    const normalizedBaseline=FactionCore.normalizeBaseline(baseline||{});
    const normalizedProfiles=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const candidateRows=Array.isArray(rows)?rows:[];
    const playerOptions=candidateRows.map(row=>'<option value="'+esc(row.userId)+'">'+esc(row.name||('User '+row.userId))+' · '+esc(row.userId)+' · '+esc(row.baselineEligibility||'Unknown')+'</option>').join('');
    const profileOptions=normalizedProfiles.map(profile=>'<option value="'+esc(profile.profileId)+'">'+esc(profile.name||profile.profileId)+'</option>').join('');
    const requirementOptions=[
      ...normalizedBaseline.criteria.map(req=>'<option value="'+esc(req.id)+'" data-waiver-context="baseline" data-waiver-profile="">Baseline · '+esc(req.label||req.id)+'</option>'),
      ...normalizedProfiles.flatMap(profile=>(profile.criteria||[]).map(req=>'<option value="'+esc(req.id)+'" data-waiver-context="specialist" data-waiver-profile="'+esc(profile.profileId)+'">Specialist · '+esc(profile.name||profile.profileId)+' · '+esc(req.label||req.id)+'</option>'))
    ].join('');
    const candidateStatus=candidateRows.map(row=>'<tr><td>'+esc(row.name||('User '+row.userId))+' <small class="ra-muted">'+esc(row.userId)+'</small></td><td>'+esc(row.baselineEligibility||'Unknown')+'</td><td>'+number((row.waivers||[]).filter(item=>text(item.state)==='Active').length)+'</td></tr>').join('');
    const history=candidateRows.flatMap(row=>(Array.isArray(row.waivers)?row.waivers:[]).map(waiver=>({row,waiver}))).sort((a,b)=>number(b.waiver.grantedAt)-number(a.waiver.grantedAt)).map(({row,waiver})=>{
      const context=text(waiver.context).toLowerCase()==='specialist'?'specialist':'baseline';
      const profile=context==='specialist'?normalizedProfiles.find(item=>text(item.profileId)===text(waiver.profileId)):null;
      const criteria=context==='specialist'?(profile?.criteria||[]):normalizedBaseline.criteria;
      const requirement=criteria.find(item=>text(item.id)===text(waiver.requirementId));
      const requirementLabel=text(requirement?.label)||text(waiver.requirementId)||'Unknown requirement';
      const contextLabel=context==='specialist'?('Specialist · '+(profile?.name||waiver.profileId||'Unknown profile')):'Baseline';
      const active=text(waiver.state)==='Active';
      const resolveButton=active?'<button type="button" class="ra-btn" data-faction-waiver-resolve="'+esc(waiver.waiverId)+'" data-faction-waiver-player="'+esc(row.userId)+'">Resolve</button>':'';
      return '<tr><td>'+esc(row.name||('User '+row.userId))+'</td><td>'+esc(requirementLabel)+'</td><td>'+esc(contextLabel)+'</td><td>'+esc(waiver.reason)+'</td><td>'+esc(waiver.state||'Unknown')+'</td><td>'+esc(dateText(waiver.reviewAt))+'</td><td>'+esc(waiver.resolvedReason||'')+'</td><td>'+resolveButton+'</td></tr>';
    }).join('');
    return '<section class="ra-panel"><div class="ra-panel-head"><div><h3>Waiver Management</h3><p>Grant an individual exception without changing the underlying Player Intelligence fact or requirement. Resolved waivers remain in history.</p></div></div>'+
      '<div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-faction-waiver-player"><option value="">Choose candidate</option>'+playerOptions+'</select></div>'+
      '<div class="ra-field"><label>Context</label><select id="ra-faction-waiver-context"><option value="baseline">Baseline</option><option value="specialist">Specialist</option></select></div>'+
      '<div class="ra-field"><label>Specialist Profile</label><select id="ra-faction-waiver-profile"><option value="">Choose profile</option>'+profileOptions+'</select></div>'+
      '<div class="ra-field"><label>Requirement</label><select id="ra-faction-waiver-requirement"><option value="">Choose requirement</option>'+requirementOptions+'</select></div>'+
      '<div class="ra-field"><label>Review</label><input id="ra-faction-waiver-review" type="datetime-local"></div>'+
      '<div class="ra-field" style="grid-column:1/-1"><label>Reason</label><textarea id="ra-faction-waiver-reason" placeholder="Why is this individual exception approved?"></textarea></div></div>'+
      '<div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-waiver-grant">Grant Waiver</button></div>'+
      '<div class="ra-table-wrap" style="margin-top:12px"><table class="ra-table"><thead><tr><th>Candidate</th><th>Baseline status</th><th>Active waivers</th></tr></thead><tbody>'+(candidateStatus||'<tr><td colspan="3">No Faction candidates.</td></tr>')+'</tbody></table></div>'+
      '<div class="ra-table-wrap" style="margin-top:12px"><table class="ra-table"><thead><tr><th>Candidate</th><th>Requirement</th><th>Context</th><th>Reason</th><th>State</th><th>Review</th><th>Resolution</th><th>Action</th></tr></thead><tbody>'+(history||'<tr><td colspan="8">No waiver history.</td></tr>')+'</tbody></table></div></section>';
  }

  function renderRequirementsPage({config={},profiles=[],rows=[]}={}){
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const profileCards=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).map(profile=>`<section class="ra-panel" data-faction-profile-card="${esc(profile.profileId)}"><div class="ra-panel-head"><div><h3>${esc(profile.name||profile.profileId||'Specialist Profile')}</h3><p>Specialist matching context. Hard failures affect this profile only.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input data-faction-profile-field="name" value="${esc(profile.name)}"></div><div class="ra-field"><label>Status</label><select data-faction-profile-field="status">${PROFILE_STATES.map(state=>`<option value="${state}" ${state===profile.status?'selected':''}>${state}</option>`).join('')}</select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-faction-profile-field="notes">${esc(profile.notes)}</textarea></div></div><div data-faction-profile-criteria>${profile.criteria.map(req=>renderCriterionRow(req,`profile:${profile.profileId}`)).join('')}</div><div class="ra-actions"><button class="ra-btn" data-faction-profile-add-criterion="${esc(profile.profileId)}">Add criterion</button><button class="ra-btn ra-primary" data-faction-profile-save="${esc(profile.profileId)}">Save Profile</button><button class="ra-btn ra-danger" data-faction-profile-delete="${esc(profile.profileId)}">Delete</button></div></section>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Baseline</h3><p>Hard requirements gate Invite Ready unless individually waived. Preferred requirements affect score only.</p></div></div><div id="ra-faction-baseline-criteria">${baseline.criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button class="ra-btn" id="ra-faction-baseline-add">Add Requirement</button><button class="ra-btn ra-primary" id="ra-faction-baseline-save">Save Faction Baseline</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>Specialist Profiles</h3><p>Draft, Active, Paused and Archived profiles are separate from Faction Baseline eligibility.</p></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-faction-profile-new">Create Specialist Profile</button></div></section>${profileCards||'<section class="ra-panel"><div class="ra-muted">No specialist profiles yet.</div></section>'}${renderWaiverManagement({baseline,profiles,rows})}`;
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    CRITERION_FIELDS,
    CRITERION_OPERATORS,
    buildCandidateRows,
    buildOverviewModel,
    buildTodayModel,
    buildPipelineModel,
    renderOverview,
    renderToday,
    renderCandidates,
    renderPipeline,
    renderCriterionRow,
    renderRequirementsPage,
    dateText
  });
});

/* bundled runtime: v47-faction-operations.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionOperations=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const UNIT_MS=Object.freeze({hours:3600000,days:86400000,weeks:604800000});
  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const makeId=(prefix,at)=>`${prefix}-${number(at,Date.now())}-${Math.random().toString(36).slice(2,8)}`;
  const cloneValue=value=>Array.isArray(value)?value.map(cloneValue):(value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,nested])=>[key,cloneValue(nested)])):value);
  const cloneRecord=record=>({
    ...(record||{}),
    followUps:cloneValue(record?.followUps||[]),
    outcomes:cloneValue(record?.outcomes||[]),
    timelineEvents:cloneValue(record?.timelineEvents||[]),
    timelineNotes:cloneValue(record?.timelineNotes||[]),
    waivers:cloneValue(record?.waivers||[]),
    campaigns:[...(record?.campaigns||[])],
    cycles:cloneValue(record?.cycles||[])
  });

  function normalizeRecurrence(raw){
    if(!raw)return null;
    const requested=text(raw.unit).toLowerCase();
    const unit=Object.hasOwn(UNIT_MS,requested)?requested:'days';
    return {unit,interval:Math.max(1,Math.floor(number(raw.interval,1)))};
  }

  function addSystemEvent(record,type,payload={},at=Date.now(),eventId=''){
    const next=cloneRecord(record);const when=number(at,Date.now());
    next.timelineEvents.push({eventId:text(eventId)||makeId('event',when),type:text(type)||'event',at:when,payload:cloneValue(payload||{})});
    next.updatedAt=when;
    return next;
  }

  function addFollowUp(record,raw={},at=Date.now()){
    const next=cloneRecord(record);const when=number(at,Date.now());
    const followUp={
      followUpId:text(raw.followUpId)||makeId('followup',when),
      dueAt:number(raw.dueAt,when),
      reason:text(raw.reason),
      note:text(raw.note),
      state:text(raw.state)||'open',
      recurrence:normalizeRecurrence(raw.recurrence),
      createdAt:raw.createdAt??when,
      completedAt:raw.completedAt??null,
      updatedAt:when
    };
    next.followUps.push(followUp);next.updatedAt=when;
    return addSystemEvent(next,'follow-up-added',{followUpId:followUp.followUpId,dueAt:followUp.dueAt,reason:followUp.reason},when);
  }

  function completeFollowUp(record,followUpId,at=Date.now()){
    const next=cloneRecord(record);const id=text(followUpId);const when=number(at,Date.now());
    const index=next.followUps.findIndex(item=>text(item.followUpId)===id);
    if(index<0)throw new Error('Follow-up not found.');
    const current={...next.followUps[index],state:'completed',completedAt:when,updatedAt:when};
    next.followUps[index]=current;
    if(current.recurrence){
      const recurrence=normalizeRecurrence(current.recurrence);
      const step=UNIT_MS[recurrence.unit]*recurrence.interval;
      next.followUps.push({
        ...current,
        recurrence,
        followUpId:makeId('followup',when),
        parentFollowUpId:id,
        dueAt:number(current.dueAt,when)+step,
        state:'open',
        completedAt:null,
        createdAt:when,
        updatedAt:when
      });
    }
    next.updatedAt=when;
    return addSystemEvent(next,'follow-up-completed',{followUpId:id},when);
  }

  function recordContactOutcome(record,raw={},at=Date.now()){
    const next=cloneRecord(record);const when=number(at,Date.now());
    const outcome={outcomeId:text(raw.outcomeId)||makeId('outcome',when),result:text(raw.result)||'Other',channel:text(raw.channel)||'Other',note:text(raw.note),at:raw.at??when};
    next.outcomes.push(outcome);next.updatedAt=when;
    return addSystemEvent(next,'contact-outcome',{outcomeId:outcome.outcomeId,result:outcome.result,channel:outcome.channel},when);
  }

  function setDoNotContact(record,enabled,reason='',at=Date.now()){
    const next=cloneRecord(record);const when=number(at,Date.now());
    next.doNotContact=enabled===true;
    next.doNotContactReason=next.doNotContact?text(reason):'';
    next.doNotContactChangedAt=when;
    next.updatedAt=when;
    return addSystemEvent(next,'dnc-changed',{enabled:next.doNotContact,reason:next.doNotContactReason},when);
  }

  function canMessage(record,explicitOverride=false){return !(record?.doNotContact===true&&explicitOverride!==true);}
  function stageAging(record,thresholds={},now=Date.now()){return FactionCore.stageAgeStatus(record,thresholds,now);}

  function addTimelineNote(record,raw={},at=Date.now()){
    const next=cloneRecord(record);const when=number(at,Date.now());
    next.timelineNotes.push({noteId:text(raw.noteId)||makeId('note',when),text:text(raw.text),at:raw.at??when,updatedAt:when});
    next.updatedAt=when;
    return next;
  }

  function editTimelineNote(record,noteId,value,at=Date.now()){
    const next=cloneRecord(record);const id=text(noteId);
    if(next.timelineEvents.some(event=>text(event.eventId)===id))throw new Error('System timeline events are immutable.');
    const index=next.timelineNotes.findIndex(note=>text(note.noteId)===id);
    if(index<0)throw new Error('Timeline note not found.');
    const when=number(at,Date.now());
    next.timelineNotes[index]={...next.timelineNotes[index],text:text(value),updatedAt:when};next.updatedAt=when;
    return next;
  }

  function deleteTimelineNote(record,noteId,at=Date.now()){
    const next=cloneRecord(record);const id=text(noteId);
    if(next.timelineEvents.some(event=>text(event.eventId)===id))throw new Error('System timeline events are immutable.');
    const before=next.timelineNotes.length;
    next.timelineNotes=next.timelineNotes.filter(note=>text(note.noteId)!==id);
    if(next.timelineNotes.length===before)throw new Error('Timeline note not found.');
    next.updatedAt=number(at,Date.now());
    return next;
  }

  function combinedTimeline(record={}){
    const system=(record.timelineEvents||[]).map(event=>({...cloneValue(event),entryType:'system',at:number(event.at,0)}));
    const notes=(record.timelineNotes||[]).map(note=>({...cloneValue(note),entryType:'recruiter-note',at:number(note.at,0)}));
    return [...system,...notes].sort((a,b)=>b.at-a.at||text(a.eventId||a.noteId).localeCompare(text(b.eventId||b.noteId)));
  }

  function grantWaiver(record,raw={},at=Date.now()){
    const next=cloneRecord(record);const when=number(at,Date.now());
    const requirementId=text(raw.requirementId);
    if(!requirementId)throw new Error('Requirement ID is required.');
    const context=text(raw.context).toLowerCase()==='specialist'?'specialist':'baseline';
    const profileId=context==='specialist'?text(raw.profileId):'';
    if(context==='specialist'&&!profileId)throw new Error('Specialist waiver requires a profile ID.');
    const waiver={
      waiverId:text(raw.waiverId)||makeId('waiver',when),
      requirementId,
      profileId,
      context,
      reason:text(raw.reason),
      state:'Active',
      grantedAt:when,
      reviewAt:raw.reviewAt==null?null:number(raw.reviewAt,null),
      resolvedAt:null,
      resolvedReason:''
    };
    next.waivers.push(waiver);next.updatedAt=when;
    return addSystemEvent(next,'waiver-granted',{waiverId:waiver.waiverId,requirementId,profileId,context},when);
  }

  function resolveWaiver(record,waiverId,reason='',at=Date.now()){
    const next=cloneRecord(record);const id=text(waiverId);const when=number(at,Date.now());
    const index=next.waivers.findIndex(waiver=>text(waiver.waiverId)===id);
    if(index<0)throw new Error('Waiver not found.');
    next.waivers[index]={...next.waivers[index],state:'Resolved',resolvedAt:when,resolvedReason:text(reason)};
    next.updatedAt=when;
    return addSystemEvent(next,'waiver-resolved',{waiverId:id,reason:text(reason)},when);
  }

  return Object.freeze({
    normalizeRecurrence,
    addSystemEvent,
    addFollowUp,
    completeFollowUp,
    recordContactOutcome,
    setDoNotContact,
    canMessage,
    stageAging,
    addTimelineNote,
    editTimelineNote,
    deleteTimelineNote,
    combinedTimeline,
    grantWaiver,
    resolveWaiver
  });
});

/* bundled runtime: v47-faction-workflow.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  let Operations=root&&root.RA_V47FactionOperations;
  if(typeof module==='object'&&module.exports){
    if(!FactionCore)FactionCore=require('./v47-faction-core');
    if(!Operations)Operations=require('./v47-faction-operations');
  }
  const api=factory(FactionCore,Operations);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionWorkflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore,Operations){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');
  if(!Operations)throw new Error('Faction Operations is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const cloneValue=value=>Array.isArray(value)?value.map(cloneValue):(value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,nested])=>[key,cloneValue(nested)])):value);
  const clone=record=>({
    ...(record||{}),
    campaigns:unique(record?.campaigns),
    cycles:cloneValue(record?.cycles||[]),
    timelineEvents:cloneValue(record?.timelineEvents||[]),
    timelineNotes:cloneValue(record?.timelineNotes||[]),
    followUps:cloneValue(record?.followUps||[]),
    outcomes:cloneValue(record?.outcomes||[]),
    waivers:cloneValue(record?.waivers||[])
  });
  const sessionClone=session=>({...session,candidateIds:unique(session?.candidateIds),outcomes:cloneValue(session?.outcomes||[]),filters:cloneValue(session?.filters||{})});
  const makeId=(prefix,at)=>`${prefix}-${number(at,Date.now())}-${Math.random().toString(36).slice(2,8)}`;

  function assertStage(stage){
    const normalized=text(stage);
    if(!FactionCore.FACTION_STAGES.includes(normalized))throw new Error(`Invalid Faction stage: ${normalized||'(empty)'}.`);
    return normalized;
  }

  function changeStage(record,stage,options={}){
    const after=assertStage(stage);
    if(after==='Invite Ready'&&options.baselineHardFailed===true)throw new Error('Invite Ready is blocked by an unwaived Faction baseline Hard requirement.');
    const before=text(record?.pipelineStage)||'Prospect';
    if(before===after)return clone(record);
    const when=number(options.now,Date.now());
    let next=clone(record);next.pipelineStage=after;next.stageChangedAt=when;next.updatedAt=when;
    return Operations.addSystemEvent(next,'stage-changed',{from:before,to:after},when);
  }

  function addCampaignMembership(record,campaignId,at=Date.now()){
    const id=text(campaignId);if(!id)throw new Error('Campaign ID is required.');
    let next=clone(record);const when=number(at,Date.now());
    next.campaigns=unique([...next.campaigns,id]);next.updatedAt=when;
    return Operations.addSystemEvent(next,'campaign-membership-added',{campaignId:id},when);
  }

  function removeCampaignMembership(record,campaignId,at=Date.now()){
    const id=text(campaignId);if(!id)throw new Error('Campaign ID is required.');
    let next=clone(record);const when=number(at,Date.now());
    next.campaigns=next.campaigns.filter(value=>value!==id);next.updatedAt=when;
    return Operations.addSystemEvent(next,'campaign-membership-removed',{campaignId:id},when);
  }

  function reactivate(record,reason='',at=Date.now(),cycleId=''){
    let next=clone(record);const when=number(at,Date.now());const previousStage=text(next.pipelineStage)||'Prospect';
    next.cycles.push({cycleId:text(cycleId)||makeId('cycle',when),startedAt:when,reason:text(reason),previousStage});
    next.pipelineStage='Prospect';next.stageChangedAt=when;next.archived=false;next.updatedAt=when;
    return Operations.addSystemEvent(next,'reactivated',{reason:text(reason),previousStage,cycleId:next.cycles.at(-1).cycleId},when);
  }

  function currentSessionCandidate(session={}){
    const ids=unique(session.candidateIds);const cursor=Math.max(0,Math.floor(number(session.cursor,0)));return ids[cursor]||'';
  }

  function recordSessionAction(session,raw={},at=Date.now()){
    const next=sessionClone(session);const when=number(at,Date.now());const current=currentSessionCandidate(next);const userId=text(raw.userId);const action=text(raw.action);
    if(!current)throw new Error('Recruitment session has no current candidate.');
    if(userId!==current)throw new Error('Action must target the current session candidate.');
    if(!action)throw new Error('An explicit session action is required.');
    next.outcomes.push({userId,action,note:text(raw.note),at:when});
    next.cursor=Math.min(next.candidateIds.length,Math.max(0,Math.floor(number(next.cursor,0)))+1);
    next.status=next.cursor>=next.candidateIds.length?'Completed':'Active';
    if(!next.startedAt)next.startedAt=when;
    if(next.status==='Completed')next.completedAt=when;
    next.updatedAt=when;
    return next;
  }

  return Object.freeze({
    changeStage,
    addCampaignMembership,
    removeCampaignMembership,
    reactivate,
    currentSessionCandidate,
    recordSessionAction,
    advanceSession:recordSessionAction
  });
});

/* bundled runtime: v47-faction-workflow-ui.js */
(function(root,factory){
  let Workflow=root&&root.RA_V47FactionWorkflow;
  if(!Workflow&&typeof module==='object'&&module.exports)Workflow=require('./v47-faction-workflow');
  const api=factory(Workflow);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionWorkflowUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Workflow){
  'use strict';
  if(!Workflow)throw new Error('Faction Workflow is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const terminal=new Set(['Joined','Rejected']);
  const dateText=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toLocaleString():'—';};
  const candidateOptions=(rows=[],selected='',filter=()=>true)=>rows.filter(filter).map(row=>`<option value="${esc(row.userId)}" ${text(row.userId)===text(selected)?'selected':''}>${esc(row.name)} [${esc(row.userId)}]</option>`).join('');
  const profileOptions=(profiles=[],selected='')=>`<option value="">No specialist profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${text(profile.profileId)===text(selected)?'selected':''}>${esc(profile.name||profile.profileId)}</option>`).join('');
  const rowMap=rows=>new Map((rows||[]).map(row=>[text(row.userId),row]));

  function renderCampaignsPage({campaigns=[],rows=[],profiles=[]}={}){
    const players=rowMap(rows);
    const cards=(campaigns||[]).map(campaign=>{
      const ids=unique(campaign.candidateIds);const members=ids.map(id=>players.get(id)).filter(Boolean);const available=rows.filter(row=>!ids.includes(text(row.userId)));
      return `<section class="ra-panel" data-faction-campaign-card="${esc(campaign.campaignId)}"><div class="ra-panel-head"><div><h3>${esc(campaign.title||'Untitled Campaign')}</h3><p>${esc(campaign.target||'No target specified')} · ${esc(campaign.status||'Draft')}</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input data-faction-campaign-field="title" value="${esc(campaign.title)}"></div><div class="ra-field"><label>Target</label><input data-faction-campaign-field="target" value="${esc(campaign.target)}"></div><div class="ra-field"><label>Specialist Profile</label><select data-faction-campaign-field="profileId">${profileOptions(profiles,campaign.profileId)}</select></div><div class="ra-field"><label>Status</label><select data-faction-campaign-field="status"><option ${campaign.status==='Draft'?'selected':''}>Draft</option><option ${campaign.status==='Active'?'selected':''}>Active</option><option ${campaign.status==='Paused'?'selected':''}>Paused</option><option ${campaign.status==='Completed'?'selected':''}>Completed</option><option ${campaign.status==='Archived'?'selected':''}>Archived</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-faction-campaign-field="notes">${esc(campaign.notes)}</textarea></div></div><div class="ra-actions"><button class="ra-btn ra-primary" data-faction-campaign-save="${esc(campaign.campaignId)}">Save Campaign</button><button class="ra-btn ra-danger" data-faction-campaign-delete="${esc(campaign.campaignId)}">Delete</button></div><h4>Members</h4><div>${members.map(row=>`<div class="ra-actions" style="justify-content:space-between;margin:4px 0"><span>${esc(row.name)} <span class="ra-muted">[${esc(row.userId)}]</span></span><button class="ra-btn ra-danger" data-faction-campaign-remove-member="${esc(campaign.campaignId)}" data-faction-campaign-user="${esc(row.userId)}">Remove</button></div>`).join('')||'<div class="ra-muted">No members.</div>'}</div><div class="ra-actions" style="margin-top:8px"><select class="ra-btn" data-faction-campaign-member-select="${esc(campaign.campaignId)}"><option value="">Add candidate…</option>${candidateOptions(available)}</select><button class="ra-btn" data-faction-campaign-add-member="${esc(campaign.campaignId)}">Add Member</button></div></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Create Faction Campaign</h3><p>Campaign membership is many-to-many and may optionally target one specialist profile.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input id="ra-faction-campaign-title"></div><div class="ra-field"><label>Target</label><input id="ra-faction-campaign-target"></div><div class="ra-field"><label>Specialist Profile</label><select id="ra-faction-campaign-profile">${profileOptions(profiles)}</select></div><div class="ra-field"><label>Status</label><select id="ra-faction-campaign-status"><option>Draft</option><option>Active</option><option>Paused</option><option>Completed</option><option>Archived</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea id="ra-faction-campaign-notes"></textarea></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-faction-campaign-new">Create Campaign</button></div></section>${cards||'<section class="ra-panel"><div class="ra-muted">No Faction campaigns yet.</div></section>'}`;
  }

  function renderFollowUpsPage(rows=[]){
    const pending=[];
    for(const row of rows||[])for(const item of row.followUps||[])if(!['completed','cancelled'].includes(text(item.state).toLowerCase()))pending.push({row,item});
    pending.sort((a,b)=>number(a.item.dueAt,Infinity)-number(b.item.dueAt,Infinity));
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Add Faction Follow-up</h3><p>Follow-ups are workflow reminders, not stage changes.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-faction-followup-player"><option value="">Choose candidate…</option>${candidateOptions(rows)}</select></div><div class="ra-field"><label>Due</label><input id="ra-faction-followup-due" type="datetime-local"></div><div class="ra-field"><label>Reason</label><input id="ra-faction-followup-reason"></div><div class="ra-field"><label>Note</label><input id="ra-faction-followup-note"></div><div class="ra-field"><label>Recurrence</label><select id="ra-faction-followup-recurrence-unit"><option value="">None</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><div class="ra-field"><label>Every</label><input id="ra-faction-followup-recurrence-interval" type="number" min="1" value="1"></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-faction-followup-add">Add Follow-up</button></div></section><section class="ra-panel"><h3>Pending Follow-ups</h3>${pending.map(({row,item})=>`<div class="ra-actions" style="justify-content:space-between;margin:6px 0"><div><b>${esc(row.name)}</b> · ${esc(dateText(item.dueAt))}<div class="ra-note">${esc(item.reason||'No reason')}${item.note?` · ${esc(item.note)}`:''}</div></div><button class="ra-btn" data-faction-followup-complete="${esc(item.followUpId)}" data-faction-followup-user="${esc(row.userId)}">Complete</button></div>`).join('')||'<div class="ra-muted">No pending follow-ups.</div>'}</section>`;
  }

  function renderTimelinePage(rows=[]){
    const options=candidateOptions(rows);
    const panels=rows.map(row=>{
      const events=(row.factionRecord?.timelineEvents||[]).map(event=>`<div class="ra-panel" style="margin:6px 0"><b>System event</b> · ${esc(event.type)} · ${esc(dateText(event.at))}<div class="ra-note">${esc(JSON.stringify(event.payload||{}))}</div></div>`).join('');
      const notes=(row.factionRecord?.timelineNotes||[]).map(note=>`<div class="ra-panel" style="margin:6px 0"><b>Recruiter note</b> · ${esc(dateText(note.at))}<div class="ra-note">${esc(note.text)}</div><div class="ra-actions"><button class="ra-btn" data-faction-note-edit="${esc(note.noteId)}" data-faction-note-user="${esc(row.userId)}">Edit</button><button class="ra-btn ra-danger" data-faction-note-delete="${esc(note.noteId)}" data-faction-note-user="${esc(row.userId)}">Delete</button></div></div>`).join('');
      return `<section class="ra-panel"><h3>${esc(row.name)}</h3>${events}${notes||(!events?'<div class="ra-muted">No timeline entries.</div>':'')}</section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Timeline</h3><p>System events are immutable. Recruiter notes may be edited or deleted.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-faction-timeline-player"><option value="">Choose candidate…</option>${options}</select></div><div class="ra-field"><label>Recruiter note</label><input id="ra-faction-timeline-note"></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-faction-timeline-add">Add Recruiter Note</button></div></section>${panels}`;
  }

  function renderContactOutcomesPage(rows=[]){
    const outcomeRows=[];
    for(const row of rows||[])for(const outcome of row.outcomes||[])outcomeRows.push({row,outcome});
    const dncRows=rows.map(row=>{
      const enabled=row.doNotContact===true||row.factionRecord?.doNotContact===true;
      const reason=text(row.doNotContactReason||row.factionRecord?.doNotContactReason);
      return `<div class="ra-panel" style="margin:6px 0"><b>${esc(row.name)}</b> · ${enabled?'Do Not Contact':'Contact permitted'}<div class="ra-note">${esc(reason||'No DNC reason')}</div><div class="ra-actions"><input data-faction-dnc-reason="${esc(row.userId)}" value="${esc(reason)}" placeholder="Reason"><button class="ra-btn ${enabled?'':'ra-danger'}" data-faction-dnc-toggle="${esc(row.userId)}" data-faction-dnc-enabled="${enabled?'false':'true'}">${enabled?'Clear DNC':'Set Do Not Contact'}</button>${enabled?'<span class="ra-muted">Override messaging remains deliberate and manual.</span>':''}</div></div>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Contact Outcomes</h3><p>Contact result and Do Not Contact are independent from Faction pipeline stage.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-faction-outcome-player"><option value="">Choose candidate…</option>${candidateOptions(rows)}</select></div><div class="ra-field"><label>Result</label><select id="ra-faction-outcome-result"><option>Interested</option><option>Maybe later</option><option>Not interested</option><option>No response</option><option>Other</option></select></div><div class="ra-field"><label>Channel</label><select id="ra-faction-outcome-channel"><option>Mail</option><option>Chat</option><option>Forum</option><option>Other</option></select></div><div class="ra-field"><label>Note</label><input id="ra-faction-outcome-note"></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-faction-outcome-add">Record Outcome</button></div></section><section class="ra-panel"><h3>Do Not Contact</h3>${dncRows}</section><section class="ra-panel"><h3>Contact Outcomes</h3>${outcomeRows.map(({row,outcome})=>`<div>${esc(row.name)} · ${esc(outcome.result)} · ${esc(outcome.channel)} · ${esc(dateText(outcome.at))}</div>`).join('')||'<div class="ra-muted">No outcomes recorded.</div>'}</section>`;
  }

  function renderStageAgingPage(rows=[]){
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Stage Aging</h3><p>Warning-only review. Aging never moves a candidate automatically.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Age</th><th>Threshold</th><th>Status</th></tr></thead><tbody>${rows.map(row=>{const a=row.stageAging||{};return`<tr><td>${esc(row.name)}</td><td>${esc(row.pipelineStage)}</td><td>${number(a.daysInStage)} days</td><td>${number(a.thresholdDays)} days</td><td>${a.stale?'Stale':'Within threshold'}</td></tr>`;}).join('')||'<tr><td colspan="5">No candidates.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderReactivationPage(rows=[]){
    const eligible=rows.filter(row=>row.archived===true||terminal.has(text(row.pipelineStage)));
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Reactivation</h3><p>Start a new Faction recruitment cycle without creating another player identity.</p></div></div>${eligible.map(row=>`<div class="ra-panel" style="margin:6px 0"><b>${esc(row.name)}</b> <span class="ra-muted">[${esc(row.userId)}] · ${esc(row.pipelineStage)}</span><div class="ra-formgrid" style="margin-top:6px"><div class="ra-field"><label>Reason</label><input data-faction-reactivate-reason="${esc(row.userId)}" placeholder="Why reopen this candidate?"></div><div class="ra-field"><label>Previous cycles</label><input disabled value="${number(row.factionRecord?.cycles?.length,0)}"></div></div><div class="ra-actions" style="margin-top:6px"><button class="ra-btn ra-primary" data-faction-reactivate-player="${esc(row.userId)}">Start New Cycle</button></div></div>`).join('')||'<div class="ra-muted">No candidates are currently eligible for reactivation.</div>'}</section>`;
  }

  function renderRecruitmentSessionsPage({sessions=[],rows=[]}={}){
    const players=rowMap(rows);const activeCandidates=rows.filter(row=>!row.archived&&!terminal.has(text(row.pipelineStage)));
    const cards=(sessions||[]).map(session=>{
      const currentId=Workflow.currentSessionCandidate(session);const current=players.get(text(currentId));const progress=`${Math.min(number(session.cursor,0),unique(session.candidateIds).length)}/${unique(session.candidateIds).length}`;
      return `<section class="ra-panel" data-faction-session-card="${esc(session.sessionId)}"><div class="ra-panel-head"><div><h3>${esc(session.title||'Recruitment Session')}</h3><p>${esc(session.status||'Draft')} · ${esc(progress)}</p></div></div>${current?`<div class="ra-kpi"><span>Current candidate</span><b>${esc(current.name)}</b><div class="ra-note">${esc(current.userId)} · ${esc(current.pipelineStage)}</div></div><div class="ra-field" style="margin-top:8px"><label>Action note</label><input data-faction-session-note="${esc(session.sessionId)}"></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" data-faction-session-action="${esc(session.sessionId)}" data-faction-session-user="${esc(current.userId)}" value="Contacted">Contacted</button><button class="ra-btn" data-faction-session-action="${esc(session.sessionId)}" data-faction-session-user="${esc(current.userId)}" value="Evaluating">Evaluating</button><button class="ra-btn" data-faction-session-action="${esc(session.sessionId)}" data-faction-session-user="${esc(current.userId)}" value="Deferred">Deferred</button><button class="ra-btn" data-faction-session-action="${esc(session.sessionId)}" data-faction-session-user="${esc(current.userId)}" value="Skip">Skip</button></div>`:'<div class="ra-muted">No current candidate. Session is complete or empty.</div>'}<details style="margin-top:8px"><summary>Session history</summary>${(session.outcomes||[]).map(outcome=>`<div>${esc(outcome.userId)} · ${esc(outcome.action)}${outcome.note?` · ${esc(outcome.note)}`:''}</div>`).join('')||'<div class="ra-muted">No actions yet.</div>'}</details></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Create Faction Recruitment Session</h3><p>Sessions process a frozen Faction candidate queue one explicit action at a time.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Title</label><input id="ra-faction-session-title"></div><div class="ra-field"><label>Candidate source</label><select id="ra-faction-session-source"><option value="active">All active Faction candidates (${activeCandidates.length})</option></select></div></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn ra-primary" id="ra-faction-session-new">Create Session</button></div></section>${cards||'<section class="ra-panel"><div class="ra-muted">No recruitment sessions yet.</div></section>'}`;
  }

  return Object.freeze({
    renderCampaignsPage,
    renderFollowUpsPage,
    renderTimelinePage,
    renderContactOutcomesPage,
    renderStageAgingPage,
    renderReactivationPage,
    renderRecruitmentSessionsPage
  });
});

/* bundled runtime: v47-faction-opportunity-ui.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionOpportunityUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hours=(now,at)=>Math.max(0,(number(now)-number(at,0))/3600000);
  const metric=value=>Number.isFinite(Number(value))?Number(value).toLocaleString():'—';
  const score=value=>Number.isFinite(Number(value))?Math.round(Number(value)):'—';

  function freshness(lastScoutAt,now){
    if(!Number.isFinite(Number(lastScoutAt))||Number(lastScoutAt)<=0)return 'Very stale';
    const age=hours(now,lastScoutAt);
    if(age<=24)return 'Fresh';
    if(age<=72)return 'Aging';
    if(age<=168)return 'Stale';
    return 'Very stale';
  }

  function followUpDue(record={},now=Date.now()){
    return (Array.isArray(record.followUps)?record.followUps:[]).some(item=>{
      if(['completed','cancelled'].includes(text(item.state).toLowerCase()))return false;
      const due=Number(item.dueAt);
      return Number.isFinite(due)&&due<=Number(now);
    });
  }

  function profileName(row,profileId){
    const option=(Array.isArray(row?.profileOptions)?row.profileOptions:[]).find(item=>text(item.profileId)===text(profileId));
    return text(option?.name)||text(profileId);
  }

  function selectedMatch(row={}){
    const evaluations=Array.isArray(row.profileEvaluations)?row.profileEvaluations:[];
    const pinnedId=text(row.pinnedSpecialistProfileId);
    const pinned=pinnedId?evaluations.find(item=>text(item.profileId)===pinnedId&&item?.eligible===true):null;
    if(pinned){
      return {
        selectedMatchSource:'Pinned specialist',
        selectedProfileId:pinnedId,
        selectedProfileName:profileName(row,pinnedId),
        selectedMatchScore:number(pinned.matchScore,0),
        evaluation:pinned
      };
    }

    const suggestedId=text(row.suggestedProfileId);
    const suggested=suggestedId?evaluations.find(item=>text(item.profileId)===suggestedId&&item?.eligible===true):null;
    if(suggested){
      return {
        selectedMatchSource:'Suggested specialist',
        selectedProfileId:suggestedId,
        selectedProfileName:profileName(row,suggestedId),
        selectedMatchScore:number(suggested.matchScore,0),
        evaluation:suggested
      };
    }

    const best=[...evaluations]
      .filter(item=>item?.eligible===true)
      .sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.profileId).localeCompare(text(b.profileId)))[0]||null;
    if(best){
      const profileId=text(best.profileId);
      return {
        selectedMatchSource:'Suggested specialist',
        selectedProfileId:profileId,
        selectedProfileName:profileName(row,profileId),
        selectedMatchScore:number(best.matchScore,0),
        evaluation:best
      };
    }

    return {
      selectedMatchSource:'Faction Baseline',
      selectedProfileId:'',
      selectedProfileName:'',
      selectedMatchScore:number(row.baselineScore,0),
      evaluation:null
    };
  }

  function buildOpportunityRows(rows=[],options={}){
    const now=number(options.now,Date.now());
    const weights={...(options.weights||{})};
    return (Array.isArray(rows)?rows:[]).map(row=>{
      const chosen=selectedMatch(row);
      const factionRecord=row.factionRecord||{};
      const player=row.player||{};
      const input={
        match:chosen.selectedMatchScore,
        fit:number(row.fit,0),
        availability:text(row.availability),
        lastActiveAgeHours:Number.isFinite(Number(row.lastActive))?hours(now,row.lastActive):999,
        intelligenceFreshness:freshness(player.lastScoutAt,now),
        contactPenalty:row.doNotContact===true||factionRecord.doNotContact===true?100:0,
        followUpDue:followUpDue(factionRecord,now)
      };
      return {
        userId:text(row.userId),
        name:text(row.name)||`User ${text(row.userId)}`,
        pipelineStage:text(row.pipelineStage),
        baselineEligibility:text(row.baselineEligibility)||'Unknown',
        baselineScore:row.baselineScore??null,
        availability:text(row.availability)||'Unknown',
        fit:row.fit??null,
        ee:row.ee??null,
        level:row.level??null,
        selectedMatchSource:chosen.selectedMatchSource,
        selectedProfileId:chosen.selectedProfileId,
        selectedProfileName:chosen.selectedProfileName,
        selectedMatchScore:chosen.selectedMatchScore,
        opportunity:FactionCore.computeOpportunity(input,weights),
        intelligenceFreshness:input.intelligenceFreshness,
        doNotContact:row.doNotContact===true||factionRecord.doNotContact===true,
        pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId),
        suggestedProfileId:text(row.suggestedProfileId),
        profileEvaluations:Array.isArray(row.profileEvaluations)?row.profileEvaluations.map(item=>({...item})):[],
        profileOptions:Array.isArray(row.profileOptions)?row.profileOptions.map(item=>({...item})):[],
        factionRecord,
        player
      };
    }).sort((a,b)=>number(b.opportunity?.score)-number(a.opportunity?.score)||a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function renderBreakdown(opportunity={}){
    return (opportunity.breakdown||[]).map(item=>`<span>${esc(item.label)}: ${score(item.value)} × ${score(item.weight)}%${item.label==='Contact penalty'?'':` = ${esc(item.contribution)}`}</span>`).join('<br>');
  }

  function renderOpportunityPage(rows=[]){
    const body=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td><b>${esc(row.name)}</b><div class="ra-muted">${esc(row.userId)} · ${esc(row.pipelineStage)}</div></td><td><b>${score(row.opportunity?.score)}</b></td><td>${esc(row.selectedMatchSource)}${row.selectedProfileName?`<div class="ra-muted">${esc(row.selectedProfileName)} · Match ${score(row.selectedMatchScore)}%</div>`:`<div class="ra-muted">Baseline ${score(row.selectedMatchScore)}%</div>`}</td><td>${esc(row.baselineEligibility)}</td><td>${score(row.fit)}</td><td>${esc(row.intelligenceFreshness)}</td><td><details><summary>Breakdown</summary><div class="ra-note">${renderBreakdown(row.opportunity)}</div><div class="ra-muted">${esc(row.opportunity?.explanation)}</div></details></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Opportunity Queue</h3><p>Explainable local priority scoring. Specialist Match ranks work; it never changes Faction Baseline eligibility or pipeline stage.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Opportunity</th><th>Match Source</th><th>Faction Baseline</th><th>Fit</th><th>Freshness</th><th>Why</th></tr></thead><tbody>${body||'<tr><td colspan="7">No Faction opportunities.</td></tr>'}</tbody></table></div></section>`;
  }

  function buildCompareRows(rows=[],selectedIds=[]){
    const ids=[];
    for(const value of Array.isArray(selectedIds)?selectedIds:[]){
      const id=text(value);
      if(id&&!ids.includes(id))ids.push(id);
      if(ids.length>=4)break;
    }
    const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    return ids.map(id=>byId.get(id)).filter(Boolean).map(row=>({
      userId:text(row.userId),
      name:text(row.name)||`User ${text(row.userId)}`,
      pipelineStage:text(row.pipelineStage),
      baselineEligibility:text(row.baselineEligibility)||'Unknown',
      baselineScore:row.baselineScore??null,
      availability:text(row.availability)||'Unknown',
      fit:row.fit??null,
      ee:row.ee??null,
      level:row.level??null,
      activity30:row.activity30??null,
      xanax30:row.xanax30??null,
      refills30:row.refills30??null,
      attacks30:row.attacks30??null,
      rwHits30:row.rwHits30??null,
      networth:row.networth??null,
      lastActive:row.lastActive??null,
      doNotContact:row.doNotContact===true||row.factionRecord?.doNotContact===true,
      pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId),
      suggestedProfileId:text(row.suggestedProfileId),
      profileEvaluations:Array.isArray(row.profileEvaluations)?row.profileEvaluations.map(item=>({...item})):[],
      profileOptions:Array.isArray(row.profileOptions)?row.profileOptions.map(item=>({...item})):[]
    }));
  }

  function displayProfile(row={}){
    const chosen=selectedMatch(row);
    if(chosen.selectedProfileName)return `${chosen.selectedProfileName} (${score(chosen.selectedMatchScore)}%)`;
    return `Faction Baseline (${score(chosen.selectedMatchScore)}%)`;
  }

  function renderComparePage(rows=[],selectedIds=[]){
    const selected=new Set(buildCompareRows(rows,selectedIds).map(row=>row.userId));
    const choices=(Array.isArray(rows)?rows:[]).map(row=>`<label style="display:inline-flex;align-items:center;gap:5px;margin:4px 10px 4px 0"><input type="checkbox" data-faction-compare-select="${esc(row.userId)}" ${selected.has(text(row.userId))?'checked':''}> ${esc(row.name)} [${esc(row.userId)}]</label>`).join('');
    const picked=buildCompareRows(rows,selectedIds);
    const sourceById=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    const cards=picked.map(row=>{
      const source=sourceById.get(row.userId)||row;
      return `<section class="ra-panel" style="min-width:240px;flex:1"><h3>${esc(row.name)}</h3><div class="ra-detail-grid"><span>Player ID<b>${esc(row.userId)}</b></span><span>Stage<b>${esc(row.pipelineStage)}</b></span><span>Faction Baseline<b>${esc(row.baselineEligibility)} · ${score(row.baselineScore)}%</b></span><span>Availability<b>${esc(row.availability)}</b></span><span>Fit<b>${score(row.fit)}</b></span><span>EE<b>${metric(row.ee)}</b></span><span>Level<b>${metric(row.level)}</b></span><span>Activity 30d<b>${metric(row.activity30)}</b></span><span>RW Hits 30d<b>${metric(row.rwHits30)}</b></span><span>Attacks 30d<b>${metric(row.attacks30)}</b></span><span>Specialist Profile<b>${esc(displayProfile(source))}</b></span><span>Do Not Contact<b>${row.doNotContact?'Yes':'No'}</b></span></div></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Compare</h3><p>Select up to four Torn players to compare shared facts with Faction-specific recruitment results.</p></div></div><div>${choices||'<span class="ra-muted">No Faction players available.</span>'}</div></section><div style="display:flex;gap:10px;flex-wrap:wrap">${cards||'<section class="ra-panel"><div class="ra-muted">Select players above to compare them.</div></section>'}</div>`;
  }

  return Object.freeze({
    freshness,
    followUpDue,
    selectedMatch,
    buildOpportunityRows,
    renderOpportunityPage,
    buildCompareRows,
    renderComparePage
  });
});

/* bundled runtime: v47-faction-platform.js */
(function(root,factory){
  const deps={
    FactionCore:root&&root.RA_V47FactionCore,
    FactionUI:root&&root.RA_V47FactionUI,
    Operations:root&&root.RA_V47FactionOperations,
    Workflow:root&&root.RA_V47FactionWorkflow,
    WorkflowUI:root&&root.RA_V47FactionWorkflowUI,
    OpportunityUI:root&&root.RA_V47FactionOpportunityUI,
    Messaging:root&&root.RA_V45Messaging
  };
  if(typeof module==='object'&&module.exports){
    deps.FactionCore=require('./v47-faction-core');
    deps.FactionUI=require('./v47-faction-ui');
    deps.Operations=require('./v47-faction-operations');
    deps.Workflow=require('./v47-faction-workflow');
    deps.WorkflowUI=require('./v47-faction-workflow-ui');
    deps.OpportunityUI=require('./v47-faction-opportunity-ui');
    deps.Messaging=require('./v45-messaging');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {FactionCore,FactionUI,Operations,Workflow,WorkflowUI,OpportunityUI,Messaging}=D;
  if(!FactionCore||!FactionUI||!Operations||!Workflow||!WorkflowUI||!OpportunityUI||!Messaging)throw new Error('Faction platform dependencies are required.');

  const FACTION_ROUTES=Object.freeze([
    'faction-overview','faction-today','faction-discover','faction-candidates','faction-pipeline',
    'faction-requirements','faction-campaigns','faction-followups','faction-timeline','faction-stage-aging',
    'faction-contact-outcomes','faction-recruitment-sessions','faction-reactivation','faction-opportunity','faction-compare'
  ]);
  const IMPLEMENTED_ROUTES=new Set(FACTION_ROUTES);
  const META=Object.freeze({
    'faction-overview':['Faction Overview','Faction recruitment status and work needing attention.'],
    'faction-today':['Faction Today','Prioritized Faction recruitment work for today.'],
    'faction-discover':['Faction Discover','Add and review Faction recruitment prospects without creating Company workflow state.'],
    'faction-candidates':['Faction Candidates','Search and manage Faction recruitment candidates.'],
    'faction-pipeline':['Faction Pipeline','Move Faction candidates through explicit recruitment stages.'],
    'faction-requirements':['Faction Requirements','Manage Faction Baseline requirements and specialist profiles.'],
    'faction-campaigns':['Faction Campaigns','Organize Faction recruitment campaigns.'],
    'faction-followups':['Faction Follow-ups','Track Faction candidate follow-ups.'],
    'faction-timeline':['Faction Timeline','Review immutable Faction history and recruiter notes.'],
    'faction-stage-aging':['Faction Stage Aging','Review candidates aging in their current Faction stage.'],
    'faction-contact-outcomes':['Faction Contact Outcomes','Track contact outcomes and Do Not Contact independently of stage.'],
    'faction-recruitment-sessions':['Faction Recruitment Sessions','Work focused Faction recruitment queues one explicit action at a time.'],
    'faction-reactivation':['Faction Reactivation','Restart Faction recruitment cycles without duplicating identity.'],
    'faction-opportunity':['Faction Opportunity Queue','Review explainable Faction recruitment opportunities.'],
    'faction-compare':['Faction Compare','Compare Faction candidates side by side.']
  });
  const DEFAULT_OPPORTUNITY_WEIGHTS=Object.freeze({match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});
  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const SORT_KEYS=new Set(['player','end','man','int','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,compareSelection:new Set(),searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT}};

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.player||{};const name=text(row.factionName||player.factionName);const rawId=row.factionId??player.factionId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Faction #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(key==='end'||key==='man'||key==='int'){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const terminalStage=stage=>['Joined','Rejected'].includes(text(stage));

  function isFactionRoute(value){return FACTION_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['faction-overview'];return{title,description};}
  function opportunityWeights(config={}){return{...DEFAULT_OPPORTUNITY_WEIGHTS,...(config.opportunityWeights||{})};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}
  function dbDelete(db,store,key){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error(`Failed to delete from ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.factionRepositories?.config?.get)return app._test.factionRepositories.config.get();return(await dbGet(app._test.state.db,'factionRecruitmentConfig','faction'))||{key:'faction',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.factionRepositories?.config?.save)return app._test.factionRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'faction',updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentConfig',next);return next;}
  async function getProfiles(app){if(app?._test?.factionRepositories?.profiles?.list)return app._test.factionRepositories.profiles.list();return dbGetAll(app._test.state.db,'factionSpecialistProfiles');}
  async function saveProfile(app,profile){if(app?._test?.factionRepositories?.profiles?.save)return app._test.factionRepositories.profiles.save(profile);const next=FactionCore.normalizeSpecialistProfile({...profile,profileId:text(profile.profileId)||makeId('profile'),updatedAt:Date.now()});await dbPut(app._test.state.db,'factionSpecialistProfiles',next);return next;}
  async function removeProfile(app,profileId){if(app?._test?.factionRepositories?.profiles?.remove)return app._test.factionRepositories.profiles.remove(profileId);return dbDelete(app._test.state.db,'factionSpecialistProfiles',text(profileId));}
  async function getCampaigns(app){if(app?._test?.factionRepositories?.campaigns?.list)return app._test.factionRepositories.campaigns.list();return dbGetAll(app._test.state.db,'factionCampaigns');}
  async function getCampaign(app,campaignId){if(app?._test?.factionRepositories?.campaigns?.get)return app._test.factionRepositories.campaigns.get(campaignId);return dbGet(app._test.state.db,'factionCampaigns',text(campaignId));}
  async function saveCampaign(app,campaign){if(app?._test?.factionRepositories?.campaigns?.save)return app._test.factionRepositories.campaigns.save(campaign);const next={...campaign,campaignId:text(campaign.campaignId)||makeId('faction-campaign'),candidateIds:unique(campaign.candidateIds),updatedAt:Date.now()};await dbPut(app._test.state.db,'factionCampaigns',next);return next;}
  async function removeCampaign(app,campaignId){if(app?._test?.factionRepositories?.campaigns?.remove)return app._test.factionRepositories.campaigns.remove(campaignId);return dbDelete(app._test.state.db,'factionCampaigns',text(campaignId));}
  async function getSessions(app){if(app?._test?.factionRepositories?.sessions?.list)return app._test.factionRepositories.sessions.list();return dbGetAll(app._test.state.db,'factionRecruitmentSessions');}
  async function getSession(app,sessionId){if(app?._test?.factionRepositories?.sessions?.get)return app._test.factionRepositories.sessions.get(sessionId);return dbGet(app._test.state.db,'factionRecruitmentSessions',text(sessionId));}
  async function saveSession(app,session){if(app?._test?.factionRepositories?.sessions?.save)return app._test.factionRepositories.sessions.save(session);const next={...session,sessionId:text(session.sessionId)||makeId('faction-session'),candidateIds:unique(session.candidateIds),updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentSessions',next);return next;}

  async function saveFactionPatch(app,userId,patch){
    const id=text(userId);
    if(!/^\d+$/.test(id))throw new Error('A valid Torn player ID is required.');
    if(app?._test?.repositories?.faction?.ensure)return app._test.repositories.faction.ensure(id,patch,{source:'faction-platform',observedAt:Date.now()});
    const existing=await dbGet(app._test.state.db,'factionRecruitment',id);
    if(!existing)throw new Error('Faction candidate was not found.');
    const next={...existing,...patch,userId:id,domain:'faction',updatedAt:Date.now()};
    await dbPut(app._test.state.db,'factionRecruitment',next);
    return next;
  }

  async function ensureFactionCandidate(app,userId){
    const id=text(userId);
    if(!/^\d+$/.test(id)||Number(id)<=0)throw new Error('Enter a valid Torn player ID.');
    const existing=await dbGet(app._test.state.db,'factionRecruitment',id);
    const sources=unique([...(existing?.discoverySources||[]),'FACTION MANUAL']);
    if(app?._test?.repositories?.faction?.ensure)return app._test.repositories.faction.ensure(id,{pipelineStage:existing?.pipelineStage||'Prospect',discoverySources:sources,newlyDiscoveredAt:existing?.newlyDiscoveredAt||Date.now()},{source:'faction-manual',observedAt:Date.now()});
    const next={...(existing||{}),userId:id,domain:'faction',pipelineStage:existing?.pipelineStage||'Prospect',availability:existing?.availability||'Unknown',discoverySources:sources,newlyDiscoveredAt:existing?.newlyDiscoveredAt||Date.now(),createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
    await dbPut(app._test.state.db,'factionRecruitment',next);
    return next;
  }

  async function buildRows(app){
    const db=app._test.state.db;
    const[factionRecords,players,candidateLocals,config,profiles]=await Promise.all([dbGetAll(db,'factionRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getProfiles(app)]);
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return FactionUI.buildCandidateRows(factionRecords,players,{baseline:config.baseline||{},profiles}).map(row=>{const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.player||{};return{...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus)};});
  }

  async function buildOpportunityRows(app,rows,now=Date.now()){
    const config=await getConfig(app);
    return OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
  }

  async function persistRoute(app,page){
    const state=app?._test?.state;if(!state?.db)return false;
    state.page=page;state.settings=state.settings||{};state.settings.activePage=page;
    const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};
    meta.settings={...(meta.settings||{}),activePage:page};
    await dbPut(state.db,'meta',meta);
    return true;
  }

  function claimRoute(app,page){const state=app?._test?.state,route=text(page);if(!state||!IMPLEMENTED_ROUTES.has(route))return false;state.page=route;state.settings=state.settings||{};state.settings.activePage=route;return true;}
  function navigate(page,persist=true){const route=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(route))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(route,persist));claimRoute(runtime.app,route);return renderPage(route,{persist});}

  function readCriteria(host){
    if(!host)return[];
    return[...host.querySelectorAll('[data-faction-criterion-row]')].map((row,index)=>{
      const get=key=>row.querySelector(`[data-faction-criterion-field="${key}"]`)?.value??'';
      const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;
      return{id:text(row.dataset.factionCriterionId)||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};
    });
  }

  async function rowFor(userId){const rows=await buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error('Faction candidate was not found.');return row;}
  async function saveOperationalRecord(userId,next){await saveFactionPatch(runtime.app,userId,next);return next;}

  async function changeFactionStage(userId,stage){
    const row=await rowFor(userId);
    const next=Workflow.changeStage(row.factionRecord,text(stage),{baselineHardFailed:row.hardFailed===true,now:Date.now()});
    return saveOperationalRecord(userId,next);
  }
  async function setProfilePin(userId,profileId){await saveFactionPatch(runtime.app,userId,{pinnedSpecialistProfileId:text(profileId),updatedAt:Date.now()});return true;}

  async function addFollowUpFromUi(){
    const userId=text(document.getElementById('ra-faction-followup-player')?.value);const row=await rowFor(userId);
    const dueAt=Date.parse(text(document.getElementById('ra-faction-followup-due')?.value));if(!Number.isFinite(dueAt))throw new Error('Choose a valid follow-up date and time.');
    const unit=text(document.getElementById('ra-faction-followup-recurrence-unit')?.value);const recurrence=unit?{unit,interval:Math.max(1,number(document.getElementById('ra-faction-followup-recurrence-interval')?.value,1))}:null;
    return saveOperationalRecord(userId,Operations.addFollowUp(row.factionRecord,{dueAt,reason:text(document.getElementById('ra-faction-followup-reason')?.value),note:text(document.getElementById('ra-faction-followup-note')?.value),recurrence},Date.now()));
  }
  async function completeFollowUp(userId,followUpId){const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.completeFollowUp(row.factionRecord,followUpId,Date.now()));}
  async function recordOutcomeFromUi(){const userId=text(document.getElementById('ra-faction-outcome-player')?.value);const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.recordContactOutcome(row.factionRecord,{result:text(document.getElementById('ra-faction-outcome-result')?.value),channel:text(document.getElementById('ra-faction-outcome-channel')?.value),note:text(document.getElementById('ra-faction-outcome-note')?.value)},Date.now()));}
  async function toggleDnc(userId,enabled){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-faction-dnc-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Operations.setDoNotContact(row.factionRecord,enabled,reason,Date.now()));}
  async function addTimelineNoteFromUi(){const userId=text(document.getElementById('ra-faction-timeline-player')?.value);const row=await rowFor(userId);const value=text(document.getElementById('ra-faction-timeline-note')?.value);if(!value)throw new Error('Timeline note cannot be empty.');return saveOperationalRecord(userId,Operations.addTimelineNote(row.factionRecord,{text:value},Date.now()));}
  async function editTimelineNote(userId,noteId){const row=await rowFor(userId);const current=(row.factionRecord.timelineNotes||[]).find(note=>text(note.noteId)===text(noteId));if(!current)throw new Error('Timeline note not found.');const value=globalThis.prompt?.('Edit recruiter note',text(current.text));if(value==null)return false;return saveOperationalRecord(userId,Operations.editTimelineNote(row.factionRecord,noteId,value,Date.now()));}
  async function deleteTimelineNote(userId,noteId){const row=await rowFor(userId);if(globalThis.confirm&&!globalThis.confirm('Delete this recruiter note?'))return false;return saveOperationalRecord(userId,Operations.deleteTimelineNote(row.factionRecord,noteId,Date.now()));}
  async function reactivatePlayer(userId){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-faction-reactivate-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Workflow.reactivate(row.factionRecord,reason,Date.now()));}

  async function createCampaignFromUi(){return saveCampaign(runtime.app,{campaignId:makeId('faction-campaign'),title:text(document.getElementById('ra-faction-campaign-title')?.value)||'Untitled Campaign',target:text(document.getElementById('ra-faction-campaign-target')?.value),profileId:text(document.getElementById('ra-faction-campaign-profile')?.value),status:text(document.getElementById('ra-faction-campaign-status')?.value)||'Draft',notes:text(document.getElementById('ra-faction-campaign-notes')?.value),candidateIds:[]});}
  async function saveCampaignFromCard(campaignId){const card=document.querySelector(`[data-faction-campaign-card="${campaignId}"]`);const existing=await getCampaign(runtime.app,campaignId);if(!existing||!card)throw new Error('Faction campaign was not found.');const get=field=>card.querySelector(`[data-faction-campaign-field="${field}"]`)?.value??'';return saveCampaign(runtime.app,{...existing,title:text(get('title')),target:text(get('target')),profileId:text(get('profileId')),status:text(get('status'))||'Draft',notes:text(get('notes'))});}
  async function addCampaignMember(campaignId){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Faction campaign was not found.');const userId=text(document.querySelector(`[data-faction-campaign-member-select="${campaignId}"]`)?.value);if(!userId)throw new Error('Choose a candidate first.');await saveCampaign(runtime.app,{...campaign,candidateIds:unique([...(campaign.candidateIds||[]),userId])});const row=await rowFor(userId);await saveOperationalRecord(userId,Workflow.addCampaignMembership(row.factionRecord,campaignId,Date.now()));}
  async function removeCampaignMember(campaignId,userId){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Faction campaign was not found.');await saveCampaign(runtime.app,{...campaign,candidateIds:(campaign.candidateIds||[]).filter(id=>text(id)!==text(userId))});const row=await rowFor(userId);await saveOperationalRecord(userId,Workflow.removeCampaignMembership(row.factionRecord,campaignId,Date.now()));}

  async function createSessionFromUi(){const rows=await buildRows(runtime.app);const candidateIds=rows.filter(row=>!row.archived&&!terminalStage(row.pipelineStage)).map(row=>row.userId);return saveSession(runtime.app,{sessionId:makeId('faction-session'),title:text(document.getElementById('ra-faction-session-title')?.value)||'Recruitment Session',candidateIds,cursor:0,status:candidateIds.length?'Draft':'Completed',outcomes:[],filters:{source:'active'}});}
  async function runSessionAction(sessionId,userId,action){const session=await getSession(runtime.app,sessionId);if(!session)throw new Error('Faction recruitment session was not found.');const note=text(document.querySelector(`[data-faction-session-note="${sessionId}"]`)?.value);if(action!=='Skip'&&FactionCore.FACTION_STAGES.includes(action))await changeFactionStage(userId,action);const next=Workflow.recordSessionAction(session,{userId,action,note},Date.now());return saveSession(runtime.app,next);}

  async function saveBaselineFromUi(){const host=document.getElementById('ra-faction-baseline-criteria');return saveConfig(runtime.app,{baseline:{criteria:readCriteria(host)}});}
  async function createProfile(){return saveProfile(runtime.app,{profileId:makeId('profile'),name:'New Specialist Profile',status:'Draft',criteria:[],notes:''});}
  async function saveProfileFromCard(profileId){const card=document.querySelector(`[data-faction-profile-card="${profileId}"]`);if(!card)throw new Error('Specialist profile was not found.');const profiles=await getProfiles(runtime.app);const existing=profiles.find(profile=>text(profile.profileId)===text(profileId));if(!existing)throw new Error('Specialist profile was not found.');const criteriaHost=card.querySelector('[data-faction-profile-criteria]');return saveProfile(runtime.app,{...existing,name:text(card.querySelector('[data-faction-profile-field="name"]')?.value),status:text(card.querySelector('[data-faction-profile-field="status"]')?.value)||'Draft',notes:text(card.querySelector('[data-faction-profile-field="notes"]')?.value),criteria:readCriteria(criteriaHost)});}

  async function grantWaiverFromUi(){
    const userId=text(document.getElementById('ra-faction-waiver-player')?.value);
    if(!userId)throw new Error('Choose a Faction candidate.');
    const row=await rowFor(userId);
    const context=text(document.getElementById('ra-faction-waiver-context')?.value).toLowerCase()==='specialist'?'specialist':'baseline';
    const profileId=context==='specialist'?text(document.getElementById('ra-faction-waiver-profile')?.value):'';
    if(context==='specialist'&&!profileId)throw new Error('Choose a specialist profile for this waiver.');
    const requirementId=text(document.getElementById('ra-faction-waiver-requirement')?.value);
    if(!requirementId)throw new Error('Choose a requirement to waive.');
    const reason=text(document.getElementById('ra-faction-waiver-reason')?.value);
    if(!reason)throw new Error('A waiver reason is required.');
    const[config,profiles]=await Promise.all([getConfig(runtime.app),getProfiles(runtime.app)]);
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const profile=context==='specialist'?profiles.map(FactionCore.normalizeSpecialistProfile).find(item=>text(item.profileId)===profileId):null;
    if(context==='specialist'&&!profile)throw new Error('Specialist profile was not found.');
    const criteria=context==='specialist'?(profile.criteria||[]):baseline.criteria;
    if(!criteria.some(item=>text(item.id)===requirementId))throw new Error('The selected requirement does not belong to the selected waiver context.');
    const duplicate=(row.factionRecord.waivers||[]).some(item=>text(item.state)==='Active'&&text(item.requirementId)===requirementId&&text(item.context)===context&&text(item.profileId)===profileId);
    if(duplicate)throw new Error('This requirement already has an active waiver for the candidate.');
    const reviewRaw=text(document.getElementById('ra-faction-waiver-review')?.value);
    let reviewAt=null;
    if(reviewRaw){reviewAt=Date.parse(reviewRaw);if(!Number.isFinite(reviewAt))throw new Error('Choose a valid waiver review date and time.');}
    const next=Operations.grantWaiver(row.factionRecord,{requirementId,context,profileId,reason,reviewAt},Date.now());
    return saveOperationalRecord(userId,next);
  }

  async function resolveWaiverFromUi(userId,waiverId){
    const row=await rowFor(userId);
    const waiver=(row.factionRecord.waivers||[]).find(item=>text(item.waiverId)===text(waiverId));
    if(!waiver)throw new Error('Waiver not found.');
    if(text(waiver.state)!=='Active')throw new Error('Only an active waiver can be resolved.');
    const answer=globalThis.prompt?globalThis.prompt('Resolution reason (optional)',''):'';
    if(answer==null)return false;
    const next=Operations.resolveWaiver(row.factionRecord,waiverId,text(answer),Date.now());
    return saveOperationalRecord(userId,next);
  }

  function recruitPlayer(row,override=false){
    if(row.doNotContact&&!override)throw new Error('This player is marked Do Not Contact. Use the deliberate override control if contact is still required.');
    if(override&&typeof globalThis.confirm==='function'&&!globalThis.confirm('This player is marked Do Not Contact. Override it for this recruitment chat only?'))return false;
    if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');
    return runtime.app.recruitCandidate?.('faction',row.userId,row.name);
  }

  function renderDiscover(rows=[]){
    const manual=rows.filter(row=>(row.factionRecord?.discoverySources||[]).some(source=>text(source).toUpperCase().includes('FACTION')));
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Discover</h3><p>Add a Torn player ID directly to the Faction workflow. This does not create or change a Company recruitment record.</p></div></div><div class="ra-actions"><input id="ra-faction-discover-id" inputmode="numeric" placeholder="Torn player ID"><button class="ra-btn ra-primary" id="ra-faction-discover-add">Add Faction Prospect</button></div></section><section class="ra-panel"><h3>Faction discovery provenance</h3>${manual.map(row=>`<div>${esc(row.name)} <span class="ra-muted">[${esc(row.userId)}] · ${esc((row.factionRecord.discoverySources||[]).join(', '))}</span></div>`).join('')||'<div class="ra-muted">No Faction discovery records yet.</div>'}</section>`;
  }

  function syncActiveNav(page){document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));}
  function reportError(error){console.error('[RA v4.7 Faction]',error);try{globalThis.alert?.(`Faction Recruitment failed: ${error?.message||error}`);}catch{}}

  function addCriterionRow(host,scope){if(!host)return;host.insertAdjacentHTML('beforeend',FactionUI.renderCriterionRow({id:makeId('criterion'),field:'level',operator:'gte',kind:'Preferred',weight:1},scope));bindContentControls();}

  function syncWaiverControls(){
    const contextSelect=document.getElementById('ra-faction-waiver-context');
    const profileSelect=document.getElementById('ra-faction-waiver-profile');
    const requirementSelect=document.getElementById('ra-faction-waiver-requirement');
    if(!contextSelect||!profileSelect||!requirementSelect)return;
    const context=text(contextSelect.value).toLowerCase()==='specialist'?'specialist':'baseline';
    const profileId=text(profileSelect.value);
    profileSelect.disabled=context!=='specialist';
    let first='';let currentAllowed=false;
    [...requirementSelect.options].forEach(option=>{
      if(!option.value)return;
      const optionContext=text(option.dataset.waiverContext)||'baseline';
      const optionProfile=text(option.dataset.waiverProfile);
      const allowed=optionContext===context&&(context!=='specialist'||!profileId||optionProfile===profileId);
      option.hidden=!allowed;option.disabled=!allowed;
      if(allowed&&!first)first=option.value;
      if(allowed&&option.value===requirementSelect.value)currentAllowed=true;
    });
    if(!currentAllowed)requirementSelect.value=first;
  }

  function bindContentControls(currentPage){
    const page=text(currentPage||runtime.app?._test?.state?.page);
    document.getElementById('ra-faction-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.searchFilters={search:text(document.getElementById('ra-faction-filter-search')?.value),minEnd:text(document.getElementById('ra-faction-filter-end')?.value),minMan:text(document.getElementById('ra-faction-filter-man')?.value),minInt:text(document.getElementById('ra-faction-filter-int')?.value),onlineStatus:text(document.getElementById('ra-faction-filter-status')?.value),organization:text(document.getElementById('ra-faction-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-faction-filter-organization-presence')?.value)||'any'};try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('faction',runtime.searchFilters);await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-faction-search-clear')?.addEventListener('click',()=>{runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('faction-candidates',{persist:false}).catch(reportError);});
    document.querySelectorAll('#ra-content [data-faction-sort]').forEach(button=>{button.onclick=()=>{runtime.sort=toggleSort(runtime.sort,button.dataset.factionSort);renderPage('faction-candidates',{persist:false}).catch(reportError);};});
    document.querySelectorAll('[data-go-page]').forEach(button=>{const route=text(button.dataset.goPage);if(isFactionRoute(route))button.onclick=event=>{event?.preventDefault?.();navigate(route,true).catch(reportError);};});
    document.querySelectorAll('[data-faction-stage-select]').forEach(select=>select.onchange=async()=>{try{await changeFactionStage(select.dataset.factionStageSelect,select.value);await renderPage(page,{persist:false});}catch(error){reportError(error);await renderPage(page,{persist:false});}});
    document.querySelectorAll('[data-faction-profile-pin]').forEach(select=>select.onchange=async()=>{try{await setProfilePin(select.dataset.factionProfilePin,select.value);await renderPage(page,{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-recruit]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruit).then(row=>recruitPlayer(row,false)).catch(reportError));
    document.querySelectorAll('[data-faction-recruit-override]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruitOverride).then(row=>recruitPlayer(row,true)).catch(reportError));

    const discover=document.getElementById('ra-faction-discover-add');if(discover)discover.onclick=async()=>{try{await ensureFactionCandidate(runtime.app,document.getElementById('ra-faction-discover-id')?.value);await renderPage('faction-discover',{persist:false});}catch(error){reportError(error);}};

    const baselineAdd=document.getElementById('ra-faction-baseline-add');if(baselineAdd)baselineAdd.onclick=()=>addCriterionRow(document.getElementById('ra-faction-baseline-criteria'),'baseline');
    const baselineSave=document.getElementById('ra-faction-baseline-save');if(baselineSave)baselineSave.onclick=async()=>{try{await saveBaselineFromUi();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    const profileNew=document.getElementById('ra-faction-profile-new');if(profileNew)profileNew.onclick=async()=>{try{await createProfile();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-profile-save]').forEach(button=>button.onclick=async()=>{try{await saveProfileFromCard(button.dataset.factionProfileSave);await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-profile-delete]').forEach(button=>button.onclick=async()=>{try{if(globalThis.confirm&&!globalThis.confirm('Delete this specialist profile?'))return;await removeProfile(runtime.app,button.dataset.factionProfileDelete);await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-profile-add-criterion]').forEach(button=>button.onclick=()=>{const card=document.querySelector(`[data-faction-profile-card="${button.dataset.factionProfileAddCriterion}"]`);addCriterionRow(card?.querySelector('[data-faction-profile-criteria]'),`profile:${button.dataset.factionProfileAddCriterion}`);});
    document.querySelectorAll('[data-faction-remove-criterion]').forEach(button=>button.onclick=()=>button.closest('[data-faction-criterion-row]')?.remove());

    const waiverContext=document.getElementById('ra-faction-waiver-context');if(waiverContext)waiverContext.onchange=syncWaiverControls;
    const waiverProfile=document.getElementById('ra-faction-waiver-profile');if(waiverProfile)waiverProfile.onchange=syncWaiverControls;
    syncWaiverControls();
    const waiverGrant=document.getElementById('ra-faction-waiver-grant');if(waiverGrant)waiverGrant.onclick=async()=>{try{await grantWaiverFromUi();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-waiver-resolve]').forEach(button=>button.onclick=async()=>{try{const changed=await resolveWaiverFromUi(button.dataset.factionWaiverPlayer,button.dataset.factionWaiverResolve);if(changed!==false)await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});

    const campaignNew=document.getElementById('ra-faction-campaign-new');if(campaignNew)campaignNew.onclick=async()=>{try{await createCampaignFromUi();await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-campaign-save]').forEach(button=>button.onclick=async()=>{try{await saveCampaignFromCard(button.dataset.factionCampaignSave);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-delete]').forEach(button=>button.onclick=async()=>{try{if(globalThis.confirm&&!globalThis.confirm('Delete this Faction campaign?'))return;await removeCampaign(runtime.app,button.dataset.factionCampaignDelete);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-add-member]').forEach(button=>button.onclick=async()=>{try{await addCampaignMember(button.dataset.factionCampaignAddMember);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-remove-member]').forEach(button=>button.onclick=async()=>{try{await removeCampaignMember(button.dataset.factionCampaignRemoveMember,button.dataset.factionCampaignUser);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});

    const followupAdd=document.getElementById('ra-faction-followup-add');if(followupAdd)followupAdd.onclick=async()=>{try{await addFollowUpFromUi();await renderPage('faction-followups',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-followup-complete]').forEach(button=>button.onclick=async()=>{try{await completeFollowUp(button.dataset.factionFollowupUser,button.dataset.factionFollowupComplete);await renderPage('faction-followups',{persist:false});}catch(error){reportError(error);}});

    const noteAdd=document.getElementById('ra-faction-timeline-add');if(noteAdd)noteAdd.onclick=async()=>{try{await addTimelineNoteFromUi();await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-note-edit]').forEach(button=>button.onclick=async()=>{try{await editTimelineNote(button.dataset.factionNoteUser,button.dataset.factionNoteEdit);await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-note-delete]').forEach(button=>button.onclick=async()=>{try{await deleteTimelineNote(button.dataset.factionNoteUser,button.dataset.factionNoteDelete);await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}});

    const outcomeAdd=document.getElementById('ra-faction-outcome-add');if(outcomeAdd)outcomeAdd.onclick=async()=>{try{await recordOutcomeFromUi();await renderPage('faction-contact-outcomes',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-dnc-toggle]').forEach(button=>button.onclick=async()=>{try{await toggleDnc(button.dataset.factionDncToggle,button.dataset.factionDncEnabled==='true');await renderPage('faction-contact-outcomes',{persist:false});}catch(error){reportError(error);}});

    const sessionNew=document.getElementById('ra-faction-session-new');if(sessionNew)sessionNew.onclick=async()=>{try{await createSessionFromUi();await renderPage('faction-recruitment-sessions',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-session-action]').forEach(button=>button.onclick=async()=>{try{await runSessionAction(button.dataset.factionSessionAction,button.dataset.factionSessionUser,button.value);await renderPage('faction-recruitment-sessions',{persist:false});}catch(error){reportError(error);}});

    document.querySelectorAll('[data-faction-reactivate-player]').forEach(button=>button.onclick=async()=>{try{await reactivatePlayer(button.dataset.factionReactivatePlayer);await renderPage('faction-reactivation',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-compare-select]').forEach(input=>input.onchange=async()=>{const id=text(input.dataset.factionCompareSelect);if(input.checked){if(runtime.compareSelection.size>=4){input.checked=false;globalThis.alert?.('Faction Compare supports up to four players.');return;}runtime.compareSelection.add(id);}else runtime.compareSelection.delete(id);await renderPage('faction-compare',{persist:false});});
  }

  async function renderPage(page,options={}){
    const app=runtime.app;page=text(page);
    if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
    if(options.persist!==false)claimRoute(app,page);
    const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
    if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
    const rows=await buildRows(app);
    let html='';
    const[config,profiles,campaigns,sessions]=await Promise.all([getConfig(app),getProfiles(app),getCampaigns(app),getSessions(app)]);

    if(page==='faction-overview')html=FactionUI.renderOverview(FactionUI.buildOverviewModel(rows,profiles));
    else if(page==='faction-today'){
      const opportunities=await buildOpportunityRows(app,rows,Date.now());
      html=FactionUI.renderToday(FactionUI.buildTodayModel(rows,{now:Date.now(),stageThresholds:config.stageThresholds||{},opportunities:Object.fromEntries(opportunities.map(item=>[item.userId,item.opportunity.score]))}));
    }
    else if(page==='faction-discover')html=renderDiscover(rows);
    else if(page==='faction-candidates'){const filtered=filterRows(rows,runtime.searchFilters);const sorted=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));html=FactionUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length});}
    else if(page==='faction-pipeline')html=FactionUI.renderPipeline(FactionUI.buildPipelineModel(rows));
    else if(page==='faction-requirements')html=FactionUI.renderRequirementsPage({config,profiles,rows});
    else if(page==='faction-campaigns')html=WorkflowUI.renderCampaignsPage({campaigns,rows,profiles});
    else if(page==='faction-followups')html=WorkflowUI.renderFollowUpsPage(rows);
    else if(page==='faction-timeline')html=WorkflowUI.renderTimelinePage(rows);
    else if(page==='faction-stage-aging')html=WorkflowUI.renderStageAgingPage(rows.map(row=>({...row,stageAging:Operations.stageAging(row.factionRecord,config.stageThresholds||{},Date.now())})));
    else if(page==='faction-contact-outcomes')html=WorkflowUI.renderContactOutcomesPage(rows);
    else if(page==='faction-recruitment-sessions')html=WorkflowUI.renderRecruitmentSessionsPage({sessions,rows});
    else if(page==='faction-reactivation')html=WorkflowUI.renderReactivationPage(rows);
    else if(page==='faction-opportunity')html=OpportunityUI.renderOpportunityPage(await buildOpportunityRows(app,rows,Date.now()));
    else if(page==='faction-compare')html=OpportunityUI.renderComparePage(rows,[...runtime.compareSelection]);
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls(page);if(options.persist!==false)await persistRoute(app,page);return true;
  }

  function bindNav(){
    if(!runtime.app)return;
    document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{
      const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;
      if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);
      button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};
    });
  }
  function syncNavigation(){bindNav();return true;}
  function install(app,options={}){
    if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');
    uninstall();runtime.app=app;runtime.installed=true;bindNav();
    const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}
    const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);
    return true;
  }
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.compareSelection.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({
    FACTION_ROUTES,
    isFactionRoute,
    routeMeta,
    install,
    uninstall,
    renderPage,
    syncNavigation,
    _test:{IMPLEMENTED_ROUTES,buildRows,buildOpportunityRows,persistRoute,dbGetAll,dbGet,dbPut,dbDelete,getConfig,getProfiles,getCampaigns,getSessions,readCriteria,ensureFactionCandidate,changeFactionStage,setProfilePin,opportunityWeights,filterRows,sortRows,toggleSort,organizationInfo}
  });
});

/* bundled runtime: v45-app.js */
(function (root, factory) {
  const deps = {
    ScoutCore: root && root.RA_ScoutCore,
    ResultsCore: root && root.RA_ResultsCore,
    GlobalCore: root && root.RA_GlobalCore,
    MatchCore: root && root.RA_MatchCore,
    ForumCore: root && root.RA_ForumCore,
    Runtime: root && root.RA_V45Runtime,
    Candidates: root && root.RA_V45Candidates,
    Discovery: root && root.RA_V45Discovery,
    Messaging: root && root.RA_V45Messaging,
    V46Domain: root && root.RA_V46DomainCore,
    V46Storage: root && root.RA_V46StorageCore,
    V46Navigation: root && root.RA_V46Navigation,
    V46CompanyCore: root && root.RA_V46CompanyCore,
    V46CompanyStorage: root && root.RA_V46CompanyStorage,
    V46CompanyPlatform: root && root.RA_V46CompanyPlatform,
    V47FactionCore: root && root.RA_V47FactionCore,
    V47FactionStorage: root && root.RA_V47FactionStorage,
    V47FactionUI: root && root.RA_V47FactionUI,
    V47FactionOperations: root && root.RA_V47FactionOperations,
    V47FactionWorkflow: root && root.RA_V47FactionWorkflow,
    V47FactionWorkflowUI: root && root.RA_V47FactionWorkflowUI,
    V47FactionOpportunityUI: root && root.RA_V47FactionOpportunityUI,
    V47FactionPlatform: root && root.RA_V47FactionPlatform
  };
  if (typeof module === 'object' && module.exports) {
    deps.ScoutCore = require('./scout-core');
    deps.ResultsCore = require('./results-core');
    deps.GlobalCore = require('./global-core');
    deps.MatchCore = require('./match-core');
    deps.ForumCore = require('./forum-core');
    deps.Runtime = require('./v45-runtime');
    deps.Candidates = require('./v45-candidates');
    deps.Discovery = require('./v45-discovery');
    deps.Messaging = require('./v45-messaging');
    deps.V46Domain = require('./v46-domain-core');
    deps.V46Storage = require('./v46-storage-core');
    deps.V46Navigation = require('./v46-navigation');
    deps.V46CompanyCore = require('./v46-company-core');
    deps.V46CompanyStorage = require('./v46-company-storage');
    deps.V46CompanyPlatform = require('./v46-company-platform');
    deps.V47FactionCore = require('./v47-faction-core');
    deps.V47FactionStorage = require('./v47-faction-storage');
    deps.V47FactionUI = require('./v47-faction-ui');
    deps.V47FactionOperations = require('./v47-faction-operations');
    deps.V47FactionWorkflow = require('./v47-faction-workflow');
    deps.V47FactionWorkflowUI = require('./v47-faction-workflow-ui');
    deps.V47FactionOpportunityUI = require('./v47-faction-opportunity-ui');
    deps.V47FactionPlatform = require('./v47-faction-platform');
  }
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45App = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const {ScoutCore,ResultsCore,GlobalCore,MatchCore,ForumCore,Runtime,Candidates,Discovery,Messaging,V46Domain,V46Storage,V46Navigation,V46CompanyCore,V46CompanyStorage,V46CompanyPlatform,V47FactionCore,V47FactionStorage,V47FactionUI,V47FactionOperations,V47FactionWorkflow,V47FactionWorkflowUI,V47FactionOpportunityUI,V47FactionPlatform} = D;
  if (![ScoutCore,ResultsCore,GlobalCore,MatchCore,ForumCore,Runtime,Candidates,Discovery,Messaging,V46Domain,V46Storage,V46Navigation,V46CompanyCore,V46CompanyStorage,V46CompanyPlatform,V47FactionCore,V47FactionStorage,V47FactionUI,V47FactionOperations,V47FactionWorkflow,V47FactionWorkflowUI,V47FactionOpportunityUI,V47FactionPlatform].every(Boolean)) {
    throw new Error('Recruitment Agency v4.5 core modules are required.');
  }

  const SCRIPT_VERSION = '4.8.3';
  const DB_NAME = 'tornWorkerDB';
  const DB_VERSION = V47FactionStorage.DB_VERSION;
  const API_BASE = 'https://api.torn.com/v2';
  const API_COMMENT = 'R4G3RUNN3R Recruitment Agency';
  const HARD_API_RATE = 75;
  const MIN_API_GAP_MS = 800;
  const PAGE_SIZE = 20;
  const SCOUT_STAT_LIST = 'xantaken,useractivity,refills,statenhancersused,attackswon,attackslost,rankedwarhits,networth,activestreak,bestactivestreak';
  const STORE_NAMES = Object.freeze(['users','meta','scoutLatest','scoutHistory','globalLatest','globalHistory','globalSyncQueue','candidateLocal','matchProfiles','forumSources','forumSyncState','appLogs','playerIntelligence','companyRecruitment','factionRecruitment','companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions']);
  const DEFAULT_VISIBLE_COLUMNS = Object.freeze(['player','stage','match','fit','lookingFor','source','lastActive']);
  const OPTIONAL_COLUMNS = Object.freeze(['currentCompany','man','int','end','total','availability','postedAt','ee','activity30','scoutStatus']);
  const COLUMN_LABELS = Object.freeze({player:'Player',stage:'Stage',match:'Match',fit:'Fit',lookingFor:'Looking For',source:'Source',lastActive:'Last Active',currentCompany:'Current Company',man:'MAN',int:'INT',end:'END',total:'TOTAL',availability:'Availability',postedAt:'Posted',ee:'EE',activity30:'Activity 30d',scoutStatus:'Scout Status'});
  const OPTIONAL_MODULES = Object.freeze([
    ['companyOverview','Company Overview'],['companyToday','Company Today'],['companyDiscovery','Company Discovery'],['companyPipeline','Company Pipeline'],['companyVacancies','Company Vacancies'],['companyCampaigns','Company Campaigns'],['companyFollowups','Company Follow-ups'],['companyTimeline','Company Timeline'],['companyStageAging','Company Stage Aging'],['companyContactOutcomes','Company Contact Outcomes'],['companySessions','Company Recruitment Sessions'],['companyTalentPool','Company Talent Pool'],['companyReactivation','Company Reactivation'],['companyOpportunity','Company Opportunity Queue'],['companyCompare','Company Compare'],
    ['factionOverview','Faction Overview'],['factionToday','Faction Today'],['factionDiscovery','Faction Discovery'],['factionPipeline','Faction Pipeline'],['factionRequirements','Faction Requirements'],['factionCampaigns','Faction Campaigns'],['factionFollowups','Faction Follow-ups'],['factionTimeline','Faction Timeline'],['factionStageAging','Faction Stage Aging'],['factionContactOutcomes','Faction Contact Outcomes'],['factionSessions','Faction Recruitment Sessions'],['factionReactivation','Faction Reactivation'],['factionOpportunity','Faction Opportunity Queue'],['factionCompare','Faction Compare'],
    ['scout','Scout'],['smartMatch','Smart Match'],['globalIntelligence','Global Intelligence'],['data','Data'],['logs','Logs']
  ]);
  const DEFAULT_OPTIONAL_MODULES = Object.freeze(Object.fromEntries(OPTIONAL_MODULES.map(([key])=>[key,false])));

  const defaultSettings = () => ({
    theme:'dark', density:'comfortable', textSize:'normal', complexity:'simple', sidebarCollapsed:false,
    launcherEnabled:true, includeInactive:false, activePage:'company-candidates', activeDomain:'company', navigation:{expandedGroups:['company-recruitment']}, optionalModules:{...DEFAULT_OPTIONAL_MODULES}, apiKey:'', ownCompanyName:'',
    recruitment:Runtime.normalizeRecruitmentSettings({companyThreadId:'15907925',factionThreadId:'15909136',trainingThreadId:'',recentImportDays:30,maxPagesPerFeed:20,candidateActiveAgeDays:30,explicitTrainBuyersOnly:true,companyType:'',companyRecruitmentMessage:Messaging.DEFAULT_COMPANY_RECRUITMENT_MESSAGE,factionName:'',factionRecruitmentMessage:Messaging.DEFAULT_FACTION_RECRUITMENT_MESSAGE}),
    scout:{rate:75,workers:3,budget:900,historyGapMs:0,maxCandidates:60,scoring:ScoutCore.DEFAULT_SCORING},
    candidates:{view:'table',visibleColumns:[...DEFAULT_VISIBLE_COLUMNS],filters:{search:'',stage:'',source:'',lookingFor:'',currentCompany:'',minMatch:'',minFit:'',activeOnly:false,moreOpen:false,minMan:'',minInt:'',minEnd:'',minActivity30:''}},
    match:{activeProfileId:''},
    global:{enabled:true,endpoint:'',lookupCacheMs:30*60*1000,maxRetryAttempts:5}
  });

  const state = {
    db:null, settings:null, page:'company-candidates', mounted:false, topZ:2147483400,
    apiGate:Promise.resolve(), apiNextAt:0,
    sync:{running:false,cancelled:false,feed:'',pages:0},
    fill:{running:false,cancelled:false,done:0,total:0,errors:[]},
    scout:{running:false,paused:false,cancelled:false,done:0,total:0,calls:0,currentId:null,status:'Idle'},
    help:{pinned:false,anchor:null}, contextCandidateId:'', drawerCandidateId:'', messageCandidateId:'',
    resizeTimer:null, logRefreshTimer:null
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = value => String(value ?? '').trim();
  const number = (value, fallback = 0) => { const out=Number(value); return Number.isFinite(out)?out:fallback; };
  const finite = value => { if (value === '' || value === null || value === undefined) return null; const out=Number(value); return Number.isFinite(out)?out:null; };
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const clampRate = value => Math.max(10,Math.min(HARD_API_RATE,number(value,HARD_API_RATE)));
  const formatNumber = (value,dp=0) => finite(value)===null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:dp});
  const money = value => { const x=finite(value); if(x===null)return '—'; if(x>=1e9)return `$${(x/1e9).toFixed(2)}B`; if(x>=1e6)return `$${(x/1e6).toFixed(1)}M`; return `$${Math.round(x).toLocaleString()}`; };
  const profileUrl = id => Candidates.tornProfileUrl(id);
  const forumThreadUrl = id => /^\d+$/.test(text(id)) ? `https://www.torn.com/forums.php?a=0&p=threads&t=${text(id)}` : '';

  function openDB(indexedDBImpl) {
    const indexedDB = indexedDBImpl || globalThis.indexedDB;
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=event=>{
        const db=event.target.result;
        if(!db.objectStoreNames.contains('users')) db.createObjectStore('users',{keyPath:'recordId'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('scoutLatest')) db.createObjectStore('scoutLatest',{keyPath:'userId'});
        if(!db.objectStoreNames.contains('scoutHistory')) { const s=db.createObjectStore('scoutHistory',{keyPath:'snapshotId'});s.createIndex('userId','userId',{unique:false});s.createIndex('capturedAt','capturedAt',{unique:false}); }
        if(!db.objectStoreNames.contains('globalLatest')) db.createObjectStore('globalLatest',{keyPath:'userId'});
        if(!db.objectStoreNames.contains('globalHistory')) { const s=db.createObjectStore('globalHistory',{keyPath:'snapshotId'});s.createIndex('userId','userId',{unique:false});s.createIndex('observedAt','observedAt',{unique:false}); }
        if(!db.objectStoreNames.contains('globalSyncQueue')) db.createObjectStore('globalSyncQueue',{keyPath:'queueId'});
        if(!db.objectStoreNames.contains('candidateLocal')) db.createObjectStore('candidateLocal',{keyPath:'userId'});
        if(!db.objectStoreNames.contains('matchProfiles')) db.createObjectStore('matchProfiles',{keyPath:'profileId'});
        if(!db.objectStoreNames.contains('forumSources')) { const s=db.createObjectStore('forumSources',{keyPath:'sourceId'});s.createIndex('userId','userId',{unique:false});s.createIndex('postedAt','postedAt',{unique:false});s.createIndex('sourceType','sourceType',{unique:false});s.createIndex('threadId','threadId',{unique:false}); }
        if(!db.objectStoreNames.contains('forumSyncState')) db.createObjectStore('forumSyncState',{keyPath:'feedId'});
        if(!db.objectStoreNames.contains('appLogs')) db.createObjectStore('appLogs',{keyPath:'logId'});
        V46Storage.applyUpgrade(db);
        V46CompanyStorage.applyUpgrade(db);
        V47FactionStorage.applyUpgrade(db);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB open failed.'));
      req.onblocked=()=>reject(new Error(`IndexedDB v${DB_VERSION} upgrade is blocked by another Torn tab.`));
    });
  }

  const idb = {
    get(store,key){return new Promise(resolve=>{try{const q=state.db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});},
    getAll(store){return new Promise(resolve=>{try{const q=state.db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});},
    put(store,value){return new Promise((resolve,reject)=>{try{const tx=state.db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});},
    delete(store,key){return new Promise(resolve=>{try{const q=state.db.transaction(store,'readwrite').objectStore(store).delete(key);q.onsuccess=()=>resolve(true);q.onerror=()=>resolve(false);}catch{resolve(false);}});},
    clear(store){return new Promise(resolve=>{try{const q=state.db.transaction(store,'readwrite').objectStore(store).clear();q.onsuccess=()=>resolve(true);q.onerror=()=>resolve(false);}catch{resolve(false);}});}
  };
  const repositories=V46Storage.createRepositories(idb);
  const companyRepositories=V46CompanyStorage.createRepositories(idb,V46CompanyCore);
  const factionRepositories=V47FactionStorage.createRepositories(idb,V47FactionCore);
  const companyPlatformApp={navigate:(page,persist=true)=>route(page,persist),recruitCandidate:(domain,userId,name)=>recruitCandidate(domain,userId,name),searchCandidates:(domain,filters)=>searchCandidates(domain,filters),_test:{state,repositories,companyRepositories,factionRepositories}};

  function mergeSettings(raw={}) {
    const base=defaultSettings();
    const scout=raw.scout||{};
    const candidateSettings=raw.candidates||{};
    const navigationSettings=raw.navigation||{};
    return {
      ...base,...raw,
      theme:raw.theme==='light'?'light':'dark', density:raw.density==='compact'?'compact':'comfortable', textSize:['small','normal','large'].includes(raw.textSize)?raw.textSize:'normal',
      complexity:raw.complexity==='advanced'?'advanced':'simple',
      activeDomain:raw.activeDomain==='faction'?'faction':'company',
      optionalModules:{...base.optionalModules,...(raw.optionalModules||{})},
      navigation:{...base.navigation,...navigationSettings,expandedGroups:V46Navigation.normalizeExpandedGroups(Object.hasOwn(navigationSettings,'expandedGroups')?navigationSettings.expandedGroups:base.navigation.expandedGroups)},
      recruitment:Runtime.normalizeRecruitmentSettings({...base.recruitment,...(raw.recruitment||{})}),
      scout:{...base.scout,...scout,rate:clampRate(scout.rate),workers:Math.max(1,Math.min(8,number(scout.workers,3))),budget:Math.max(1,number(scout.budget,900)),maxCandidates:Math.max(1,number(scout.maxCandidates,60)),scoring:ScoutCore.normalizeScoring(scout.scoring||base.scout.scoring)},
      candidates:{...base.candidates,...candidateSettings,visibleColumns:Array.isArray(candidateSettings.visibleColumns)&&candidateSettings.visibleColumns.length?[...new Set(['player',...candidateSettings.visibleColumns])]:[...DEFAULT_VISIBLE_COLUMNS],filters:{...base.candidates.filters,...(candidateSettings.filters||{})}},
      match:{...base.match,...(raw.match||{})}, global:{...base.global,...(raw.global||{})}
    };
  }

  async function getMeta(){return await idb.get('meta','global')||{key:'global',settings:defaultSettings(),ui:{windowGeometry:{}}};}
  async function saveSettings(patch){const meta=await getMeta();meta.settings=mergeSettings({...meta.settings,...patch});await idb.put('meta',meta);state.settings=meta.settings;return state.settings;}
  async function logEvent(type,message,details={}){if(!state.db)return;const item=Runtime.makeLogEntry(type,message,details);item.logId=`${item.at}:${Math.random().toString(36).slice(2,8)}`;await idb.put('appLogs',item);const rows=await idb.getAll('appLogs');if(rows.length>500){rows.sort((a,b)=>a.at-b.at);for(const old of rows.slice(0,rows.length-500))await idb.delete('appLogs',old.logId);}}

  async function reserveApiCall(countScout=false){let unlock;const previous=state.apiGate;state.apiGate=new Promise(resolve=>{unlock=resolve;});await previous;try{if(countScout){while(state.scout.paused&&!state.scout.cancelled)await sleep(200);if(state.scout.cancelled)throw Object.assign(new Error('Scout cancelled.'),{cancelled:true});if(state.scout.calls>=state.settings.scout.budget)throw Object.assign(new Error('Scout request budget reached.'),{budget:true});}const gap=Math.max(MIN_API_GAP_MS,60000/clampRate(state.settings.scout.rate));const wait=Math.max(0,state.apiNextAt-Date.now());if(wait)await sleep(wait);state.apiNextAt=Date.now()+gap;if(countScout)state.scout.calls++;}finally{unlock();}}
  async function ensureApiKey(force=false){if(!force&&state.settings.apiKey&&state.settings.apiKey.length>=8)return state.settings.apiKey;const key=text(globalThis.prompt?.('Enter your Torn PUBLIC API key:',state.settings.apiKey||''));if(!key)throw new Error('A Torn API key is required.');await saveSettings({apiKey:key});return key;}
  async function tornRequest(path,params={},options={}){await reserveApiCall(!!options.scout);const key=await ensureApiKey(false);const url=new URL(`${API_BASE}/${text(path).replace(/^\/+/, '')}`);url.searchParams.set('key',key);url.searchParams.set('comment',API_COMMENT);for(const[k,v]of Object.entries(params||{}))if(v!==''&&v!==null&&v!==undefined)url.searchParams.set(k,String(v));const response=await fetch(url.toString(),{method:'GET',cache:'no-store',credentials:'omit'});let data;try{data=await response.json();}catch{throw new Error(`Torn returned HTTP ${response.status}.`);}if(!response.ok||data?.error){const err=new Error(data?.error?.error||data?.error?.message||`Torn API error ${data?.error?.code||response.status}`);err.code=Number(data?.error?.code||0);err.http=response.status;throw err;}return data;}
  async function tornContinuation(value){const safe=ForumCore.sanitizeContinuation(value);if(!safe)throw new Error('Unsafe forum continuation was rejected.');const u=new URL(safe);const path=u.pathname.replace(/^\/v2\//,'');const params={};u.searchParams.forEach((v,k)=>{if(k!=='key'&&k!=='comment')params[k]=v;});return tornRequest(path,params);}

  function currentProfileUserId(){
    try{const id=text(new URL(globalThis.location?.href||'https://www.torn.com/').searchParams.get('XID'));if(/^\d+$/.test(id))return id;}catch{}
    const button=document.querySelector('[id^="button2-profile-"]');
    const fromButton=text(button?.id).replace(/^button2-profile-/,'');
    return /^\d+$/.test(fromButton)?fromButton:'';
  }
  function visibleElement(element){if(!element)return false;const style=globalThis.getComputedStyle?.(element);if(style&&(style.display==='none'||style.visibility==='hidden'))return false;const rect=element.getBoundingClientRect?.();return !rect||(rect.width>0&&rect.height>0);}
  function findPrivateChatButton(userId){return document.querySelector(`[id="button2-profile-${userId}"]`)||document.querySelector('a.profile-button.profile-button-initiateChat')||document.querySelector('a[aria-label="Start chat"]');}
  function privateChatInputs(userId){
    const selectors=['textarea','div[contenteditable="true"]','input[type="text"]','[role="textbox"]'];
    return [...document.querySelectorAll(selectors.join(','))].filter(visibleElement).map(element=>{
      let score=0;const container=element.closest('[class*="chat" i],[class*="conversation" i],[class*="message" i],[class*="pm" i],[data-user-id],[data-user]');
      if(container)score+=5;if(text(container?.getAttribute?.('data-user-id'))===userId||text(container?.getAttribute?.('data-user'))===userId)score+=8;
      if(element.matches('textarea,[contenteditable="true"],[role="textbox"]'))score+=2;
      return{element,score};
    }).sort((a,b)=>b.score-a.score).map(item=>item.element);
  }
  function findPrivateChatInput(userId){return privateChatInputs(text(userId))[0]||null;}
  function setPrivateChatInputValue(input,value){
    const prepared=String(value||'');if(!input||!prepared)return false;
    if(input.matches?.('textarea,input')){
      const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(input,prepared);else input.value=prepared;
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Unidentified'}));
    }else{
      input.textContent=prepared;
      try{input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prepared}));}catch{input.dispatchEvent(new Event('input',{bubbles:true}));}
    }
    return true;
  }
  async function restorePendingPrivateChatDraft(timeoutMs=6500){
    const userId=currentProfileUserId();if(!userId)return false;
    const plan=Messaging.consumePrivateChatDraft(userId);if(!plan)return false;
    const started=Date.now();let clicked=false;
    try{
      while(Date.now()-started<timeoutMs){
        const input=findPrivateChatInput(userId);
        if(input){setPrivateChatInputValue(input,plan.preparedText);input.focus?.();toast('Recruitment private chat prepared. Review it and press Send in Torn.');return true;}
        const button=findPrivateChatButton(userId);if(button&&!clicked){clicked=true;button.click();}
        await sleep(120);
      }
      throw new Error('Torn private chat did not become ready. The draft was kept for another attempt.');
    }catch(error){Messaging.queuePrivateChatDraft(plan);throw error;}
  }
  async function recruitCandidate(domain,userId,name=''){
    const targetId=text(userId),kind=text(domain).toLowerCase(),playerName=text(name)||`User ${targetId}`;
    if(!/^\d+$/.test(targetId))throw new Error('A valid Torn player ID is required.');
    if(!['company','faction'].includes(kind))throw new Error('Recruitment domain must be Company or Faction.');
    const recruitment=state.settings.recruitment||{};
    if(kind==='company'){if(!text(state.settings.ownCompanyName))throw new Error('Set your Company Name in Recruitment settings first.');if(!text(recruitment.companyType))throw new Error('Set your Company Type in Recruitment settings first.');}
    if(kind==='faction'&&!text(recruitment.factionName))throw new Error('Set your Faction Name in Recruitment settings first.');
    let targetWindow=null;try{targetWindow=globalThis.open?.('about:blank','_blank');if(targetWindow)targetWindow.opener=null;}catch{}
    try{
      const response=await tornRequest(kind==='company'?`user/${targetId}/job`:`user/${targetId}/faction`);
      const eligibility=kind==='company'?Messaging.companyRecruitmentEligibility(response):Messaging.factionRecruitmentEligibility(response);
      if(!eligibility.eligible){try{targetWindow?.close?.();}catch{}const label=kind==='company'?'company':'faction';throw new Error(`${playerName} already belongs to ${eligibility.currentName||('a '+label)}. Recruitment stopped.`);}
      const template=kind==='company'?recruitment.companyRecruitmentMessage:recruitment.factionRecruitmentMessage;
      const values=kind==='company'?{userId:targetId,name:playerName,company_name:state.settings.ownCompanyName,company_type:recruitment.companyType}:{userId:targetId,name:playerName,faction_name:recruitment.factionName};
      const plan=Messaging.recruitmentChatPlan(kind,template,values);
      Messaging.queuePrivateChatDraft(plan);
      if(targetWindow)targetWindow.location.href=plan.profileUrl;else globalThis.open?.(plan.profileUrl,'_blank','noopener');
      toast(`${playerName} is available. Torn private chat is being prepared; you still press Send.`);
      await logEvent('recruit','Private-chat recruitment draft prepared',{playerId:Number(targetId),domain:kind});
      return plan;
    }catch(error){try{if(targetWindow&&!targetWindow.closed&&String(targetWindow.location?.href||'').startsWith('about:blank'))targetWindow.close();}catch{}throw error;}
  }

  function extractStats(data){const p=data?.personalstats||data?.personal_stats||data?.personalStats||{};return p&&typeof p==='object'?p:{};}
  function extractProfile(data,userId){const p=data?.profile?.profile||data?.profile||data?.basic?.basic||data?.basic||data||{};const faction=p.faction||{};const last=p.last_action||p.lastAction||{};const status=p.status||{};return{id:Number(p.id||p.player_id||userId),name:text(p.name||p.username||`User ${userId}`),level:number(p.level),age:number(p.age),factionId:number(faction.id||p.faction_id),factionName:text(faction.name||p.faction_name),status:text(status.state||status.description||p.online_status||last.status||'Unknown'),lastActionTs:number(last.timestamp||last.time||p.last_action_timestamp)};}
  function scoutFit(snapshot){if(!snapshot)return null;if(snapshot.official&&snapshot.w30)return ScoutCore.scoreFit(snapshot.w30,state.settings.scout.scoring).score;if(snapshot.provisionalSource&&snapshot.provisionalDays)return ScoutCore.provisionalFit(snapshot.provisionalSource,snapshot.provisionalDays,state.settings.scout.scoring).score;return finite(snapshot.currentFit??snapshot.originalFit);}
  async function scoutPlayer(userId,force=false){const id=Number(userId);if(!id)throw new Error('Invalid player ID.');const cached=await idb.get('scoutLatest',id);if(!force&&cached&&Date.now()-Number(cached.capturedAt||0)<12*60*60*1000)return cached;state.scout.currentId=id;state.scout.status=`Scouting ${id}: current totals`;refreshScoutRuntimeUi();const currentData=await tornRequest(`user/${id}`,{selections:'profile,personalstats',stat:SCOUT_STAT_LIST},{scout:true});const current=extractStats(currentData);const profile=extractProfile(currentData,id);const now=Math.floor(Date.now()/1000);let past7=null,past30=null,w7=null,w30=null;if(profile.age>=7){if(state.settings.scout.historyGapMs)await sleep(state.settings.scout.historyGapMs);state.scout.status=`Scouting ${id}: 7-day history`;refreshScoutRuntimeUi();past7=extractStats(await tornRequest(`user/${id}`,{selections:'personalstats',stat:SCOUT_STAT_LIST,timestamp:now-7*86400},{scout:true}));w7=ScoutCore.deltaStats(current,past7);}if(profile.age>=30){if(state.settings.scout.historyGapMs)await sleep(state.settings.scout.historyGapMs);state.scout.status=`Scouting ${id}: 30-day history`;refreshScoutRuntimeUi();past30=extractStats(await tornRequest(`user/${id}`,{selections:'personalstats',stat:SCOUT_STAT_LIST,timestamp:now-30*86400},{scout:true}));w30=ScoutCore.deltaStats(current,past30);}const official=profile.age>=30&&!!w30;let provisionalSource=null,provisionalDays=0;if(!official){if(profile.age>0&&profile.age<30){provisionalSource=ScoutCore.metricsFromTotals(current);provisionalDays=Math.max(1,Math.min(29,profile.age));}else if(w7){provisionalSource=w7;provisionalDays=7;}}const fitObj=official?ScoutCore.scoreFit(w30,state.settings.scout.scoring):null;const provisionalObj=!official&&provisionalSource?ScoutCore.provisionalFit(provisionalSource,provisionalDays,state.settings.scout.scoring):null;const trend= w7&&w30?ScoutCore.computeTrend(w7,w30,state.settings.scout.scoring):{percent:null,components:{}};const capturedAt=Date.now();const snapshot={snapshotId:`${id}:${capturedAt}`,userId:id,capturedAt,source:'scout',profile,currentRaw:current,past7Raw:past7,past30Raw:past30,w7,w30,official,provisionalSource,provisionalDays,provisionalConfidence:provisionalObj?.confidence||null,originalFit:fitObj?.score??provisionalObj?.score??null,currentFit:fitObj?.score??provisionalObj?.score??null,originalFitType:official?'official':(provisionalObj?'provisional':'unmeasured'),trend:trend.percent,trendComponents:trend.components,formula:ScoutCore.normalizeScoring(state.settings.scout.scoring),extra:{networth:number(current.networth),activeStreak:number(current.activestreak),bestActiveStreak:number(current.bestactivestreak),statEnhancers30:w30?.statEnhancers??provisionalSource?.statEnhancers??0}};await idb.put('scoutLatest',snapshot);await idb.put('scoutHistory',snapshot);await repositories.players.ensure(String(id),{name:profile.name,level:profile.level,factionId:profile.factionId,factionName:profile.factionName,networth:snapshot.extra?.networth,fit:snapshot.currentFit??snapshot.originalFit,fitType:snapshot.official?'official':(snapshot.provisionalSource?'provisional':'unmeasured'),lastActive:profile.lastActionTs?Number(profile.lastActionTs)*1000:null,lastScoutAt:capturedAt,activity30:(snapshot.w30||snapshot.provisionalSource||{}).activityHours,xanax30:(snapshot.w30||snapshot.provisionalSource||{}).xanax,refills30:(snapshot.w30||snapshot.provisionalSource||{}).refills,attacks30:(snapshot.w30||snapshot.provisionalSource||{}).attacks,rwHits30:(snapshot.w30||snapshot.provisionalSource||{}).rwHits,scoutStatus:ResultsCore.classifyScoutStatus(snapshot)},'scout',capturedAt);await enqueueGlobalObservation(snapshot).catch(()=>{});return snapshot;}
  async function runScout(ids,force=false){if(state.scout.running)throw new Error('Scout is already running.');const unique=[...new Set((ids||[]).map(Number).filter(Boolean))].slice(0,state.settings.scout.maxCandidates);if(!unique.length)throw new Error('No valid player IDs to Scout.');Object.assign(state.scout,{running:true,paused:false,cancelled:false,done:0,total:unique.length,calls:0,currentId:null,status:'Starting'});refreshScoutRuntimeUi();let cursor=0;const workers=Math.max(1,Math.min(state.settings.scout.workers,unique.length));const worker=async()=>{while(!state.scout.cancelled){const i=cursor++;if(i>=unique.length)break;const id=unique[i];try{await scoutPlayer(id,force);await logEvent('scout','Scout player completed',{playerId:id});}catch(error){if(!error.cancelled)await logEvent('error','Scout player failed',{playerId:id,error:text(error.message)});}finally{state.scout.done++;refreshScoutRuntimeUi();}}};try{await Promise.all(Array.from({length:workers},worker));}finally{state.scout.running=false;state.scout.paused=false;state.scout.currentId=null;state.scout.status=state.scout.cancelled?'Stopped':'Complete';refreshScoutRuntimeUi();if(state.page==='scout'||state.page==='company-candidates'||state.page==='company-pipeline')await route(state.page,false);}return true;}
  function pauseScout(){if(state.scout.running){state.scout.paused=!state.scout.paused;state.scout.status=state.scout.paused?'Paused':'Running';refreshScoutRuntimeUi();}}
  function cancelScout(){if(state.scout.running){state.scout.cancelled=true;state.scout.paused=false;state.scout.status='Cancelling';refreshScoutRuntimeUi();}}

  function globalEndpoint(){return text(state.settings.global.endpoint).replace(/\/+$/,'');}
  async function globalJson(url,options={}){const method=text(options.method||'GET').toUpperCase();const body=options.body==null?null:String(options.body);const headers={...(options.headers||{})};if(typeof globalThis.GM_xmlhttpRequest==='function')return new Promise((resolve,reject)=>globalThis.GM_xmlhttpRequest({method,url,headers,data:body,anonymous:true,timeout:15000,onload:r=>{if(Number(r.status)<200||Number(r.status)>=300)return reject(new Error(`Global service HTTP ${r.status}`));try{resolve(JSON.parse(String(r.responseText||'')));}catch{reject(new Error('Global service returned invalid JSON.'));}},ontimeout:()=>reject(new Error('Global service timed out.')),onerror:()=>reject(new Error('Global service request failed.'))}));const response=await fetch(url,{method,headers,body,redirect:'follow',cache:'no-store'});if(!response.ok)throw new Error(`Global service HTTP ${response.status}`);return response.json();}
  function globalObservation(snapshot){const profile=snapshot.profile||{};const w=snapshot.w30||snapshot.provisionalSource||{};return Promise.all([idb.get('playerIntelligence',String(snapshot.userId)),idb.get('candidateLocal',String(snapshot.userId))]).then(([player,candidate])=>GlobalCore.sanitizeObservation({playerId:Number(snapshot.userId),name:player?.name||candidate?.name||profile.name||`User ${snapshot.userId}`,observedAt:Number(snapshot.capturedAt||Date.now()),level:player?.level??profile.level,ee:player?.ee??candidate?.ee,activity30:w.activityHours,xanax30:w.xanax,refills30:w.refills,attacks30:w.attacks,rwHits30:w.rwHits,networth:snapshot.extra?.networth,fit:scoutFit(snapshot),fitType:snapshot.official?'official':(snapshot.provisionalSource?'provisional':'unmeasured'),lastActive:profile.lastActionTs?Number(profile.lastActionTs)*1000:null,scoutStatus:ResultsCore.classifyScoutStatus(snapshot)},SCRIPT_VERSION));}
  async function enqueueGlobalObservation(snapshot){const observation=await globalObservation(snapshot);const queueId=GlobalCore.makeQueueId(observation);await idb.put('globalSyncQueue',{queueId,userId:observation.playerId,observation,attempts:0,createdAt:Date.now(),nextRetryAt:0,lastError:''});if(state.settings.global.enabled&&globalEndpoint())void flushGlobalQueue(false);}
  async function testGlobalService(){const endpoint=globalEndpoint();if(!endpoint)throw new Error('Set the Global Intelligence endpoint first.');const join=endpoint.includes('?')?'&':'?';const raw=await globalJson(`${endpoint}${join}action=meta`);const response=GlobalCore.normalizeServiceResponse(raw);if(!response.ok)throw new Error(`Global service error: ${response.code||'unknown'}`);if(Number(response.schemaVersion)!==Number(GlobalCore.GLOBAL_SCHEMA_VERSION))throw new Error(`Global schema mismatch: ${response.schemaVersion} != ${GlobalCore.GLOBAL_SCHEMA_VERSION}`);await logEvent('global','Global service connected',{schemaVersion:response.schemaVersion,serviceVersion:response.serviceVersion});return response;}
  async function flushGlobalQueue(manual=false){if(!state.settings.global.enabled||!globalEndpoint())return{processed:0,pending:(await idb.getAll('globalSyncQueue')).length};const endpoint=globalEndpoint();let processed=0;const rows=(await idb.getAll('globalSyncQueue')).sort((a,b)=>a.createdAt-b.createdAt);for(const item of rows){if(!manual&&Number(item.nextRetryAt||0)>Date.now())continue;try{const raw=await globalJson(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(GlobalCore.buildObservePayload(item.observation,SCRIPT_VERSION))});const normalized=GlobalCore.normalizeServiceResponse(raw);if(GlobalCore.classifyRetry(normalized)==='done'||GlobalCore.classifyRetry(normalized)==='permanent')await idb.delete('globalSyncQueue',item.queueId);else throw new Error(normalized.code||'Global observation rejected');}catch(error){item.attempts=Number(item.attempts||0)+1;item.lastError=text(error.message).slice(0,160);item.nextRetryAt=Date.now()+Math.min(6*60*60*1000,60000*(2**Math.min(item.attempts,8)));await idb.put('globalSyncQueue',item);}processed++;}await logEvent('global','Global sync processed',{processed,pending:(await idb.getAll('globalSyncQueue')).length});return{processed,pending:(await idb.getAll('globalSyncQueue')).length};}

  async function ensureDefaultMatchProfile(){let profiles=await idb.getAll('matchProfiles');if(!profiles.length){const p=MatchCore.createDefaultProfile('Default Recruit');p.createdAt=new Date().toISOString();p.updatedAt=p.createdAt;await idb.put('matchProfiles',p);await saveSettings({match:{...state.settings.match,activeProfileId:p.profileId}});return p;}let active=profiles.find(p=>p.profileId===state.settings.match.activeProfileId)||profiles[0];if(active.profileId!==state.settings.match.activeProfileId)await saveSettings({match:{...state.settings.match,activeProfileId:active.profileId}});return MatchCore.normalizeProfile(active);}
  async function getActiveMatchProfile(){const id=text(state.settings.match.activeProfileId);if(id){const row=await idb.get('matchProfiles',id);if(row)return MatchCore.normalizeProfile(row);}return ensureDefaultMatchProfile();}
  async function saveMatchProfile(profile){const normalized=MatchCore.normalizeProfile(profile);const existing=normalized.profileId?await idb.get('matchProfiles',normalized.profileId):null;const now=new Date().toISOString();normalized.createdAt=existing?.createdAt||normalized.createdAt||now;normalized.updatedAt=now;await idb.put('matchProfiles',normalized);return normalized;}

  function latestSourceFor(candidate,sources){const id=text(candidate.latestForumSourceId);if(id)return sources.find(s=>s.sourceId===id)||null;return sources.filter(s=>String(s.userId)===String(candidate.userId)).sort((a,b)=>Number(b.postedAt||0)-Number(a.postedAt||0))[0]||null;}
  function matchAvailability(value){return value==='Available'?'immediate':value==='Unavailable'?'not_available':'';}
  async function candidateViews(){const candidates=await idb.getAll('candidateLocal');const sources=await idb.getAll('forumSources');const scouts=await idb.getAll('scoutLatest');const scoutMap=new Map(scouts.map(s=>[String(s.userId),s]));const profile=await getActiveMatchProfile();const out=[];for(const raw of candidates){let candidate;try{candidate=Runtime.normalizeCandidateRecord(raw);}catch{continue;}if(!state.settings.includeInactive&&String(candidate.status||'active').toLowerCase()==='inactive')continue;const source=latestSourceFor(candidate,sources)||{};const scout=scoutMap.get(String(candidate.userId))||null;const base={userId:candidate.userId,name:candidate.name||source.authorName||`User ${candidate.userId}`,stats:candidate.stats||{},ee:candidate.ee??null,currentCompany:candidate.currentCompany||'',sourceType:source.sourceType||candidate.discoverySources?.[0]||'MANUAL',lastSeenPost:source.postedAt||candidate.lastSeenPost||null,scout,matchInputs:{fit:scoutFit(scout),activity30:(scout?.w30||scout?.provisionalSource||{}).activityHours,xanax30:(scout?.w30||scout?.provisionalSource||{}).xanax,refills30:(scout?.w30||scout?.provisionalSource||{}).refills,attacks30:(scout?.w30||scout?.provisionalSource||{}).attacks,rwHits30:(scout?.w30||scout?.provisionalSource||{}).rwHits}};const matchCandidate={...candidate,availability:matchAvailability(candidate.availability)};const match=MatchCore.evaluateMatch({row:base,candidate:matchCandidate,profile});const view=Candidates.composeCandidateView({candidate,source,result:{...base,matchScore:match.score,fit:scoutFit(scout),currentCompany:candidate.currentCompany||''},scout,match});view.candidate=candidate;view.source=source;view.scout=scout;view.match=match;view.postedAt=source.postedAt||null;view.activity30=(scout?.w30||scout?.provisionalSource||{}).activityHours??null;view.scoutStatus=ResultsCore.classifyScoutStatus(base);view.total=[view.man,view.int,view.end].reduce((s,x)=>s+(finite(x)||0),0);out.push(view);}return out;}
  function candidateSearchRow(view){return{userId:Number(view.userId),name:view.name,stats:{man:view.man,int:view.int,end:view.end,total:view.total},ee:view.ee,preferredCompany:view.desiredCompany,fit:view.fitScore,matchScore:view.matchScore,pipelineStage:view.pipelineStage,sourceType:view.sourceType,discoverySources:view.candidate?.discoverySources||[],lookingFor:view.lookingFor,currentCompany:view.currentCompany,status:view.candidate?.status||'active',lastSeenPost:view.postedAt,scout:view.scout};}
  function applyCandidateFilters(views){
    const f=state.settings.candidates.filters||{};
    const rows=(views||[]).map(view=>({...candidateSearchRow(view),candidateLocal:view.candidate,__view:view}));
    const filters={
      search:f.search,
      pipelineStage:f.stage,
      sourceType:f.source,
      lookingFor:f.lookingFor,
      currentCompany:f.currentCompany,
      minMatch:f.minMatch,
      minFit:f.minFit,
      minMan:f.minMan,
      minInt:f.minInt,
      minEnd:f.minEnd,
      minActivity30:f.minActivity30,
      activeOnly:!!f.activeOnly,
      activeAgeDays:state.settings.recruitment.candidateActiveAgeDays
    };
    const processed=ResultsCore.processRows(rows,filters,ResultsCore.DEFAULT_SORT,Date.now());
    return processed.map(row=>row.__view);
  };

  async function migrateLegacyUsers(){const users=await idb.getAll('users');if(!users.length)return;let created=0,factionCreated=0;for(const row of users){const userId=text(row.userId);if(!/^\d+$/.test(userId))continue;const faction=row.sourceMode==='faction';const candidate=faction?null:await idb.get('candidateLocal',userId);const sourceType=faction?'FACTION FORUM':'COMPANY FORUM';const observedAt=Number(row.lastSeenPost||Date.now());const source=ForumCore.normalizeSource({sourceType,threadId:text(row.threadId),postId:text(row.postId||'legacy'),userId:Number(userId),postedAt:observedAt,postUrl:forumThreadUrl(row.threadId),text:text(row.rawText),parsed:ForumCore.parseForumIntent(row.rawText||'')});source.authorName=text(row.name);await idb.put('forumSources',source);const merged=ForumCore.mergeCandidateFromSource(candidate||{userId,pipelineStage:'Not Contacted'},source);merged.userId=userId;merged.name=candidate?.name||text(row.name)||`User ${userId}`;merged.stats=candidate?.stats||row.stats||{};merged.ee=candidate?.ee??row.ee??null;merged.status=candidate?.status||row.status||'active';merged.latestForumSourceId=source.sourceId;if(faction){await repositories.faction.ensure(userId,{pipelineStage:'Prospect',availability:merged.availability,discoverySources:merged.discoverySources,latestForumSourceId:source.sourceId},{sharedPatch:{name:merged.name,ee:merged.ee},source:'legacy-user-faction',observedAt});factionCreated++;continue;}await idb.put('candidateLocal',merged);await repositories.company.ensure(userId,merged,{sharedPatch:{name:merged.name,ee:merged.ee},source:'legacy-user-company',observedAt});if(!candidate)created++;}if(created||factionCreated)await logEvent('migration','Legacy forum candidates migrated',{created,factionCreated});}

  function recruitmentDomainForFeed(feed={}){const feedId=text(feed.feedId).toLowerCase();const sourceType=text(feed.sourceType).toUpperCase();return feedId==='faction'||sourceType==='FACTION FORUM'?'faction':'company';}
  async function persistDiscoveredCandidate(feed,candidate,source){const userId=V46Domain.normalizeUserId(candidate?.userId);const observedAt=Number(source?.observedAt||source?.postedAt||Date.now());const domain=recruitmentDomainForFeed(feed);if(domain==='company'){const row={...candidate,userId};await idb.put('candidateLocal',row);await repositories.company.ensure(userId,row,{sharedPatch:{name:row.name},source:'company-discovery',observedAt});return row;}const existing=await idb.get('factionRecruitment',userId);const discoverySources=[...new Set([...(Array.isArray(existing?.discoverySources)?existing.discoverySources:[]),...(Array.isArray(candidate?.discoverySources)?candidate.discoverySources:[]),text(source?.sourceType)].filter(Boolean))];let availability=existing?.availability||'Unknown';if((!existing||availability==='Unknown')&&candidate?.availability)availability=candidate.availability;const patch={availability,recruiterNote:existing?.recruiterNote??candidate?.recruiterNote??'',discoverySources,latestForumSourceId:text(source?.sourceId||candidate?.latestForumSourceId||existing?.latestForumSourceId),updatedAt:candidate?.updatedAt||new Date(observedAt).toISOString()};if(existing?.pipelineStage)patch.pipelineStage=existing.pipelineStage;await repositories.faction.ensure(userId,patch,{sharedPatch:{name:candidate?.name,ee:candidate?.ee,man:candidate?.stats?.man??candidate?.man,int:candidate?.stats?.int??candidate?.int,end:candidate?.stats?.end??candidate?.end,total:candidate?.stats?.total??candidate?.total,lastActive:candidate?.lastActive},source:'faction-discovery',observedAt});return idb.get('factionRecruitment',userId);}
  async function fetchForumPage(feed,checkpoint,from,to){if(checkpoint?.next)return tornContinuation(checkpoint.next);return tornRequest(`forum/${feed.threadId}/posts`,{limit:PAGE_SIZE,sort:'DESC',from,to});}
  async function getDiscoveryCandidate(domain,userId){const id=String(userId);if(domain!=="faction")return await idb.get("candidateLocal",id)||await idb.get("candidateLocal",Number(userId));const[record,player]=await Promise.all([idb.get("factionRecruitment",id),idb.get("playerIntelligence",id)]);if(!record)return null;const stats={};for(const key of ["man","int","end","total"]){const value=finite(player?.[key]);if(value!==null)stats[key]=value;}return Object.keys(stats).length?{...record,stats}:record;}
  async function syncFeed(feed){let checkpoint=await idb.get('forumSyncState',feed.feedId);let counters=Discovery.initialCounters(checkpoint?.counters||{});const recentCutoff=Date.now()-state.settings.recruitment.recentImportDays*86400000;const from=Math.floor(recentCutoff/1000),to=Math.floor(Date.now()/1000);const maxPages=state.settings.recruitment.maxPagesPerFeed;const domain=recruitmentDomainForFeed(feed);for(let page=0;page<maxPages&&!state.sync.cancelled;page++){state.sync.feed=feed.feedId;state.sync.pages=page+1;refreshDiscoverRuntimeUi(counters,feed);const data=await fetchForumPage(feed,checkpoint,from,to);const posts=Array.isArray(data?.posts)?data.posts:[];if(!posts.length)break;const continuation=data?._metadata?.links?.next||'';const result=await Discovery.processDiscoveryPage({feed,posts,continuation,counters,recentCutoff,observedAt:Date.now(),persistSource:async source=>{if(!source.postUrl)source.postUrl=forumThreadUrl(feed.threadId);await idb.put('forumSources',source);},getCandidate:async userId=>getDiscoveryCandidate(domain,userId),persistCandidate:async(candidate,source)=>persistDiscoveredCandidate(feed,candidate,source),persistCounters:async next=>{counters=next;},persistCheckpoint:async cp=>{checkpoint=cp;await idb.put('forumSyncState',cp);}});counters=result.counters;await logEvent('forum','Forum page imported',{feedId:feed.feedId,pagesChecked:counters.pagesChecked,postsExamined:counters.postsExamined,candidatesCreated:counters.candidatesCreated,candidatesUpdated:counters.candidatesUpdated});if(!result.safeContinuation)break;}return counters;}
  async function syncForums(){if(state.sync.running)throw new Error('Forum sync is already running.');state.sync={running:true,cancelled:false,feed:'',pages:0};let aggregate=Discovery.initialCounters();try{for(const feed of Discovery.feedDefinitions(state.settings.recruitment).filter(f=>f.enabled)){if(state.sync.cancelled)break;const counters=await syncFeed(feed);for(const key of Object.keys(aggregate))aggregate[key]=Math.max(aggregate[key],Number(counters[key]||0));}toast(state.sync.cancelled?'Forum sync stopped. Resume available.':'Forum sync complete.');}catch(error){toast(`Forum sync stopped: ${error.message}`,true);await logEvent('error','Forum sync failed',{feedId:state.sync.feed,error:text(error.message)});}finally{state.sync.running=false;refreshDiscoverRuntimeUi(aggregate);if(state.page==='company-discover'||state.page==='company-candidates'||state.page==='company-overview')await route(state.page,false);}return aggregate;}
  async function syncDomainForums(domain){
    const normalized=text(domain).toLowerCase()==='faction'?'faction':'company';
    if(state.sync.running)throw new Error('Forum sync is already running.');
    state.sync={running:true,cancelled:false,feed:'',pages:0};
    let aggregate=Discovery.initialCounters();
    try{
      const feeds=Discovery.feedDefinitions(state.settings.recruitment).filter(feed=>feed.enabled&&recruitmentDomainForFeed(feed)===normalized);
      for(const feed of feeds){
        if(state.sync.cancelled)break;
        const counters=await syncFeed(feed);
        for(const key of Object.keys(aggregate))aggregate[key]=Math.max(Number(aggregate[key]||0),Number(counters[key]||0));
      }
      return aggregate;
    }finally{
      state.sync.running=false;
      refreshDiscoverRuntimeUi(aggregate);
    }
  }

  function normalizeApiSearchCandidate(raw={}){
    const value=raw?.profile||raw||{};
    const userId=V46Domain.normalizeUserId(value.id??value.user_id??value.userId);
    const lastAction=value.last_action||{};
    const lastActionTs=Number(lastAction.timestamp);
    const factionRaw=value.faction_id??value.factionId;
    const factionId=factionRaw===null||factionRaw===undefined||factionRaw===''?null:Number(factionRaw);
    return{
      id:Number(userId),userId,name:text(value.name)||`User ${userId}`,level:finite(value.level),
      factionId:Number.isFinite(factionId)?factionId:null,
      onlineStatus:text(value.online??lastAction.status),
      lastActive:Number.isFinite(lastActionTs)&&lastActionTs>0?lastActionTs*1000:null
    };
  }

  async function persistApiSearchCandidate(domain,raw){
    const normalizedDomain=text(domain).toLowerCase()==='faction'?'faction':'company';
    const candidate=normalizeApiSearchCandidate(raw);
    const observedAt=Date.now();
    const store=normalizedDomain==='faction'?'factionRecruitment':'companyRecruitment';
    const existing=await idb.get(store,candidate.userId);
    const discoverySources=[...new Set([...(Array.isArray(existing?.discoverySources)?existing.discoverySources:[]),'TORN API SEARCH'])];
    const sharedPatch={name:candidate.name};
    if(candidate.level!==null)sharedPatch.level=candidate.level;
    if(candidate.factionId!==null)sharedPatch.factionId=candidate.factionId;
    if(candidate.onlineStatus)sharedPatch.onlineStatus=candidate.onlineStatus;
    if(candidate.lastActive!==null)sharedPatch.lastActive=candidate.lastActive;
    const patch={
      pipelineStage:existing?.pipelineStage||(normalizedDomain==='faction'?'Prospect':'Not Contacted'),
      availability:existing?.availability||'Unknown',
      recruiterNote:existing?.recruiterNote||'',
      discoverySources,
      updatedAt:observedAt
    };
    return repositories[normalizedDomain].ensure(candidate.userId,patch,{sharedPatch,source:'api-search',observedAt});
  }

  async function searchCandidates(domain,filters={},deps={}){
    const normalizedDomain=text(domain).toLowerCase()==='faction'?'faction':'company';
    const sync=deps.syncDomainForums||syncDomainForums;
    const request=deps.tornRequest||tornRequest;
    const persist=deps.persistApiCandidate||persistApiSearchCandidate;
    const injected=Object.keys(deps).length>0;
    const warnings=[];
    let forum=Discovery.initialCounters();
    let apiCount=0;
    try{forum=await sync(normalizedDomain);}catch(error){warnings.push(`Forum: ${text(error.message||error)}`);}
    try{
      const query=text(filters.search);
      let response;
      let candidates=[];
      if(/^\d+$/.test(query)){
        response=await request(`user/${query}/profile`,{});
        if(response?.profile)candidates=[response.profile];
      }else{
        const params=query?{name:query}:{filters:'lastActionRecent'};
        response=await request('user/search',params);
        candidates=Array.isArray(response?.search)?response.search:[];
      }
      for(const candidate of candidates){await persist(normalizedDomain,candidate);apiCount++;}
    }catch(error){warnings.push(`Torn API: ${text(error.message||error)}`);}
    if(warnings.length>=2)throw new Error(`Candidate search failed. ${warnings.join(' | ')}`);
    if(!injected){
      await logEvent('search','Active candidate search completed',{domain:normalizedDomain,forumPosts:Number(forum.postsExamined||0),forumCreated:Number(forum.candidatesCreated||0),apiCount,warnings});
      const summary=`Search complete: forum ${Number(forum.postsExamined||0)} post(s), Torn API ${apiCount} user(s).`;
      toast(warnings.length?`${summary} ${warnings.join(' | ')}`:summary,warnings.length>0);
    }
    return{domain:normalizedDomain,forum,apiCount,warnings};
  }
  function cancelSync(){if(state.sync.running){state.sync.cancelled=true;toast('Cancelling forum sync after the current safe page.');}}

  async function fillCompanies(){if(state.fill.running)throw new Error('Company fill is already running.');const views=await candidateViews();const plan=Discovery.fillCompaniesPlan(views.map(v=>({...v.candidate,currentCompany:v.currentCompany})));state.fill={running:true,cancelled:false,done:0,total:plan.length,errors:[]};refreshDiscoverRuntimeUi();try{for(const item of plan){if(state.fill.cancelled)break;try{const data=await tornRequest(`user/${item.userId}/job`);const job=data?.job||data?.user?.job||null;const candidate=await idb.get('candidateLocal',String(item.userId))||await idb.get('candidateLocal',Number(item.userId));if(candidate){const company=job&&String(job.type||'').toLowerCase()==='company'?job:null;candidate.currentCompany=company?.name||'';candidate.currentCompanyId=company?.id??null;candidate.currentCompanyRating=company?.rating??null;candidate.currentCompanyPosition=company?.position||'';candidate.companyCheckedAt=Date.now();candidate.updatedAt=new Date().toISOString();await idb.put('candidateLocal',candidate);await repositories.players.ensure(String(item.userId),{name:candidate.name,ee:candidate.ee,currentCompany:candidate.currentCompany,currentCompanyId:candidate.currentCompanyId,currentCompanyRating:candidate.currentCompanyRating,currentCompanyPosition:candidate.currentCompanyPosition,companyCheckedAt:candidate.companyCheckedAt},'company-enrichment',candidate.companyCheckedAt);}}catch(error){state.fill.errors.push({userId:item.userId,error:text(error.message)});}finally{state.fill.done++;refreshDiscoverRuntimeUi();}}await logEvent('company-fill','Fill Companies completed',{checked:state.fill.done,errors:state.fill.errors.length});toast(state.fill.cancelled?'Company fill stopped.':`Company fill complete: ${state.fill.done}/${state.fill.total}.`,state.fill.errors.length>0);}finally{state.fill.running=false;if(state.page==='company-discover'||state.page==='company-candidates')await route(state.page,false);}}
  function cancelFill(){if(state.fill.running){state.fill.cancelled=true;toast('Cancelling company lookup after current request.');}}

  function stageColor(stage){return state.settings.recruitment.stageColors?.[stage]||Runtime.STAGE_COLORS[stage]||'#64748b';}
  function availabilityColor(value){return state.settings.recruitment.availabilityColors?.[value]||Runtime.AVAILABILITY_COLORS[value]||'#64748b';}
  function lastActiveText(view){const ts=finite(view.lastActive);if(ts===null)return '—';const seconds=Math.max(0,Math.floor(Date.now()/1000-ts));if(seconds<60)return `${seconds}s`;if(seconds<3600)return `${Math.floor(seconds/60)}m`;if(seconds<86400)return `${Math.floor(seconds/3600)}h`;return `${Math.floor(seconds/86400)}d`;}
  function scoreText(value){return finite(value)===null?'—':Number(value).toFixed(1);}
  function pill(label,color){return `<span class="ra-pill" style="--pill:${esc(color)}">${esc(label||'Unknown')}</span>`;}
  function helpButton(key){const item=Runtime.HELP_REGISTRY[key];return item?`<button type="button" class="ra-help" data-help-key="${esc(key)}" aria-label="About ${esc(item.title)}">i</button>`:'';}
  function panel(title,description,body,helpKey=''){return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${helpKey?helpButton(helpKey):''}</div>${body}</section>`;}
  function biohazardSvg(){return '<svg class="ra-biohazard" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="31" r="5" fill="currentColor"/><circle cx="32" cy="17" r="11" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="20" cy="39" r="11" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="44" cy="39" r="11" fill="none" stroke="currentColor" stroke-width="5"/><path d="M29 23 23 34M35 23l6 11M27 43h10" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';}
  function icon(id){return({overview:'⌂',discover:'⌕',candidates:'◎',pipeline:'▦',scout:'◈','smart-match':'◇','global-intelligence':'◉',settings:'⚙',data:'▤',logs:'≡'})[id]||'•';}

  function injectStyles(){if(document.getElementById('ra-v45-css'))return;const style=document.createElement('style');style.id='ra-v45-css';style.textContent=`
:root{--ra-bg:#0b0b0d;--ra-panel:#121216;--ra-panel2:#1a1a20;--ra-line:#303038;--ra-line-strong:#454550;--ra-text:#f0f0f3;--ra-muted:#a3a3ad;--ra-accent:#b94a4a;--ra-accent2:#d86a6a;--ra-danger:#e25d63;--ra-warn:#d6a64d;--ra-pad:14px;--ra-font:12px}
:root[data-ra-theme="light"]{--ra-bg:#f3f3f5;--ra-panel:#fff;--ra-panel2:#f7f7f9;--ra-line:#d0d0d7;--ra-line-strong:#ababB5;--ra-text:#17171b;--ra-muted:#656570;--ra-accent:#9e3737;--ra-accent2:#b94a4a;--ra-danger:#b4232a;--ra-warn:#8c5b13}
:root[data-ra-density="compact"]{--ra-pad:8px}:root[data-ra-text="small"]{--ra-font:11px}:root[data-ra-text="large"]{--ra-font:14px}
#ra-app,#ra-launch,#ra-context,#ra-help-popover,#ra-toastbox{font:var(--ra-font)/1.4 Arial,sans-serif;color:var(--ra-text);box-sizing:border-box}#ra-app *{box-sizing:border-box}
#ra-launch{position:fixed;right:12px;bottom:72px;z-index:2147483645;width:48px;height:48px;border-radius:12px;border:1px solid var(--ra-line-strong);background:linear-gradient(145deg,#1b1b20,#101013);color:var(--ra-accent2);font-weight:900;cursor:pointer;display:none;box-shadow:0 10px 30px #0008,inset 0 1px 0 #ffffff0b}
#ra-app{position:fixed;left:6vw;top:5vh;width:88vw;height:86vh;z-index:2147483401;background:var(--ra-bg);border:1px solid var(--ra-line-strong);border-radius:14px;box-shadow:0 24px 72px #000c,0 0 0 1px #ffffff05;display:none;resize:both;overflow:hidden;min-width:560px;min-height:420px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px)}
.ra-titlebar{height:50px;padding:0 12px 0 16px;display:flex;align-items:center;justify-content:space-between;background:linear-gradient(180deg,#17171c,#111115);border-bottom:1px solid var(--ra-line);cursor:move}.ra-title-brand{display:flex;align-items:center;gap:10px;min-width:0}.ra-title-mark{width:24px;height:24px;display:grid;place-items:center;border:1px solid #743333;border-radius:7px;color:var(--ra-accent2);font-size:13px;box-shadow:inset 0 0 12px #b94a4a18}.ra-title-copy{display:grid;line-height:1.05}.ra-title-copy small{font-size:8px;letter-spacing:.16em;color:var(--ra-muted);font-weight:800}.ra-title-copy strong{font-size:12px;letter-spacing:.05em;color:var(--ra-text)}.ra-version{font-size:9px;color:var(--ra-muted);font-weight:600;margin-left:4px}.ra-title-actions,.ra-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ra-shell{display:grid;grid-template-columns:196px minmax(0,1fr);height:calc(100% - 50px);position:relative}.ra-shell.is-collapsed{grid-template-columns:58px minmax(0,1fr)}
.ra-sidebar{background:linear-gradient(180deg,#141419,#101014);border-right:1px solid var(--ra-line);overflow:auto;padding:10px}.ra-sidebar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.ra-brand{font-weight:900;font-size:10px;letter-spacing:.08em;color:var(--ra-muted)}.is-collapsed .ra-brand,.is-collapsed .ra-group-label,.is-collapsed .ra-nav-text,.is-collapsed .ra-domain-switch span{display:none}.ra-domain-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:#09090b;border:1px solid var(--ra-line);border-radius:9px;margin-bottom:12px}.ra-domain-switch button{border:0;border-radius:6px;padding:8px 6px;background:transparent;color:var(--ra-muted);font-size:10px;font-weight:800;cursor:pointer}.ra-domain-switch button.active{background:linear-gradient(180deg,#6e2d2d,#4e2020);color:#fff;box-shadow:inset 0 1px 0 #ffffff18}.is-collapsed .ra-domain-switch{grid-template-columns:1fr;padding:3px}.is-collapsed .ra-domain-switch button:not(.active){display:none}.ra-group-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;border:0;border-radius:6px;padding:7px 8px;background:transparent;color:var(--ra-muted);cursor:pointer;text-align:left}.ra-group-toggle:hover,.ra-group-toggle:focus-visible{background:var(--ra-panel2);outline:none}.ra-group-toggle.has-active{color:var(--ra-accent2)}.ra-group-label{font-size:9px;font-weight:900;letter-spacing:.08em;color:inherit;margin:0}.ra-group-chevron{font-size:11px;font-weight:900;line-height:1}.ra-nav{display:grid;gap:3px}.ra-nav[hidden]{display:none}.ra-nav button{display:flex;align-items:center;gap:8px;border:0;border-radius:7px;padding:9px 8px;background:transparent;color:var(--ra-text);cursor:pointer;text-align:left}.ra-nav button:hover,.ra-nav button.active{background:#ffffff08}.ra-nav button.active{box-shadow:inset 3px 0 0 var(--ra-accent);color:#fff}.ra-nav-icon{width:18px;color:var(--ra-accent2);font-weight:900;text-align:center}
.ra-main{min-width:0;display:flex;flex-direction:column}.ra-pagehead{padding:12px 15px;background:var(--ra-panel);border-bottom:1px solid var(--ra-line);display:flex;justify-content:space-between;align-items:center;gap:8px}.ra-pagehead h2{margin:0;font-size:17px}.ra-pagehead p{margin:2px 0 0;color:var(--ra-muted)}.ra-content{overflow:auto;flex:1;padding:var(--ra-pad)}
.ra-panel,.ra-kpi{border:1px solid var(--ra-line);border-radius:10px;background:linear-gradient(180deg,#15151a,#111115);padding:14px;box-shadow:inset 0 1px 0 #ffffff05}.ra-panel{margin-bottom:12px}.ra-search-panel{border-color:#3c3034}.ra-results-panel{padding:0;overflow:hidden}.ra-results-panel>.ra-panel-head{padding:14px 14px 0}.ra-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}.ra-panel-head h3{margin:0;font-size:14px;letter-spacing:.02em}.ra-panel-head p{margin:3px 0 0;color:var(--ra-muted);font-size:10px}.ra-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ra-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.ra-kpi span{display:block;color:var(--ra-muted);font-size:9px;text-transform:uppercase;font-weight:900}.ra-kpi b{font-size:20px}.ra-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ra-core-search-grid{grid-template-columns:repeat(4,minmax(120px,1fr));margin-bottom:10px}.ra-field label{display:block;color:var(--ra-muted);font-size:9px;text-transform:uppercase;font-weight:900;margin-bottom:4px;letter-spacing:.06em}.ra-field input,.ra-field select,.ra-field textarea{width:100%;padding:8px 9px;border-radius:7px;border:1px solid var(--ra-line);background:#0d0d11;color:var(--ra-text);outline:none}.ra-field input:focus,.ra-field select:focus,.ra-field textarea:focus{border-color:var(--ra-accent);box-shadow:0 0 0 2px #b94a4a20}.ra-field textarea{min-height:76px;resize:vertical}.ra-optional-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}.ra-optional-toggle{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid var(--ra-line);border-radius:7px;background:var(--ra-panel2);color:var(--ra-text)}
.ra-btn{border:1px solid var(--ra-line);border-radius:7px;background:var(--ra-panel2);color:var(--ra-text);padding:6px 9px;cursor:pointer;font-weight:700;text-decoration:none}.ra-btn:hover{border-color:var(--ra-accent)}.ra-primary{border-color:var(--ra-accent);background:color-mix(in srgb,var(--ra-accent) 20%,var(--ra-panel2))}.ra-danger{border-color:var(--ra-danger);color:var(--ra-danger)}.ra-help{display:inline-grid;place-items:center;width:20px;height:20px;padding:0;border:1px solid var(--ra-line);border-radius:50%;background:var(--ra-panel2);color:var(--ra-muted);cursor:pointer;flex:0 0 auto}.ra-muted{color:var(--ra-muted)}.ra-note{font-size:10px;color:var(--ra-muted)}
.ra-pill{display:inline-block;border:1px solid color-mix(in srgb,var(--pill) 70%,var(--ra-line));background:color-mix(in srgb,var(--pill) 16%,transparent);border-radius:999px;padding:2px 6px;white-space:nowrap}.ra-table-wrap{overflow:auto;border:1px solid var(--ra-line);border-radius:8px}.ra-table{border-collapse:collapse;width:100%;min-width:900px}.ra-table th,.ra-table td{padding:7px;border-bottom:1px solid var(--ra-line);white-space:nowrap;text-align:left}.ra-table th{position:sticky;top:0;background:var(--ra-panel2);z-index:2}.ra-sort-button{all:unset;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:inherit;font:inherit;font-weight:800}.ra-sort-button:hover,.ra-sort-button:focus-visible{color:var(--ra-accent2)}.ra-sort-button:focus-visible{outline:2px solid var(--ra-accent);outline-offset:2px;border-radius:3px}.ra-online-live,.ra-online-idle,.ra-online-offline{display:inline-flex;align-items:center;gap:5px;font-weight:800}.ra-online-live:before,.ra-online-idle:before,.ra-online-offline:before{content:"";width:7px;height:7px;border-radius:50%}.ra-online-live:before{background:#45c486;box-shadow:0 0 0 3px #45c4861f}.ra-online-idle:before{background:#d7a84b}.ra-online-offline:before{background:#777781}.ra-table tr{background:color-mix(in srgb,var(--row-tint,transparent) 7%,transparent)}.ra-link{color:var(--ra-accent2);text-decoration:none}.ra-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}.ra-card{border:1px solid var(--ra-line);border-radius:9px;background:var(--ra-panel2);padding:10px}.ra-card h4{margin:0}.ra-card-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin:8px 0}.ra-card-grid span{color:var(--ra-muted)}.ra-card-grid b{display:block;color:var(--ra-text)}
.ra-hover{position:fixed;z-index:2147483646;width:min(390px,calc(100vw - 12px));max-height:calc(100vh - 12px);overflow:auto;background:var(--ra-panel);border:1px solid var(--ra-line);border-radius:9px;box-shadow:0 12px 32px #000a;padding:10px}.ra-hover[hidden]{display:none}.ra-hover-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-top:7px}.ra-hover-grid span{color:var(--ra-muted)}.ra-hover-grid b{display:block;color:var(--ra-text)}
.ra-pipeline{display:grid;grid-template-columns:repeat(6,minmax(230px,1fr));gap:8px;overflow:auto;padding-bottom:4px}.ra-stage{min-height:220px;border:1px solid var(--ra-line);border-top:3px solid var(--stage);border-radius:8px;background:var(--ra-panel);padding:7px}.ra-stage-head{display:flex;justify-content:space-between;gap:6px;margin-bottom:7px}.ra-stage-card{border:1px solid var(--ra-line);border-radius:7px;padding:8px;background:var(--ra-panel2);margin:6px 0;cursor:grab}.ra-stage-card.subdued{opacity:.68}.ra-stage-drop{min-height:120px}.ra-drawer{position:absolute;right:0;top:0;bottom:0;width:min(460px,94%);z-index:12;background:var(--ra-panel);border-left:1px solid var(--ra-line);box-shadow:-12px 0 30px #0007;overflow:auto;padding:12px}.ra-drawer[hidden]{display:none}.ra-drawer-head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:-12px;background:var(--ra-panel);padding:10px 0;z-index:2}.ra-detail-section{border-top:1px solid var(--ra-line);padding-top:8px;margin-top:8px}.ra-detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}.ra-detail-grid span{color:var(--ra-muted)}.ra-detail-grid b{display:block;color:var(--ra-text)}
#ra-context{position:fixed;z-index:2147483647;min-width:220px;background:var(--ra-panel);border:1px solid var(--ra-line);border-radius:8px;box-shadow:0 12px 30px #000a;padding:5px}#ra-context[hidden]{display:none}.ra-menu-item{display:block;width:100%;padding:7px;border:0;background:transparent;color:var(--ra-text);text-align:left;border-radius:5px;cursor:pointer}.ra-menu-item:hover,.ra-menu-item:focus{background:var(--ra-panel2)}.ra-menu-sep{border-top:1px solid var(--ra-line);margin:4px 0}.ra-submenu{padding-left:12px}.ra-submenu[hidden]{display:none}
.ra-modal{position:absolute;inset:0;z-index:15;background:#0009;display:grid;place-items:center;padding:18px}.ra-modal[hidden]{display:none}.ra-modal-card{width:min(620px,96%);max-height:92%;overflow:auto;background:var(--ra-panel);border:1px solid var(--ra-line);border-radius:10px;padding:12px}.ra-modal-card h3{margin-top:0}.ra-log{font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;max-height:280px;overflow:auto;background:#050806;border:1px solid var(--ra-line);border-radius:7px;padding:8px}.ra-progress{height:8px;background:var(--ra-line);border-radius:99px;overflow:hidden}.ra-progress>div{height:100%;background:var(--ra-accent);width:0}.ra-source-card{border:1px solid var(--ra-line);border-radius:8px;padding:9px;background:var(--ra-panel2)}.ra-source-card b{display:block}.ra-source-card small{color:var(--ra-muted)}
.ra-settings details{border:1px solid var(--ra-line);border-radius:8px;background:var(--ra-panel);margin:7px 0;padding:8px}.ra-settings summary{font-weight:900;cursor:pointer}.ra-settings-body{padding-top:8px}.ra-color-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.ra-color-row{display:flex;align-items:center;gap:6px}.ra-color-row input[type=color]{width:38px;height:28px;padding:1px}.ra-danger-zone{border-color:var(--ra-danger)!important}.ra-nuke{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ra-danger);background:color-mix(in srgb,var(--ra-danger) 16%,var(--ra-panel2));color:var(--ra-danger);font-weight:900;border-radius:8px;padding:9px 12px;cursor:pointer}.ra-biohazard{width:24px;height:24px}.ra-help-popover{position:fixed;z-index:2147483647;max-width:min(340px,calc(100vw - 16px));padding:10px;border:1px solid var(--ra-accent);border-radius:8px;background:var(--ra-panel);box-shadow:0 10px 30px #0009}.ra-help-popover[hidden]{display:none}.ra-toastbox{position:fixed;right:12px;top:12px;z-index:2147483647;display:grid;gap:6px}.ra-toast{max-width:360px;border:1px solid var(--ra-line);border-left:3px solid var(--ra-accent);background:var(--ra-panel);padding:9px;border-radius:7px;box-shadow:0 8px 24px #0008}.ra-toast.bad{border-left-color:var(--ra-danger)}
@media(max-width:1200px){.ra-pipeline{grid-template-columns:repeat(3,minmax(230px,1fr))}}@media(max-width:900px){#ra-app{left:3vw;top:4vh;width:94vw;height:90vh}.ra-shell{grid-template-columns:58px minmax(0,1fr)}.ra-brand,.ra-group-label,.ra-nav-text{display:none}.ra-kpis{grid-template-columns:repeat(2,1fr)}.ra-color-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){#ra-app{left:4px;top:44px;width:calc(100vw - 8px);height:calc(100vh - 52px);min-width:0;min-height:0}.ra-shell{grid-template-columns:minmax(0,1fr)}.ra-sidebar{position:absolute;left:0;top:0;bottom:0;width:230px;z-index:10;transform:translateX(-105%);transition:transform .15s}.ra-shell.sidebar-open .ra-sidebar{transform:translateX(0)}.ra-brand,.ra-group-label,.ra-nav-text{display:initial}.ra-grid,.ra-formgrid,.ra-kpis,.ra-detail-grid,.ra-color-grid{grid-template-columns:1fr}.ra-pipeline{display:block}.ra-stage{display:none}.ra-stage.mobile-active{display:block}.ra-drawer{width:100%}.ra-pagehead{align-items:flex-start}}
`;document.head.appendChild(style);}

  function applyTheme(){const root=document.documentElement;root.dataset.raTheme=state.settings.theme;root.dataset.raDensity=state.settings.density;root.dataset.raText=state.settings.textSize;}
  function toast(message,bad=false){const box=document.getElementById('ra-toastbox');if(!box)return;const item=document.createElement('div');item.className=`ra-toast${bad?' bad':''}`;item.textContent=message;box.appendChild(item);setTimeout(()=>item.remove(),3800);}
  function activeDomain(){if(String(state.page||'').startsWith('faction-'))return 'faction';if(String(state.page||'').startsWith('company-'))return 'company';return state.settings.activeDomain==='faction'?'faction':'company';}
  function navHtml(){const domain=activeDomain();const expanded=new Set(state.settings.navigation?.expandedGroups||[]);const groups=V46Navigation.visibleGroups(state.settings);const domainId=`${domain}-recruitment`;const visible=groups.filter(group=>group.id===domainId||group.id==='intelligence'||group.id==='application');const domainSwitch=`<div class="ra-domain-switch" role="group" aria-label="Recruitment type"><button type="button" data-domain="company" class="${domain==='company'?'active':''}" aria-pressed="${domain==='company'}"><span>Company</span></button><button type="button" data-domain="faction" class="${domain==='faction'?'active':''}" aria-pressed="${domain==='faction'}"><span>Faction</span></button></div>`;const sections=visible.map(group=>{const core=group.id===domainId;if(core)return `<div class="ra-nav-section"><div class="ra-group-label" style="padding:6px 8px">${esc(group.label)}</div><div class="ra-nav">${group.pages.map(page=>`<button type="button" data-page="${esc(page.id)}"><span class="ra-nav-icon">${esc(icon(page.id))}</span><span class="ra-nav-text">${esc(page.label)}</span></button>`).join('')}</div></div>`;const open=expanded.has(group.id);const hasActive=group.pages.some(page=>page.id===state.page);return `<div class="ra-nav-section"><button type="button" class="ra-group-toggle${hasActive?' has-active':''}" data-nav-toggle="${esc(group.id)}" aria-expanded="${open?'true':'false'}"><span class="ra-group-label">${esc(group.label)}</span><span class="ra-group-chevron" aria-hidden="true">${open?'▾':'▸'}</span></button><div class="ra-nav" data-nav-group="${esc(group.id)}" ${open?'':'hidden'}>${group.pages.map(page=>`<button type="button" data-page="${esc(page.id)}"><span class="ra-nav-icon">${esc(icon(page.id))}</span><span class="ra-nav-text">${esc(page.label)}</span></button>`).join('')}</div></div>`;}).join('');return domainSwitch+sections;}
  function rebuildNav(){const target=document.getElementById('ra-nav');if(target)target.innerHTML=navHtml();document.querySelector('.ra-shell')?.classList.toggle('is-collapsed',!!state.settings.sidebarCollapsed);target?.querySelectorAll('[data-domain]').forEach(button=>button.onclick=async()=>{const domain=button.dataset.domain==='faction'?'faction':'company';await saveSettings({activeDomain:domain,activePage:`${domain}-candidates`});await route(`${domain}-candidates`,false);});target?.querySelectorAll('[data-nav-toggle]').forEach(button=>button.onclick=async()=>{const expanded=V46Navigation.toggleExpandedGroup(state.settings.navigation.expandedGroups,button.dataset.navToggle);await saveSettings({navigation:{...state.settings.navigation,expandedGroups:expanded}});rebuildNav();});target?.querySelectorAll('[data-page]').forEach(btn=>btn.onclick=()=>route(btn.dataset.page).catch(e=>toast(e.message,true)));V46CompanyPlatform.syncNavigation?.();V47FactionPlatform.syncNavigation?.();target?.querySelector(`[data-page="${state.page}"]`)?.classList.add('active');}

  function pageMeta(page){return({'company-overview':['Company Overview','Company recruitment status and work needing attention.'],'company-today':['Company Today','Prioritized Company recruitment work for today.'],'company-discover':['Company Discover','Sync Company recruitment sources and enrich Company candidates.'],'company-candidates':['Company Candidates','Search, filter and manage Company recruitment candidates.'],'company-pipeline':['Company Pipeline','Move Company candidates through explicit recruitment stages.'],'company-vacancies':['Company Vacancies','Define and manage Company hiring needs.'],'company-campaigns':['Company Campaigns','Organize Company recruitment campaigns.'],'company-followups':['Company Follow-ups','Track Company candidate follow-ups.'],'company-timeline':['Company Timeline','Review Company recruitment history.'],'company-stage-aging':['Company Stage Aging','Review candidates aging in their current Company stage.'],'company-contact-outcomes':['Company Contact Outcomes','Track Company recruitment contact outcomes.'],'company-recruitment-sessions':['Company Recruitment Sessions','Work focused Company recruitment queues.'],'company-talent-pool':['Company Talent Pool','Maintain reusable Company talent prospects.'],'company-reactivation':['Company Reactivation','Restart Company recruitment cycles without duplicating identity.'],'company-opportunity':['Company Opportunity Queue','Review explainable Company recruitment opportunities.'],'company-compare':['Company Compare','Compare Company candidates side by side.'],scout:['Scout','Collect official Torn player intelligence through the shared scheduler.'],'smart-match':['Smart Match','Build local vacancy profiles and explain candidate Match scores.'],'global-intelligence':['Global Intelligence','Review the sanitized shared intelligence service.'],settings:['Settings','Application, recruitment, Scout, candidate and privacy configuration.'],data:['Data','Local IndexedDB counts, export and reset controls.'],logs:['Logs','Sanitized Recruitment Agency diagnostic events.']})[page]||['Company Overview','Recruitment Agency'];}

  async function renderOverview(){const views=await candidateViews();const sources=await idb.getAll('forumSources');const k=Runtime.kpiCounts(views.map(v=>({...v.candidate,matchScore:v.matchScore})));const recent=[...views].sort((a,b)=>Number(b.postedAt||0)-Number(a.postedAt||0)).slice(0,6);const need=views.filter(v=>['Not Contacted','Shortlisted','Replied'].includes(v.pipelineStage)).slice(0,6);return `<div class="ra-kpis"><div class="ra-kpi"><span>Active Candidates</span><b>${k.active}</b></div><div class="ra-kpi"><span>High Match</span><b>${k.highMatch}</b></div><div class="ra-kpi"><span>Shortlisted</span><b>${k.shortlisted}</b></div><div class="ra-kpi"><span>Replied</span><b>${k.replied}</b></div></div><div class="ra-grid">${panel('Recent Discoveries','Latest local forum imports',recent.map(v=>`<div><a class="ra-link" data-detail="${esc(v.userId)}" href="#">${esc(v.name)}</a> · ${esc(v.sourceType||'MANUAL')} · ${esc(v.lookingFor)}</div>`).join('')||'<div class="ra-muted">No discoveries yet.</div>','discovery')}${panel('Candidates Needing Attention','Recruitment workflow',need.map(v=>`<div><a class="ra-link" data-detail="${esc(v.userId)}" href="#">${esc(v.name)}</a> · ${pill(v.pipelineStage,stageColor(v.pipelineStage))}</div>`).join('')||'<div class="ra-muted">Nothing waiting.</div>','pipeline')}${panel('Sync Status','Forum checkpoints',`<div class="ra-muted">${sources.length} forum observation(s) stored locally. ${state.sync.running?'Sync active.':'Ready.'}</div>`,'sync')}${panel('Scout Status','Shared scheduler',`<div class="ra-muted">${esc(state.scout.status)} · hard cap ${HARD_API_RATE}/min · minimum ${MIN_API_GAP_MS} ms gap.</div>`)}</div>`;}

  function sourceStatusCard(feed,cp){const resume=!!cp?.resumeAvailable;return `<div class="ra-source-card"><b>${esc(feed.label)}</b><small>${feed.enabled?`Thread ${esc(feed.threadId)}`:'Not configured'}</small><div>${cp?.updatedAt?`Last sync ${new Date(cp.updatedAt).toLocaleString()}`:'Never synced'}</div><div>${resume?pill('Resume available',Runtime.AVAILABILITY_COLORS.Available):pill(feed.enabled?'Ready':'Disabled','#64748b')}</div></div>`;}
  async function renderDiscover(){const feeds=Discovery.feedDefinitions(state.settings.recruitment);const checkpoints=new Map((await idb.getAll('forumSyncState')).map(x=>[x.feedId,x]));const sources=(await idb.getAll('forumSources')).sort((a,b)=>Number(b.postedAt||0)-Number(a.postedAt||0)).slice(0,12);const views=await candidateViews();const viewMap=new Map(views.map(v=>[String(v.userId),v]));const c=state.sync.running?(checkpoints.get(state.sync.feed)?.counters||{}):{};return `${panel('Forum Discovery','Official Torn v2 forum sources',`<div class="ra-actions"><button class="ra-btn ra-primary" id="ra-sync">Sync Forum Posts</button><button class="ra-btn" id="ra-add-candidate">Add Candidate</button><button class="ra-btn" id="ra-fill-companies">Fill Companies</button><button class="ra-btn ra-danger" id="ra-cancel-work" ${(state.sync.running||state.fill.running)?'':'hidden'}>Cancel</button><button class="ra-btn" id="ra-discover-menu">More ▾</button></div><div id="ra-discover-more" hidden class="ra-actions" style="margin-top:6px"><button class="ra-btn" data-open-thread="company">Open Company Thread</button><button class="ra-btn" data-open-thread="faction">Open Faction Thread</button><button class="ra-btn" data-open-thread="training">Open Training Thread</button><button class="ra-btn" id="ra-reset-forum">Reset Forum Import</button><button class="ra-btn" id="ra-refresh-discover">Refresh View</button></div><div style="margin-top:9px" class="ra-progress"><div id="ra-discover-progress"></div></div><div id="ra-discover-progress-text" class="ra-note">${state.fill.running?`Company lookups ${state.fill.done}/${state.fill.total}`:state.sync.running?`Syncing ${esc(state.sync.feed)} page ${state.sync.pages}`:'Idle'}</div>`,'sync')}<div class="ra-grid">${feeds.map(feed=>sourceStatusCard(feed,checkpoints.get(feed.feedId))).join('')}</div>${panel('Activity','Timestamped discovery activity',`<div class="ra-log" id="ra-discovery-log">${state.sync.running?`[${new Date().toLocaleTimeString()}] Sync active: ${esc(state.sync.feed)}\nPages: ${number(c.pagesChecked)} · Posts: ${number(c.postsExamined)} · Created: ${number(c.candidatesCreated)} · Updated: ${number(c.candidatesUpdated)}`:`[${new Date().toLocaleTimeString()}] Ready.${state.fill.errors.length?`\nLast company fill errors: ${state.fill.errors.map(x=>`${x.userId}: ${x.error}`).join(' | ')}`:''}`}</div>`)}${panel('Recent Discoveries','Latest imported candidates',`<div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Source</th><th>Looking For</th><th>Match</th><th>Stage</th><th>Discovered / Updated</th></tr></thead><tbody>${sources.map(s=>{const v=viewMap.get(String(s.userId));return `<tr><td><a href="#" data-detail="${esc(s.userId)}" class="ra-link">${esc(v?.name||s.authorName||`User ${s.userId}`)}</a></td><td>${esc(s.sourceType)}</td><td>${esc(v?.lookingFor||'Unknown')}</td><td>${scoreText(v?.matchScore)}</td><td>${v?pill(v.pipelineStage,stageColor(v.pipelineStage)):'—'}</td><td>${s.postedAt?new Date(s.postedAt).toLocaleString():'—'}</td></tr>`;}).join('')||'<tr><td colspan="6">No discoveries yet.</td></tr>'}</tbody></table></div>`,'discovery')}`;}

  function candidateFilterControls(){const f=state.settings.candidates.filters;const sources=ForumCore.SOURCE_TYPES||[];return `<div class="ra-formgrid"><div class="ra-field"><label>Search</label><input id="ra-filter-search" value="${esc(f.search)}" placeholder="Name / ID"></div><div class="ra-field"><label>Stage</label><select id="ra-filter-stage"><option value="">Any</option>${Runtime.PIPELINE_STAGES.map(x=>`<option ${f.stage===x?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="ra-field"><label>Source</label><select id="ra-filter-source"><option value="">Any</option>${sources.map(x=>`<option ${f.source===x?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="ra-field"><label>Looking For</label><input id="ra-filter-looking" value="${esc(f.lookingFor)}"></div><div class="ra-field"><label>Current Company</label><input id="ra-filter-company" value="${esc(f.currentCompany)}"></div><div class="ra-field"><label>Match ≥</label><input id="ra-filter-match" value="${esc(f.minMatch)}" inputmode="decimal"></div><div class="ra-field"><label>Fit ≥</label><input id="ra-filter-fit" value="${esc(f.minFit)}" inputmode="decimal"></div><div class="ra-field"><label>Active only</label><select id="ra-filter-active"><option value="false">No</option><option value="true" ${f.activeOnly?'selected':''}>Yes</option></select></div></div><div class="ra-actions" style="margin-top:7px"><button class="ra-btn" id="ra-more-filters">${f.moreOpen?'Hide':'More'} Filters</button><button class="ra-btn" id="ra-clear-candidate-filters">Clear</button></div><div id="ra-more-filter-box" ${f.moreOpen?'':'hidden'} class="ra-formgrid" style="margin-top:7px"><div class="ra-field"><label>MAN ≥</label><input id="ra-filter-man" value="${esc(f.minMan)}"></div><div class="ra-field"><label>INT ≥</label><input id="ra-filter-int" value="${esc(f.minInt)}"></div><div class="ra-field"><label>END ≥</label><input id="ra-filter-end" value="${esc(f.minEnd)}"></div><div class="ra-field"><label>Activity 30d ≥</label><input id="ra-filter-activity" value="${esc(f.minActivity30)}"></div></div>`;}
  function displayColumn(v,key){if(key==='player')return `<a href="#" data-detail="${esc(v.userId)}" data-context-id="${esc(v.userId)}" class="ra-link">${esc(v.name)}</a><small class="ra-muted"> ${esc(v.userId)}</small>`;if(key==='stage')return `<select class="ra-inline-stage" data-stage-id="${esc(v.userId)}">${Runtime.PIPELINE_STAGES.map(s=>`<option ${s===v.pipelineStage?'selected':''}>${esc(s)}</option>`).join('')}</select>`;if(key==='match')return scoreText(v.matchScore);if(key==='fit')return scoreText(v.fitScore);if(key==='lookingFor')return esc(v.lookingFor);if(key==='source')return esc(v.sourceType||'MANUAL');if(key==='lastActive')return lastActiveText(v);if(key==='currentCompany')return esc(v.currentCompany||'—');if(key==='man'||key==='int'||key==='end'||key==='total'||key==='ee')return formatNumber(v[key]);if(key==='availability')return pill(v.availability,availabilityColor(v.availability));if(key==='postedAt')return v.postedAt?new Date(v.postedAt).toLocaleString():'—';if(key==='activity30')return formatNumber(v.activity30,1);if(key==='scoutStatus')return esc(v.scoutStatus||'unscouted');return '—';}
  async function renderCandidates(){const all=await candidateViews();const rows=applyCandidateFilters(all);const cols=state.settings.candidates.visibleColumns.filter(k=>COLUMN_LABELS[k]);const k=Runtime.kpiCounts(all.map(v=>({...v.candidate,matchScore:v.matchScore})));const body=state.settings.candidates.view==='cards'?`<div class="ra-cards">${rows.map(v=>`<article class="ra-card" data-context-id="${esc(v.userId)}" tabindex="0"><h4><a href="#" data-detail="${esc(v.userId)}" class="ra-link">${esc(v.name)}</a></h4><div>${pill(v.pipelineStage,stageColor(v.pipelineStage))} ${pill(v.availability,availabilityColor(v.availability))}</div><div class="ra-card-grid"><span>Match<b>${scoreText(v.matchScore)}</b></span><span>Fit<b>${scoreText(v.fitScore)}</b></span><span>Looking For<b>${esc(v.lookingFor)}</b></span><span>Source<b>${esc(v.sourceType||'MANUAL')}</b></span></div></article>`).join('')||'<div class="ra-muted">No matching candidates.</div>'}</div>`:`<div class="ra-table-wrap"><table class="ra-table"><thead><tr>${cols.map(c=>`<th>${esc(COLUMN_LABELS[c])}</th>`).join('')}</tr></thead><tbody>${rows.map(v=>`<tr data-context-id="${esc(v.userId)}" tabindex="0" style="--row-tint:${esc(stageColor(v.pipelineStage))}">${cols.map(c=>`<td>${displayColumn(v,c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}">No matching candidates.</td></tr>`}</tbody></table></div>`;return `<div class="ra-kpis"><div class="ra-kpi"><span>Active</span><b>${k.active}</b></div><div class="ra-kpi"><span>High Match</span><b>${k.highMatch}</b></div><div class="ra-kpi"><span>Shortlisted</span><b>${k.shortlisted}</b></div><div class="ra-kpi"><span>Replied</span><b>${k.replied}</b></div></div>${panel('Candidate Filters','Recruitment and Scout-derived criteria',candidateFilterControls())}${panel('Candidates',`${rows.length} matching of ${all.length}`,`<div class="ra-actions"><button class="ra-btn" id="ra-toggle-view">${state.settings.candidates.view==='table'?'Cards':'Table'} View</button><button class="ra-btn" id="ra-columns">Columns</button></div><div id="ra-column-picker" hidden class="ra-actions" style="margin:7px 0">${[...DEFAULT_VISIBLE_COLUMNS,...OPTIONAL_COLUMNS].filter((x,i,a)=>a.indexOf(x)===i).map(c=>`<label><input type="checkbox" data-column="${esc(c)}" ${cols.includes(c)?'checked':''} ${c==='player'?'disabled':''}> ${esc(COLUMN_LABELS[c])}</label>`).join('')}</div>${body}`)}`;}

  async function renderPipeline(){const views=await candidateViews();const buckets=Candidates.pipelineBuckets(views.map(v=>({...v,pipelineStage:v.pipelineStage})));const mobileStage=text(state.settings.candidates.mobilePipelineStage)||Runtime.PIPELINE_STAGES[0];return `${panel('Pipeline','Explicit stage changes only',`<div class="ra-muted">Opening a profile, forum source, or message compose never changes a candidate stage.</div><div class="ra-field" id="ra-mobile-stage-select-wrap"><label>Small-screen stage</label><select id="ra-mobile-stage-select">${Runtime.PIPELINE_STAGES.map(s=>`<option ${s===mobileStage?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`,'pipeline')}<div class="ra-pipeline">${Runtime.PIPELINE_STAGES.map(stage=>`<section class="ra-stage ${stage===mobileStage?'mobile-active':''}" data-drop-stage="${esc(stage)}" style="--stage:${esc(stageColor(stage))}"><div class="ra-stage-head"><b>${esc(stage)}</b><span>${(buckets[stage]||[]).length}</span></div><div class="ra-stage-drop">${(buckets[stage]||[]).map(v=>`<article class="ra-stage-card ${['Hired','Rejected'].includes(stage)?'subdued':''}" draggable="true" data-drag-id="${esc(v.userId)}" data-context-id="${esc(v.userId)}" tabindex="0"><a href="#" data-detail="${esc(v.userId)}" class="ra-link"><b>${esc(v.name)}</b></a><div>${esc(v.sourceType||'MANUAL')}</div><div>Match ${scoreText(v.matchScore)} · Fit ${scoreText(v.fitScore)}</div><div>${esc(v.lookingFor)}</div><div>${pill(v.availability,availabilityColor(v.availability))}</div></article>`).join('')}</div></section>`).join('')}</div>`;}

  async function renderScout(){const history=(await idb.getAll('scoutHistory')).sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,20);return `${panel('Scout','Official Torn player intelligence',`<div class="ra-formgrid"><div class="ra-field"><label>Player IDs / profile URLs</label><textarea id="ra-scout-ids" placeholder="3877028, profile URLs, etc."></textarea></div><div><div class="ra-detail-grid"><span>Queue<b>${state.scout.done}/${state.scout.total}</b></span><span>API calls<b>${state.scout.calls}</b></span><span>Current candidate<b>${state.scout.currentId||'—'}</b></span><span>Status<b id="ra-scout-status">${esc(state.scout.status)}</b></span></div><div class="ra-progress" style="margin-top:8px"><div id="ra-scout-progress" style="width:${state.scout.total?Math.min(100,state.scout.done/state.scout.total*100):0}%"></div></div></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-run-scout">Scout</button><button class="ra-btn" id="ra-pause-scout" ${state.scout.running?'':'disabled'}>${state.scout.paused?'Resume':'Pause'}</button><button class="ra-btn ra-danger" id="ra-cancel-scout" ${state.scout.running?'':'disabled'}>Cancel</button></div>`) }${panel('Scout History','Most recent local snapshots',`<div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Captured</th><th>Fit</th><th>Type</th><th>Trend</th></tr></thead><tbody>${history.map(s=>`<tr><td>${esc(s.profile?.name||s.userId)}</td><td>${new Date(s.capturedAt).toLocaleString()}</td><td>${scoreText(scoutFit(s))}</td><td>${esc(s.originalFitType||'—')}</td><td>${finite(s.trend)===null?'—':`${Number(s.trend)>=0?'+':''}${Number(s.trend).toFixed(1)}%`}</td></tr>`).join('')||'<tr><td colspan="5">No Scout history.</td></tr>'}</tbody></table></div>`)}`;}

  function criterionControl(key,c){const label={man:'MAN',int:'INT',end:'END',ee:'EE',fit:'Fit',activity30:'Activity 30d',xanax30:'Xanax 30d',refills30:'Refills 30d',attacks30:'Attacks 30d',rwHits30:'RW Hits 30d',company:'Company',role:'Role',salary:'Salary',availability:'Availability'}[key]||key;let value='';if(['company','role'].includes(key))value=`<input data-match-value="${key}" value="${esc(c.value||'')}">`;else if(key==='availability')value=`<select data-match-value="availability"><option value="">Any</option>${MatchCore.AVAILABILITY_VALUES.map(v=>`<option value="${esc(v)}" ${c.value===v?'selected':''}>${esc(v.replaceAll('_',' '))}</option>`).join('')}</select>`;else if(key==='salary')value=`<input data-match-max="salary" type="number" value="${esc(c.max||0)}">`;else value=`<input data-match-target="${key}" type="number" value="${esc(c.target||0)}">`;return `<div class="ra-formgrid" style="grid-template-columns:1.2fr 1fr 80px;align-items:end;margin:5px 0"><label><input type="checkbox" data-match-enabled="${esc(key)}" ${c.enabled?'checked':''}> ${esc(label)}</label><div class="ra-field"><label>Target / Value</label>${value}</div><div class="ra-field"><label>Weight</label><input data-match-weight="${esc(key)}" type="number" value="${esc(c.weight||0)}"></div></div>`;}
  async function renderSmartMatch(){const profiles=(await idb.getAll('matchProfiles')).map(MatchCore.normalizeProfile);const active=await getActiveMatchProfile();const criteria=MatchCore.CRITERIA_KEYS.map(key=>criterionControl(key,active.criteria[key])).join('');return `${panel('Smart Match','Local-only matching · zero Torn API calls',`<div class="ra-actions"><select id="ra-match-profile-select" class="ra-btn">${profiles.map(p=>`<option value="${esc(p.profileId)}" ${p.profileId===active.profileId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="ra-btn" id="ra-match-new">Create</button><button class="ra-btn" id="ra-match-duplicate">Duplicate</button><button class="ra-btn ra-danger" id="ra-match-delete">Delete</button></div><div class="ra-field" style="margin-top:8px"><label>Profile name</label><input id="ra-match-name" value="${esc(active.name)}"></div><div style="margin-top:8px">${criteria}</div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-match-save">Save Profile</button></div>`) }${panel('Known / Unknown','How Match handles incomplete candidate data',`<div class="ra-muted">Enabled criteria with unknown candidate values are excluded from the denominator. Smart Match recalculation is local and never calls Torn.</div>`)}`;}

  async function renderGlobal(){const pending=(await idb.getAll('globalSyncQueue')).length;return `${panel('Global Intelligence','Sanitized shared public-player observations',`<div class="ra-detail-grid"><span>Enabled<b>${state.settings.global.enabled?'Yes':'No'}</b></span><span>Endpoint<b>${globalEndpoint()?'Configured':'Not configured'}</b></span><span>Pending queue<b>${pending}</b></span><span>Schema<b>${GlobalCore.GLOBAL_SCHEMA_VERSION}</b></span></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" id="ra-global-test">Test Service</button><button class="ra-btn" id="ra-global-retry">Retry Sync</button></div>`) }${panel('Privacy','Exactly what can leave the browser',`<div class="ra-muted">Shared fields: ${esc(GlobalCore.GLOBAL_FIELDS.join(', '))}.</div><p class="ra-muted">Forum text, source URLs/history, pipeline stage, notes, salary, availability overrides, Match/Profile data, recruitment messages and workflow state remain local.</p>`)}`;}

  function settingsSection(title,id,body,help=''){return `<details data-settings-section="${esc(id)}"><summary>${esc(title)} ${help?helpButton(help):''}</summary><div class="ra-settings-body">${body}</div></details>`;}
  function colorSettings(){const stages=Runtime.PIPELINE_STAGES.map(s=>`<label class="ra-color-row"><input type="color" data-stage-color="${esc(s)}" value="${esc(stageColor(s))}"> ${esc(s)}</label>`).join('');const availability=Runtime.AVAILABILITY_VALUES.map(v=>`<label class="ra-color-row"><input type="color" data-availability-color="${esc(v)}" value="${esc(availabilityColor(v))}"> ${esc(v)}</label>`).join('');return `<div class="ra-color-grid">${stages}${availability}</div><div class="ra-actions"><button class="ra-btn" id="ra-reset-colors">Reset Colours</button></div>`;}
  function optionalModuleSettingsHtml(){return `<div class="ra-note" style="margin-bottom:8px">Search & Results stays available. Enable only the extra workspaces you actually use.</div><div class="ra-optional-grid">${OPTIONAL_MODULES.map(([key,label])=>`<label class="ra-optional-toggle"><input type="checkbox" data-optional-module="${esc(key)}" ${state.settings.optionalModules?.[key]===true?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div>`;}
  async function renderSettings(){const r=state.settings.recruitment;return `<div class="ra-settings">${settingsSection('General','general',`<div class="ra-formgrid"><div class="ra-field"><label>Theme</label><select id="ra-setting-theme"><option value="dark">Dark</option><option value="light">Light</option></select></div><div class="ra-field"><label>Density</label><select id="ra-setting-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div><div class="ra-field"><label>Interface text size</label><select id="ra-setting-text"><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option></select></div><div class="ra-field"><label>Interface mode</label><select id="ra-setting-complexity"><option value="simple">Simple</option><option value="advanced">Advanced</option></select></div><div class="ra-field"><label>Launcher</label><select id="ra-setting-launcher"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="ra-field"><label>Sidebar</label><select id="ra-setting-sidebar"><option value="false">Expanded</option><option value="true">Collapsed</option></select></div><div class="ra-field"><label>Include inactive candidates</label><select id="ra-setting-inactive"><option value="false">No</option><option value="true">Yes</option></select></div></div>`)}${settingsSection('Optional Features','optional-features',optionalModuleSettingsHtml())}${settingsSection('Recruitment','recruitment',`<div class="ra-formgrid"><div class="ra-field"><label>Company thread</label><input id="ra-setting-company-thread" value="${esc(r.companyThreadId)}"></div><div class="ra-field"><label>Faction thread</label><input id="ra-setting-faction-thread" value="${esc(r.factionThreadId)}"></div><div class="ra-field"><label>Training thread</label><input id="ra-setting-training-thread" value="${esc(r.trainingThreadId)}"></div><div class="ra-field"><label>Recent import window (days)</label><input id="ra-setting-import-days" type="number" min="1" value="${r.recentImportDays}"></div><div class="ra-field"><label>Max pages / feed</label><input id="ra-setting-max-pages" type="number" min="1" value="${r.maxPagesPerFeed}"></div><div class="ra-field"><label>Candidate active age (days)</label><input id="ra-setting-active-age" type="number" min="1" value="${r.candidateActiveAgeDays}"></div><div class="ra-field"><label>Train buyers</label><select id="ra-setting-train-explicit"><option value="true">Explicit only</option><option value="false">All parsed train interest</option></select></div><div class="ra-field" style="grid-column:1/-1"><b>Company recruitment</b><div class="ra-note">Recruit performs a fresh Torn check before preparing private chat.</div></div><div class="ra-field"><label>Company name</label><input id="ra-setting-own-company" value="${esc(state.settings.ownCompanyName)}" placeholder="Bad Decisions"></div><div class="ra-field"><label>Company type</label><input id="ra-setting-company-type" value="${esc(r.companyType)}" placeholder="Adult Novelties"></div><div class="ra-field" style="grid-column:1/-1"><label>Company recruitment private-chat message</label><textarea id="ra-setting-company-message" style="min-height:150px">${esc(r.companyRecruitmentMessage)}</textarea><div class="ra-note">Placeholders: {name} {company_name} {company_type}</div></div><div class="ra-field" style="grid-column:1/-1"><b>Faction recruitment</b></div><div class="ra-field"><label>Faction name</label><input id="ra-setting-faction-name" value="${esc(r.factionName)}" placeholder="Silent Ledger"></div><div class="ra-field" style="grid-column:1/-1"><label>Faction recruitment private-chat message</label><textarea id="ra-setting-faction-message" style="min-height:150px">${esc(r.factionRecruitmentMessage)}</textarea><div class="ra-note">Placeholders: {name} {faction_name}</div></div><input type="hidden" id="ra-setting-default-message" value="${esc(r.defaultMessage)}"></div>${colorSettings()}`,'defaultMessage')}${settingsSection('Scout','scout',`<div class="ra-formgrid"><div class="ra-field"><label>API calls/min (max 75)</label><input id="ra-setting-rate" type="number" min="10" max="75" value="${state.settings.scout.rate}"></div><div class="ra-field"><label>Workers</label><input id="ra-setting-workers" type="number" min="1" max="8" value="${state.settings.scout.workers}"></div><div class="ra-field"><label>Request budget</label><input id="ra-setting-budget" type="number" min="1" value="${state.settings.scout.budget}"></div><div class="ra-field"><label>History gap ms</label><input id="ra-setting-history-gap" type="number" min="0" value="${state.settings.scout.historyGapMs}"></div></div><div class="ra-actions"><button class="ra-btn" id="ra-set-key">Set / Change API Key</button><button class="ra-btn" id="ra-cache-diagnostic">Diagnostics</button></div>`)}${settingsSection('Candidates','candidates',`<div class="ra-formgrid"><div class="ra-field"><label>Default view</label><select id="ra-setting-candidate-view"><option value="table">Table</option><option value="cards">Cards</option></select></div><div class="ra-field"><label>Compactness</label><select id="ra-setting-candidate-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div></div><div class="ra-actions"><button class="ra-btn" id="ra-reset-layout">Reset Layout</button></div>`)}${settingsSection('Smart Match','smart-match',`<div class="ra-muted">Smart Match profiles are edited on the Smart Match page.</div><div class="ra-actions"><button class="ra-btn" data-go-page="smart-match">Open Smart Match</button></div>`)}${settingsSection('Global Intelligence','global',`<div class="ra-formgrid"><div class="ra-field"><label>Enabled</label><select id="ra-setting-global-enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="ra-field"><label>Endpoint</label><input id="ra-setting-global-endpoint" value="${esc(state.settings.global.endpoint)}"></div></div><div class="ra-actions"><button class="ra-btn" id="ra-setting-global-test">Test</button><button class="ra-btn" id="ra-setting-global-retry">Retry</button></div>`)}${settingsSection('Data & Reset','data',`<div class="ra-actions"><button class="ra-btn" id="ra-reset-layout-2">Reset Layout</button><button class="ra-btn" id="ra-clear-scout">Clear Scout Cache</button><button class="ra-btn" id="ra-clear-recruitment">Clear Local Candidate / Forum Data</button></div>`,'data')}<details class="ra-danger-zone" data-settings-section="danger"><summary>Danger Zone</summary><div class="ra-settings-body"><p class="ra-muted">Hard local reset deletes Recruitment Agency browser-local data only. Torn account data and unrelated userscripts are untouched.</p><button type="button" id="ra-nuke" class="ra-nuke">${biohazardSvg()}<span>NUKE IT ALL!</span></button></div></details><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-save-settings">Save Settings</button></div></div>`;}

  async function renderData(){const candidates=await idb.getAll('candidateLocal'),sources=await idb.getAll('forumSources'),logs=await idb.getAll('appLogs');return `${panel('Local Data','IndexedDB store summary',`<div class="ra-detail-grid"><span>DB version<b>${DB_VERSION}</b></span><span>Candidates<b>${candidates.length}</b></span><span>Forum sources<b>${sources.length}</b></span><span>Logs<b>${logs.length}</b></span></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" id="ra-export-csv">Export Candidate CSV</button><button class="ra-btn" id="ra-data-clear-candidates">Clear Candidate / Forum Data</button></div>`,'data')}`;}
  async function renderLogs(){const logs=(await idb.getAll('appLogs')).sort((a,b)=>b.at-a.at).slice(0,200);return `${panel('Application Logs','Sanitized events only',`<div class="ra-actions"><button class="ra-btn" id="ra-refresh-logs">Refresh</button><button class="ra-btn" id="ra-clear-logs">Clear Logs</button></div><div class="ra-log" style="margin-top:8px">${logs.map(x=>`[${new Date(x.at).toLocaleString()}] ${esc(String(x.type).toUpperCase())} ${esc(x.message)}`).join('\n')||'No log entries.'}</div>`,'logs')}`;}

  const renderCompanyPlaceholder=async()=>panel(pageMeta(state.page)[0],'Company recruitment route shell',`<div class="ra-muted">This dedicated Company workspace is wired and will be populated by the next Company implementation task.</div>`);
  const renderers={'company-overview':renderOverview,'company-discover':renderDiscover,'company-candidates':renderCandidates,'company-pipeline':renderPipeline,'company-today':renderCompanyPlaceholder,'company-vacancies':renderCompanyPlaceholder,'company-campaigns':renderCompanyPlaceholder,'company-followups':renderCompanyPlaceholder,'company-timeline':renderCompanyPlaceholder,'company-stage-aging':renderCompanyPlaceholder,'company-contact-outcomes':renderCompanyPlaceholder,'company-recruitment-sessions':renderCompanyPlaceholder,'company-talent-pool':renderCompanyPlaceholder,'company-reactivation':renderCompanyPlaceholder,'company-opportunity':renderCompanyPlaceholder,'company-compare':renderCompanyPlaceholder,scout:renderScout,'smart-match':renderSmartMatch,'global-intelligence':renderGlobal,settings:renderSettings,data:renderData,logs:renderLogs};
  function visibleRouteSet(){return new Set(V46Navigation.visibleGroups(state.settings).flatMap(group=>group.pages.map(page=>page.id)));}
  function defaultDomainRoute(){return `${state.settings.activeDomain==='faction'?'faction':'company'}-candidates`;}
  async function route(page,persist=true){
    const requested=String(page||'').trim().toLowerCase();
    if(!V46Navigation.ROUTES.includes(requested)||(requested!=='settings'&&!visibleRouteSet().has(requested))||(requested==='logs'&&state.settings.complexity!=='advanced'))return false;
    if(requested===state.page&&persist){document.querySelector('.ra-shell')?.classList.remove('sidebar-open');return true;}
    state.page=requested;
    if(persist)await saveSettings({activePage:state.page});
    if(V46CompanyPlatform._test.IMPLEMENTED_ROUTES.has(state.page)){
      rebuildNav();
      await V46CompanyPlatform.renderPage(state.page,{persist:false});
      bindHelp();
      document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
      stopLogRefresh();
      return;
    }
    if(V47FactionPlatform._test.IMPLEMENTED_ROUTES.has(state.page)){
      rebuildNav();
      await V47FactionPlatform.renderPage(state.page,{persist:false});
      bindHelp();
      document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
      stopLogRefresh();
      return;
    }
    const [title,description]=pageMeta(state.page);
    document.getElementById('ra-page-title').textContent=title;
    document.getElementById('ra-page-desc').textContent=description;
    const content=document.getElementById('ra-content');
    content.innerHTML=await (renderers[state.page]||renderOverview)();
    rebuildNav();bindPageControls();bindHelp();bindCandidateInteractions();
    document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
    if(state.page==='logs')startLogRefresh();else stopLogRefresh();
  }

  async function saveCandidate(candidate){candidate.userId=String(candidate.userId);candidate.updatedAt=new Date().toISOString();await idb.put('candidateLocal',candidate);await repositories.company.ensure(candidate.userId,candidate,{sharedPatch:{name:candidate.name},source:'company-workflow',observedAt:Date.now()});return candidate;}
  async function changeCandidateStage(id,stage){const candidate=await idb.get('candidateLocal',String(id))||await idb.get('candidateLocal',Number(id));if(!candidate)return;await saveCandidate(Candidates.changeStage(candidate,stage));await logEvent('candidate','Pipeline stage changed',{playerId:Number(id),stage:ForumCore.normalizeStage(stage)});}
  async function changeCandidateAvailability(id,value){const candidate=await idb.get('candidateLocal',String(id))||await idb.get('candidateLocal',Number(id));if(!candidate)return;await saveCandidate(Candidates.changeAvailability(candidate,value));}
  async function deleteCompanyCandidateData(id){const userId=V46Domain.normalizeUserId(id);await idb.delete('candidateLocal',userId);await idb.delete('candidateLocal',Number(userId));await idb.delete('companyRecruitment',userId);for(const row of await idb.getAll('users'))if(text(row.userId)===userId&&text(row.sourceMode).toLowerCase()!=='faction')await idb.delete('users',row.recordId);for(const source of await idb.getAll('forumSources'))if(text(source.userId)===userId&&text(source.sourceType).toUpperCase()!=='FACTION FORUM')await idb.delete('forumSources',source.sourceId);return true;}
  async function deleteCandidate(id){if(!confirm('Delete this local Company candidate and their Company recruitment source records?'))return;await deleteCompanyCandidateData(id);toast('Local Company candidate deleted.');await route(state.page,false);}

  function contextMenuHtml(view){return Candidates.contextMenuModel(view).map(item=>{if(item.separator)return '<div class="ra-menu-sep"></div>';if(item.children)return `<button class="ra-menu-item" data-submenu="${esc(item.id)}">${esc(item.label)} ▸</button><div class="ra-submenu" data-submenu-box="${esc(item.id)}" hidden>${item.children.map(child=>`<button class="ra-menu-item" data-menu-action="${esc(child.id)}">${child.checked?'✓ ':''}${esc(child.label)}</button>`).join('')}</div>`;return `<button class="ra-menu-item" data-menu-action="${esc(item.id)}" ${item.disabled?'disabled':''}>${esc(item.label)}</button>`;}).join('');}
  async function openContextMenu(id,x,y){const views=await candidateViews();const view=views.find(v=>String(v.userId)===String(id));if(!view)return;state.contextCandidateId=String(id);const menu=document.getElementById('ra-context');menu.innerHTML=contextMenuHtml(view);menu.hidden=false;const width=240,height=Math.min(500,menu.scrollHeight||400);menu.style.left=`${Math.max(4,Math.min(x,innerWidth-width-4))}px`;menu.style.top=`${Math.max(4,Math.min(y,innerHeight-height-4))}px`;menu.querySelectorAll('[data-submenu]').forEach(b=>b.onclick=()=>{const box=menu.querySelector(`[data-submenu-box="${b.dataset.submenu}"]`);if(box)box.hidden=!box.hidden;});menu.querySelectorAll('[data-menu-action]').forEach(b=>b.onclick=()=>handleMenuAction(b.dataset.menuAction,view));menu.querySelector('.ra-menu-item:not([disabled])')?.focus();}
  function closeContextMenu(){const menu=document.getElementById('ra-context');if(menu)menu.hidden=true;state.contextCandidateId='';}
  async function handleMenuAction(action,view){closeContextMenu();if(action==='message')return openMessageModal(view.userId);if(action==='details')return openDrawer(view.userId);if(action==='profile')return window.open(profileUrl(view.userId),'_blank','noopener');if(action==='forum'&&view.forumUrl)return window.open(view.forumUrl,'_blank','noopener');if(action==='scout')return runScout([Number(view.userId)],true).catch(e=>toast(e.message,true));if(action==='edit')return openEditCandidateModal(view.userId);if(action==='delete')return deleteCandidate(view.userId);if(action.startsWith('stage:')){await changeCandidateStage(view.userId,action.slice(6));return route(state.page,false);}if(action.startsWith('availability:')){await changeCandidateAvailability(view.userId,action.slice(13));return route(state.page,false);}}

  async function openDrawer(id){const views=await candidateViews();const v=views.find(x=>String(x.userId)===String(id));if(!v)return;state.drawerCandidateId=String(id);const drawer=document.getElementById('ra-drawer');drawer.innerHTML=`<div class="ra-drawer-head"><div><b>${esc(v.name)}</b><div class="ra-muted">${esc(v.userId)}</div></div><button class="ra-btn" id="ra-close-drawer">×</button></div><div class="ra-detail-section"><b>Identity</b><div class="ra-detail-grid"><span>Player<b>${esc(v.name)}</b></span><span>ID<b>${esc(v.userId)}</b></span><span>Current company<b>${esc(v.currentCompany||'—')}</b></span><span>Last active<b>${lastActiveText(v)}</b></span></div></div><div class="ra-detail-section"><b>Recruitment</b><div class="ra-detail-grid"><span>Stage<b>${pill(v.pipelineStage,stageColor(v.pipelineStage))}</b></span><span>Availability<b>${pill(v.availability,availabilityColor(v.availability))}</b></span><span>Salary<b>${money(v.expectedSalary)}</b></span><span>Source<b>${esc(v.sourceType||'MANUAL')}</b></span></div><div class="ra-note">${esc(v.recruiterNote||'No recruiter note.')}</div></div><div class="ra-detail-section"><b>Intelligence</b><div class="ra-detail-grid"><span>Match<b>${scoreText(v.matchScore)}</b></span><span>Fit<b>${scoreText(v.fitScore)}</b></span><span>EE<b>${formatNumber(v.ee)}</b></span><span>MAN / INT / END<b>${formatNumber(v.man)} / ${formatNumber(v.int)} / ${formatNumber(v.end)}</b></span></div></div><div class="ra-detail-section"><b>Looking For</b><div>${esc(v.lookingFor)}</div></div><div class="ra-detail-section"><b>Forum Source</b><div>${v.forumUrl?`<a class="ra-link" target="_blank" rel="noopener" href="${esc(v.forumUrl)}">Open latest source</a>`:'No forum source URL.'}</div></div><div class="ra-actions" style="margin-top:10px"><button class="ra-btn ra-primary" id="ra-drawer-message">Message Player</button><button class="ra-btn" id="ra-drawer-profile">Open Torn Profile</button><button class="ra-btn" id="ra-drawer-scout">Scout Player</button><button class="ra-btn" id="ra-drawer-edit">Edit Candidate</button></div>`;drawer.hidden=false;document.getElementById('ra-close-drawer').onclick=()=>{drawer.hidden=true;state.drawerCandidateId='';};document.getElementById('ra-drawer-message').onclick=()=>openMessageModal(v.userId);document.getElementById('ra-drawer-profile').onclick=()=>window.open(profileUrl(v.userId),'_blank','noopener');document.getElementById('ra-drawer-scout').onclick=()=>runScout([Number(v.userId)],true).catch(e=>toast(e.message,true));document.getElementById('ra-drawer-edit').onclick=()=>openEditCandidateModal(v.userId);}

  async function openAddCandidateModal(){showModal(`<h3>Add Candidate</h3><div class="ra-formgrid"><div class="ra-field"><label>Torn player ID</label><input id="ra-add-id" inputmode="numeric"></div><div class="ra-field"><label>Name (optional)</label><input id="ra-add-name"></div><div class="ra-field"><label>Desired company</label><input id="ra-add-company"></div><div class="ra-field"><label>Desired role</label><input id="ra-add-role"></div><div class="ra-field"><label>Expected salary</label><input id="ra-add-salary"></div><div class="ra-field"><label>Availability</label><select id="ra-add-availability"><option value="Unknown">Unknown</option><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Recruiter note</label><textarea id="ra-add-note"></textarea></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-add-save">Add Candidate</button><button class="ra-btn" data-modal-close>Cancel</button></div>`);document.getElementById('ra-add-save').onclick=async()=>{try{const id=text(document.getElementById('ra-add-id').value);const existing=await idb.get('candidateLocal',id);const record=Discovery.addCandidateRecord({userId:id,name:text(document.getElementById('ra-add-name').value),desiredCompany:text(document.getElementById('ra-add-company').value),desiredRole:text(document.getElementById('ra-add-role').value),expectedSalary:finite(document.getElementById('ra-add-salary').value),availability:document.getElementById('ra-add-availability').value,recruiterNote:text(document.getElementById('ra-add-note').value)},existing);await saveCandidate(record);closeModal();toast('Candidate added.');await route(state.page,false);}catch(error){toast(error.message,true);}};}
  async function openEditCandidateModal(id){const views=await candidateViews();const v=views.find(x=>String(x.userId)===String(id));if(!v)return;showModal(`<h3>Edit Candidate</h3><div class="ra-formgrid"><div class="ra-field"><label>Stage</label><select id="ra-edit-stage">${Runtime.PIPELINE_STAGES.map(s=>`<option ${s===v.pipelineStage?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="ra-field"><label>Availability</label><select id="ra-edit-availability">${Runtime.AVAILABILITY_VALUES.map(a=>`<option ${a===v.availability?'selected':''}>${esc(a)}</option>`).join('')}</select></div><div class="ra-field"><label>Desired company</label><input id="ra-edit-company" value="${esc(v.desiredCompany)}"></div><div class="ra-field"><label>Desired role</label><input id="ra-edit-role" value="${esc(v.desiredRole)}"></div><div class="ra-field"><label>Expected salary</label><input id="ra-edit-salary" value="${esc(v.expectedSalary??'')}"></div><div class="ra-field" style="grid-column:1/-1"><label>Recruiter note</label><textarea id="ra-edit-note">${esc(v.recruiterNote)}</textarea></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-edit-save">Save</button><button class="ra-btn" data-modal-close>Cancel</button></div>`);document.getElementById('ra-edit-save').onclick=async()=>{const c={...v.candidate,pipelineStage:document.getElementById('ra-edit-stage').value,availability:document.getElementById('ra-edit-availability').value,desiredCompany:text(document.getElementById('ra-edit-company').value),desiredRole:text(document.getElementById('ra-edit-role').value),expectedSalary:finite(document.getElementById('ra-edit-salary').value),recruiterNote:text(document.getElementById('ra-edit-note').value),manualFields:{...(v.candidate.manualFields||{}),desiredCompany:text(document.getElementById('ra-edit-company').value),desiredRole:text(document.getElementById('ra-edit-role').value),expectedSalary:finite(document.getElementById('ra-edit-salary').value),availability:document.getElementById('ra-edit-availability').value}};await saveCandidate(c);closeModal();toast('Candidate saved.');await route(state.page,false);if(!document.getElementById('ra-drawer').hidden)await openDrawer(id);};}

  async function openMessageModal(id){const views=await candidateViews();const v=views.find(x=>String(x.userId)===String(id));if(!v)return;state.messageCandidateId=String(id);const values=Candidates.messageValues(v,state.settings.ownCompanyName);const plan=Messaging.messagePlan(state.settings.recruitment.defaultMessage,{...values,userId:id});showModal(`<h3>Message Player · ${esc(v.name)}</h3><div class="ra-note">Prepared locally. Opening Torn compose never changes pipeline stage and never sends automatically.</div><div class="ra-field" style="margin-top:8px"><label>Message</label><textarea id="ra-message-text" style="min-height:190px">${esc(plan.preparedText)}</textarea></div><div class="ra-actions"><button class="ra-btn" id="ra-message-edit">Edit</button><button class="ra-btn" id="ra-message-default">Save as Default</button><button class="ra-btn ra-primary" id="ra-message-open">Copy & Open Torn Message</button><button class="ra-btn" data-modal-close>Cancel</button></div>`,'messagePlayer');const ta=document.getElementById('ra-message-text');ta.readOnly=true;document.getElementById('ra-message-edit').onclick=()=>{ta.readOnly=false;ta.focus();};document.getElementById('ra-message-default').onclick=async()=>{await saveSettings({recruitment:{...state.settings.recruitment,defaultMessage:ta.value}});toast('Default recruitment message saved.');};document.getElementById('ra-message-open').onclick=async()=>{const prepared=text(ta.value);let copied=false;try{await navigator.clipboard.writeText(prepared);copied=true;}catch{ta.readOnly=false;ta.select();toast('Clipboard failed. Message remains selected for manual copy.',true);}window.open(Messaging.composeUrl(id),'_blank','noopener');if(copied)toast('Message copied. Torn compose opened; you still click Send.');};}
  function showModal(html){const modal=document.getElementById('ra-modal');modal.innerHTML=`<div class="ra-modal-card">${html}</div>`;modal.hidden=false;modal.querySelectorAll('[data-modal-close]').forEach(b=>b.onclick=closeModal);bindHelp();}
  function closeModal(){const modal=document.getElementById('ra-modal');if(modal){modal.hidden=true;modal.innerHTML='';}state.messageCandidateId='';}

  function candidateCsvRow(v){return[v.userId,v.name,v.pipelineStage,v.matchScore??'',v.fitScore??'',v.lookingFor,v.sourceType,v.currentCompany,v.availability,v.man??'',v.int??'',v.end??'',v.ee??''];}
  async function exportCsv(){const rows=await candidateViews();const header=['Player ID','Name','Stage','Match','Fit','Looking For','Source','Current Company','Availability','MAN','INT','END','EE'];const quote=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv=[header,...rows.map(candidateCsvRow)].map(row=>row.map(quote).join(',')).join('\n');try{await navigator.clipboard.writeText(csv);toast(`Copied ${rows.length} candidate(s) as CSV.`);}catch{const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='recruitment-candidates.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}

  async function hardReset(){if(!confirm('NUKE IT ALL will permanently delete Recruitment Agency browser-local candidates, forum imports, Scout cache/history, Global cache/queue, Match Profiles, logs, messages/settings and layout. Torn account data and unrelated userscripts are not touched. Continue?'))return;const typed=text(prompt('Type NUKE to confirm the hard local reset:','')).toUpperCase();if(typed!=='NUKE'){toast('Hard reset cancelled.',true);return;}for(const store of STORE_NAMES)await idb.clear(store);state.settings=mergeSettings({});state.page='company-candidates';applyTheme();rebuildNav();closeModal();document.getElementById('ra-drawer').hidden=true;await route('company-candidates',false);toast('Recruitment Agency local data was reset.');}
  async function clearRecruitmentData(){for(const store of ['users','candidateLocal','companyRecruitment','factionRecruitment','companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions','forumSources','forumSyncState'])await idb.clear(store);return true;}
  async function clearRecruitment(){if(!confirm('Clear local Company/Faction recruitment and forum discovery data? Shared Scout/Player Intelligence will be kept.'))return;await clearRecruitmentData();toast('Recruitment/forum data cleared.');await logEvent('reset','Recruitment and forum data cleared');await route(state.page,false);}
  async function resetLayout(){const meta=await getMeta();meta.ui={windowGeometry:{}};await idb.put('meta',meta);const app=document.getElementById('ra-app');Object.assign(app.style,{left:'6vw',top:'5vh',width:'88vw',height:'86vh'});toast('Layout reset.');}

  function readFiltersFromUi(){const old=state.settings.candidates.filters;return{...old,search:text(document.getElementById('ra-filter-search')?.value),stage:text(document.getElementById('ra-filter-stage')?.value),source:text(document.getElementById('ra-filter-source')?.value),lookingFor:text(document.getElementById('ra-filter-looking')?.value),currentCompany:text(document.getElementById('ra-filter-company')?.value),minMatch:text(document.getElementById('ra-filter-match')?.value),minFit:text(document.getElementById('ra-filter-fit')?.value),activeOnly:document.getElementById('ra-filter-active')?.value==='true',minMan:text(document.getElementById('ra-filter-man')?.value),minInt:text(document.getElementById('ra-filter-int')?.value),minEnd:text(document.getElementById('ra-filter-end')?.value),minActivity30:text(document.getElementById('ra-filter-activity')?.value)};}
  async function persistFilters(){await saveSettings({candidates:{...state.settings.candidates,filters:readFiltersFromUi()}});await route('company-candidates',false);}

  async function runCacheDiagnostic(){
    if(state.scout.running)throw new Error('Finish the current Scout run first.');
    const id=ScoutCore.parseIds(prompt('Active player ID for Scout cache diagnostic:','')||'',1)[0];
    if(!id)throw new Error('A player ID is required for the diagnostic.');
    const now=Math.floor(Date.now()/1000);const params={selections:'personalstats',stat:SCOUT_STAT_LIST};
    const a=ScoutCore.signature(extractStats(await tornRequest(`user/${id}`,{...params,timestamp:now-7*86400})));const b=ScoutCore.signature(extractStats(await tornRequest(`user/${id}`,{...params,timestamp:now-30*86400})));await sleep(32000);const c=ScoutCore.signature(extractStats(await tornRequest(`user/${id}`,{...params,timestamp:now-30*86400})));
    const verdict=a===b&&b===c?'flat':a===b&&b!==c?'cached':a!==b&&b===c?'clear':'odd';
    if(verdict==='cached')await saveSettings({scout:{...state.settings.scout,historyGapMs:32000}});
    await logEvent('scout','Scout cache diagnostic completed',{playerId:id,verdict});toast(verdict==='cached'?'Cached historical responses detected. History gap set to 32s.':`Cache diagnostic: ${verdict}.`,verdict==='odd');
    return verdict;
  }

  async function saveSettingsPage(){const optionalModules={...DEFAULT_OPTIONAL_MODULES};document.querySelectorAll('[data-optional-module]').forEach(el=>{optionalModules[el.dataset.optionalModule]=el.checked===true;});const stageColors={...state.settings.recruitment.stageColors};document.querySelectorAll('[data-stage-color]').forEach(el=>stageColors[el.dataset.stageColor]=el.value);const availabilityColors={...state.settings.recruitment.availabilityColors};document.querySelectorAll('[data-availability-color]').forEach(el=>availabilityColors[el.dataset.availabilityColor]=el.value);const recruitment=Runtime.normalizeRecruitmentSettings({...state.settings.recruitment,companyThreadId:text(document.getElementById('ra-setting-company-thread')?.value),factionThreadId:text(document.getElementById('ra-setting-faction-thread')?.value),trainingThreadId:text(document.getElementById('ra-setting-training-thread')?.value),recentImportDays:number(document.getElementById('ra-setting-import-days')?.value,30),maxPagesPerFeed:number(document.getElementById('ra-setting-max-pages')?.value,20),candidateActiveAgeDays:number(document.getElementById('ra-setting-active-age')?.value,30),explicitTrainBuyersOnly:document.getElementById('ra-setting-train-explicit')?.value!=='false',defaultMessage:document.getElementById('ra-setting-default-message')?.value,companyType:text(document.getElementById('ra-setting-company-type')?.value),companyRecruitmentMessage:document.getElementById('ra-setting-company-message')?.value,factionName:text(document.getElementById('ra-setting-faction-name')?.value),factionRecruitmentMessage:document.getElementById('ra-setting-faction-message')?.value,stageColors,availabilityColors});await saveSettings({theme:document.getElementById('ra-setting-theme')?.value||state.settings.theme,density:document.getElementById('ra-setting-density')?.value||state.settings.density,textSize:document.getElementById('ra-setting-text')?.value||state.settings.textSize,complexity:document.getElementById('ra-setting-complexity')?.value||state.settings.complexity,launcherEnabled:document.getElementById('ra-setting-launcher')?.value!=='false',sidebarCollapsed:document.getElementById('ra-setting-sidebar')?.value==='true',includeInactive:document.getElementById('ra-setting-inactive')?.value==='true',ownCompanyName:text(document.getElementById('ra-setting-own-company')?.value),optionalModules,recruitment,scout:{...state.settings.scout,rate:clampRate(document.getElementById('ra-setting-rate')?.value),workers:number(document.getElementById('ra-setting-workers')?.value,3),budget:number(document.getElementById('ra-setting-budget')?.value,900),historyGapMs:number(document.getElementById('ra-setting-history-gap')?.value,0)},candidates:{...state.settings.candidates,view:document.getElementById('ra-setting-candidate-view')?.value||state.settings.candidates.view},global:{...state.settings.global,enabled:document.getElementById('ra-setting-global-enabled')?.value!=='false',endpoint:text(document.getElementById('ra-setting-global-endpoint')?.value)}});applyTheme();syncLauncherVisibility();await route('settings',false);toast('Settings saved.');await logEvent('settings','Settings saved',{complexity:state.settings.complexity,theme:state.settings.theme});}

  function bindPageControls(){
    document.getElementById('ra-sync')?.addEventListener('click',()=>syncForums().catch(e=>toast(e.message,true)));document.getElementById('ra-add-candidate')?.addEventListener('click',openAddCandidateModal);document.getElementById('ra-fill-companies')?.addEventListener('click',()=>fillCompanies().catch(e=>toast(e.message,true)));document.getElementById('ra-cancel-work')?.addEventListener('click',()=>{cancelSync();cancelFill();});document.getElementById('ra-discover-menu')?.addEventListener('click',()=>{const x=document.getElementById('ra-discover-more');if(x)x.hidden=!x.hidden;});document.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>{const feed=Discovery.feedDefinitions(state.settings.recruitment).find(f=>f.feedId===b.dataset.openThread);if(feed?.threadId)window.open(forumThreadUrl(feed.threadId),'_blank','noopener');});document.getElementById('ra-reset-forum')?.addEventListener('click',async()=>{if(!confirm('Reset local forum import sources and checkpoints? Candidate recruiter data is preserved.'))return;await idb.clear('forumSources');await idb.clear('forumSyncState');toast('Forum import reset.');await route('company-discover',false);});document.getElementById('ra-refresh-discover')?.addEventListener('click',()=>route('company-discover',false));
    ['ra-filter-search','ra-filter-stage','ra-filter-source','ra-filter-looking','ra-filter-company','ra-filter-match','ra-filter-fit','ra-filter-active','ra-filter-man','ra-filter-int','ra-filter-end','ra-filter-activity'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>persistFilters().catch(e=>toast(e.message,true))));document.getElementById('ra-more-filters')?.addEventListener('click',async()=>{const f={...readFiltersFromUi(),moreOpen:!state.settings.candidates.filters.moreOpen};await saveSettings({candidates:{...state.settings.candidates,filters:f}});await route('company-candidates',false);});document.getElementById('ra-clear-candidate-filters')?.addEventListener('click',async()=>{await saveSettings({candidates:{...state.settings.candidates,filters:{...defaultSettings().candidates.filters}}});await route('company-candidates',false);});document.getElementById('ra-toggle-view')?.addEventListener('click',async()=>{await saveSettings({candidates:{...state.settings.candidates,view:state.settings.candidates.view==='table'?'cards':'table'}});await route('company-candidates',false);});document.getElementById('ra-columns')?.addEventListener('click',()=>{const x=document.getElementById('ra-column-picker');if(x)x.hidden=!x.hidden;});document.querySelectorAll('[data-column]').forEach(el=>el.onchange=async()=>{let cols=[...state.settings.candidates.visibleColumns];if(el.checked)cols=[...new Set([...cols,el.dataset.column])];else cols=cols.filter(x=>x!==el.dataset.column);if(!cols.includes('player'))cols.unshift('player');await saveSettings({candidates:{...state.settings.candidates,visibleColumns:cols}});await route('company-candidates',false);});document.querySelectorAll('.ra-inline-stage').forEach(el=>el.onchange=async()=>{await changeCandidateStage(el.dataset.stageId,el.value);toast('Stage updated.');});
    document.getElementById('ra-mobile-stage-select')?.addEventListener('change',async e=>{await saveSettings({candidates:{...state.settings.candidates,mobilePipelineStage:e.target.value}});await route('company-pipeline',false);});
    document.getElementById('ra-run-scout')?.addEventListener('click',()=>{const ids=ScoutCore.parseIds(document.getElementById('ra-scout-ids')?.value||'',state.settings.scout.maxCandidates);runScout(ids,true).catch(e=>toast(e.message,true));});document.getElementById('ra-pause-scout')?.addEventListener('click',pauseScout);document.getElementById('ra-cancel-scout')?.addEventListener('click',cancelScout);
    document.getElementById('ra-match-profile-select')?.addEventListener('change',async e=>{await saveSettings({match:{...state.settings.match,activeProfileId:e.target.value}});await route('smart-match',false);});document.getElementById('ra-match-new')?.addEventListener('click',async()=>{const p=await saveMatchProfile(MatchCore.createDefaultProfile('New Match Profile'));await saveSettings({match:{...state.settings.match,activeProfileId:p.profileId}});await route('smart-match',false);});document.getElementById('ra-match-duplicate')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile();const p=MatchCore.normalizeProfile({...active,profileId:'',name:`${active.name} Copy`,createdAt:'',updatedAt:''});const saved=await saveMatchProfile(p);await saveSettings({match:{...state.settings.match,activeProfileId:saved.profileId}});await route('smart-match',false);});document.getElementById('ra-match-delete')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile();if(!confirm(`Delete Match Profile "${active.name}"?`))return;await idb.delete('matchProfiles',active.profileId);await saveSettings({match:{...state.settings.match,activeProfileId:''}});await ensureDefaultMatchProfile();await route('smart-match',false);});document.getElementById('ra-match-save')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile();const criteria={};for(const key of MatchCore.CRITERIA_KEYS){const old=active.criteria[key];const enabled=!!document.querySelector(`[data-match-enabled="${key}"]`)?.checked;const weight=number(document.querySelector(`[data-match-weight="${key}"]`)?.value,old.weight);if(['company','role','availability'].includes(key))criteria[key]={enabled,weight,value:text(document.querySelector(`[data-match-value="${key}"]`)?.value)};else if(key==='salary')criteria[key]={enabled,weight,max:number(document.querySelector('[data-match-max="salary"]')?.value,old.max)};else criteria[key]={enabled,weight,target:number(document.querySelector(`[data-match-target="${key}"]`)?.value,old.target)};}const saved=await saveMatchProfile({profileId:active.profileId,name:text(document.getElementById('ra-match-name')?.value)||active.name,criteria,createdAt:active.createdAt});await saveSettings({match:{...state.settings.match,activeProfileId:saved.profileId}});toast('Match Profile saved.');await route('smart-match',false);});
    document.getElementById('ra-global-test')?.addEventListener('click',()=>testGlobalService().then(()=>toast('Global service connected.')).catch(e=>toast(e.message,true)));document.getElementById('ra-global-retry')?.addEventListener('click',()=>flushGlobalQueue(true).then(r=>toast(`Global sync processed ${r.processed}; ${r.pending} pending.`)).catch(e=>toast(e.message,true)));
    document.getElementById('ra-save-settings')?.addEventListener('click',()=>saveSettingsPage().catch(e=>toast(e.message,true)));document.getElementById('ra-set-key')?.addEventListener('click',()=>ensureApiKey(true).then(()=>toast('API key saved.')).catch(e=>toast(e.message,true)));document.getElementById('ra-cache-diagnostic')?.addEventListener('click',()=>runCacheDiagnostic().catch(e=>toast(e.message,true)));document.getElementById('ra-reset-colors')?.addEventListener('click',async()=>{await saveSettings({recruitment:{...state.settings.recruitment,stageColors:{...Runtime.STAGE_COLORS},availabilityColors:{...Runtime.AVAILABILITY_COLORS}}});await route('settings',false);});document.getElementById('ra-reset-layout')?.addEventListener('click',resetLayout);document.getElementById('ra-reset-layout-2')?.addEventListener('click',resetLayout);document.getElementById('ra-clear-scout')?.addEventListener('click',async()=>{if(!confirm('Clear local Scout cache and history?'))return;await idb.clear('scoutLatest');await idb.clear('scoutHistory');toast('Scout cache cleared.');});document.getElementById('ra-clear-recruitment')?.addEventListener('click',clearRecruitment);document.getElementById('ra-nuke')?.addEventListener('click',()=>hardReset().catch(e=>toast(e.message,true)));document.querySelectorAll('[data-go-page]').forEach(b=>b.onclick=()=>route(b.dataset.goPage));document.getElementById('ra-setting-global-test')?.addEventListener('click',()=>testGlobalService().then(()=>toast('Global service connected.')).catch(e=>toast(e.message,true)));document.getElementById('ra-setting-global-retry')?.addEventListener('click',()=>flushGlobalQueue(true).then(()=>toast('Global queue retried.')).catch(e=>toast(e.message,true)));
    document.getElementById('ra-export-csv')?.addEventListener('click',exportCsv);document.getElementById('ra-data-clear-candidates')?.addEventListener('click',clearRecruitment);document.getElementById('ra-refresh-logs')?.addEventListener('click',()=>route('logs',false));document.getElementById('ra-clear-logs')?.addEventListener('click',async()=>{if(!confirm('Clear local application logs?'))return;await idb.clear('appLogs');await route('logs',false);});
    const setVal=(id,value)=>{const el=document.getElementById(id);if(el)el.value=String(value);};setVal('ra-setting-theme',state.settings.theme);setVal('ra-setting-density',state.settings.density);setVal('ra-setting-text',state.settings.textSize);setVal('ra-setting-complexity',state.settings.complexity);setVal('ra-setting-launcher',state.settings.launcherEnabled);setVal('ra-setting-sidebar',state.settings.sidebarCollapsed);setVal('ra-setting-inactive',state.settings.includeInactive);setVal('ra-setting-train-explicit',state.settings.recruitment.explicitTrainBuyersOnly);setVal('ra-setting-candidate-view',state.settings.candidates.view);setVal('ra-setting-candidate-density',state.settings.density);setVal('ra-setting-global-enabled',state.settings.global.enabled);
  }

  let hoverOpenTimer=null,hoverCloseTimer=null;
  function closeCandidateHover(){clearTimeout(hoverOpenTimer);clearTimeout(hoverCloseTimer);const box=document.getElementById('ra-hover');if(box)box.hidden=true;}
  function scheduleCandidateHoverClose(){clearTimeout(hoverCloseTimer);hoverCloseTimer=setTimeout(closeCandidateHover,220);}
  async function openCandidateHover(id,anchor){
    clearTimeout(hoverOpenTimer);clearTimeout(hoverCloseTimer);
    const views=await candidateViews();const v=views.find(x=>String(x.userId)===String(id));const box=document.getElementById('ra-hover');
    if(!v||!box||!anchor)return;
    box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:8px"><div><b>${esc(v.name)}</b><div class="ra-muted">${esc(v.userId)}</div></div><b>Match ${scoreText(v.matchScore)}</b></div><div class="ra-hover-grid"><span>Stage<b>${esc(v.pipelineStage)}</b></span><span>Availability<b>${esc(v.availability)}</b></span><span>Fit<b>${scoreText(v.fitScore)}</b></span><span>EE<b>${formatNumber(v.ee)}</b></span><span>Looking For<b>${esc(v.lookingFor)}</b></span><span>Current Company<b>${esc(v.currentCompany||'—')}</b></span><span>MAN / INT / END<b>${formatNumber(v.man)} / ${formatNumber(v.int)} / ${formatNumber(v.end)}</b></span><span>Source<b>${esc(v.sourceType||'MANUAL')}</b></span></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" data-hover-detail="${esc(v.userId)}">View Details</button><button class="ra-btn" data-hover-scout="${esc(v.userId)}">Scout</button></div>`;
    box.hidden=false;const r=anchor.getBoundingClientRect();const br=box.getBoundingClientRect();let left=r.right+8,top=r.top;if(left+br.width>innerWidth-6)left=r.left-br.width-8;left=Math.max(6,Math.min(left,innerWidth-br.width-6));top=Math.max(6,Math.min(top,innerHeight-br.height-6));box.style.left=`${left}px`;box.style.top=`${top}px`;
    box.onpointerenter=()=>{clearTimeout(hoverCloseTimer);};box.onpointerleave=scheduleCandidateHoverClose;
    box.querySelector('[data-hover-detail]')?.addEventListener('click',()=>{closeCandidateHover();openDrawer(v.userId);});
    box.querySelector('[data-hover-scout]')?.addEventListener('click',()=>runScout([Number(v.userId)],true).catch(e=>toast(e.message,true)));
  }
  function scheduleCandidateHover(id,anchor){clearTimeout(hoverOpenTimer);hoverOpenTimer=setTimeout(()=>openCandidateHover(id,anchor).catch(()=>{}),180);}

  function bindCandidateInteractions(){document.querySelectorAll('[data-detail]').forEach(el=>{el.onclick=e=>{e.preventDefault();closeCandidateHover();openDrawer(el.dataset.detail);};el.onpointerenter=()=>scheduleCandidateHover(el.dataset.detail,el);el.onpointerleave=scheduleCandidateHoverClose;el.onfocus=()=>scheduleCandidateHover(el.dataset.detail,el);el.onblur=scheduleCandidateHoverClose;});document.querySelectorAll('[data-context-id]').forEach(el=>{el.oncontextmenu=e=>{e.preventDefault();openContextMenu(el.dataset.contextId,e.clientX,e.clientY);};el.onkeydown=e=>{if((e.shiftKey&&e.key==='F10')||e.key==='ContextMenu'){e.preventDefault();const r=el.getBoundingClientRect();openContextMenu(el.dataset.contextId,r.left+12,r.top+12);}};});document.querySelectorAll('[data-drag-id]').forEach(el=>el.ondragstart=e=>e.dataTransfer.setData('text/plain',el.dataset.dragId));document.querySelectorAll('[data-drop-stage]').forEach(stage=>{stage.ondragover=e=>e.preventDefault();stage.ondrop=async e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(id){await changeCandidateStage(id,stage.dataset.dropStage);await route('company-pipeline',false);}};});}

  function bindHelp(){document.querySelectorAll('.ra-help').forEach(button=>{button.onpointerenter=()=>{if(!state.help.pinned)openHelp(button,false);};button.onpointerleave=()=>{if(!state.help.pinned)closeHelp();};button.onfocus=()=>{if(!state.help.pinned)openHelp(button,false);};button.onblur=()=>{if(!state.help.pinned)closeHelp();};button.onclick=e=>{e.preventDefault();e.stopPropagation();if(state.help.pinned&&state.help.anchor===button)closeHelp(true);else openHelp(button,true);};});}
  function openHelp(button,pinned){const item=Runtime.HELP_REGISTRY[button.dataset.helpKey];const pop=document.getElementById('ra-help-popover');if(!item||!pop)return;state.help={pinned:!!pinned,anchor:button};pop.innerHTML=`<b>${esc(item.title)}</b><p>${esc(item.body)}</p>`;pop.hidden=false;positionHelp(button);}
  function positionHelp(button){const pop=document.getElementById('ra-help-popover');if(!pop||pop.hidden)return;const r=button.getBoundingClientRect(),margin=8,width=Math.min(340,pop.offsetWidth||300),height=Math.max(80,pop.offsetHeight||120);let left=r.right+6,top=r.top;if(left+width>innerWidth-margin)left=r.left-width-6;if(left<margin)left=Math.max(margin,Math.min(r.left,innerWidth-width-margin));if(top+height>innerHeight-margin)top=Math.max(margin,innerHeight-height-margin);pop.style.left=`${left}px`;pop.style.top=`${top}px`;}
  function closeHelp(force=false){if(state.help.pinned&&!force)return;const pop=document.getElementById('ra-help-popover');if(pop)pop.hidden=true;state.help={pinned:false,anchor:null};}

  function refreshScoutRuntimeUi(){const status=document.getElementById('ra-scout-status');if(status)status.textContent=state.scout.status;const p=document.getElementById('ra-scout-progress');if(p)p.style.width=`${state.scout.total?Math.min(100,state.scout.done/state.scout.total*100):0}%`;}
  function refreshDiscoverRuntimeUi(counters={},feed={}){const t=document.getElementById('ra-discover-progress-text');if(t)t.textContent=state.fill.running?`Company lookups ${state.fill.done}/${state.fill.total}${state.fill.errors.length?` · ${state.fill.errors.length} errors`:''}`:state.sync.running?`${feed.label||state.sync.feed} · pages ${number(counters.pagesChecked)} · posts ${number(counters.postsExamined)} · recent ${number(counters.recentPosts)} · created ${number(counters.candidatesCreated)} · updated ${number(counters.candidatesUpdated)} · train buyers ${number(counters.explicitTrainBuyers)}`:'Idle';const p=document.getElementById('ra-discover-progress');if(p)p.style.width=state.fill.running&&state.fill.total?`${state.fill.done/state.fill.total*100}%`:state.sync.running?'65%':'0%';}
  function startLogRefresh(){stopLogRefresh();state.logRefreshTimer=setInterval(()=>{if(state.page==='logs')route('logs',false).catch(()=>{});},5000);}
  function stopLogRefresh(){if(state.logRefreshTimer){clearInterval(state.logRefreshTimer);state.logRefreshTimer=null;}}

  async function saveGeometry(){const app=document.getElementById('ra-app');if(!app)return;const r=app.getBoundingClientRect();const meta=await getMeta();meta.ui=meta.ui||{};meta.ui.windowGeometry=meta.ui.windowGeometry||{};meta.ui.windowGeometry.main={x:r.left,y:r.top,width:r.width,height:r.height};await idb.put('meta',meta);}
  async function restoreGeometry(){const app=document.getElementById('ra-app');const meta=await getMeta();const g=meta.ui?.windowGeometry?.main;if(!app||!g)return;const minW=Math.min(560,innerWidth-8),minH=Math.min(420,innerHeight-8);app.style.left=`${Math.max(4,Math.min(number(g.x,20),innerWidth-48))}px`;app.style.top=`${Math.max(4,Math.min(number(g.y,50),innerHeight-48))}px`;app.style.width=`${Math.max(minW,Math.min(number(g.width,900),innerWidth-8))}px`;app.style.height=`${Math.max(minH,Math.min(number(g.height,650),innerHeight-8))}px`;}
  function bindWindow(){const app=document.getElementById('ra-app'),handle=document.getElementById('ra-titlebar');let dragging=false,dx=0,dy=0;handle.onpointerdown=e=>{if(e.target.closest('button'))return;dragging=true;const r=app.getBoundingClientRect();dx=e.clientX-r.left;dy=e.clientY-r.top;state.topZ++;app.style.zIndex=state.topZ;handle.setPointerCapture?.(e.pointerId);e.preventDefault();};handle.onpointermove=e=>{if(!dragging)return;app.style.left=`${Math.max(4,Math.min(e.clientX-dx,innerWidth-48))}px`;app.style.top=`${Math.max(4,Math.min(e.clientY-dy,innerHeight-48))}px`;};handle.onpointerup=e=>{if(!dragging)return;dragging=false;try{handle.releasePointerCapture(e.pointerId);}catch{}saveGeometry().catch(()=>{});};const ro=new ResizeObserver(()=>{clearTimeout(state.resizeTimer);state.resizeTimer=setTimeout(()=>saveGeometry().catch(()=>{}),250);});ro.observe(app);}
  function openApp(){const app=document.getElementById('ra-app');if(!app)return;app.style.display='block';state.topZ++;app.style.zIndex=state.topZ;}

  function findInformationSection(){const nodes=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span')].filter(el=>/^information$/i.test(text(el.textContent)));for(const label of nodes){let section=label.parentElement;for(let depth=0;section&&depth<5;depth++,section=section.parentElement){const links=section.querySelectorAll("a,button,[role='button']");if(links.length>=2&&links.length<=30)return section;}}return null;}
  function ensureTornLauncher(){if(document.getElementById('ra-sidebar-launcher'))return true;const section=findInformationSection();if(!section)return false;const button=document.createElement('button');button.id='ra-sidebar-launcher';button.type='button';button.title='Recruitment Agency';button.setAttribute('aria-label','Recruitment Agency');button.style.cssText='border:0;background:transparent;color:#d86a6a;padding:2px 4px;cursor:pointer;';button.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 19c.6-3.2 2.4-5 5-5s4.4 1.8 5 5M11 19c.5-2.7 2.2-4.5 5-4.5 2.5 0 4.2 1.6 5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';button.onclick=openApp;section.appendChild(button);syncLauncherVisibility();return true;}
  function syncLauncherVisibility(){const fallback=document.getElementById('ra-launch'),dock=document.getElementById('ra-sidebar-launcher');if(dock)dock.style.display=state.settings.launcherEnabled?'inline-flex':'none';if(fallback)fallback.style.display=state.settings.launcherEnabled&&!dock?'block':'none';}

  function mount(){injectStyles();const fallback=document.createElement('button');fallback.id='ra-launch';fallback.textContent='RA';fallback.title='Recruitment Agency';fallback.onclick=openApp;document.body.appendChild(fallback);const app=document.createElement('div');app.id='ra-app';app.innerHTML=`<div class="ra-titlebar" id="ra-titlebar"><div class="ra-title-brand"><span class="ra-title-mark" aria-hidden="true">◆</span><div class="ra-title-copy"><small>VOIDSMITH INDUSTRIES</small><strong>RECRUITMENT AGENCY <span class="ra-version">v${SCRIPT_VERSION}</span></strong></div></div><div class="ra-title-actions"><button class="ra-btn" id="ra-settings-button" title="Settings" aria-label="Settings">⚙</button><button class="ra-btn" id="ra-mobile-menu" aria-label="Menu">☰</button><button class="ra-btn" id="ra-close" aria-label="Close">×</button></div></div><div class="ra-shell"><aside class="ra-sidebar"><div class="ra-sidebar-head"><span class="ra-brand">RECRUITMENT</span><button class="ra-btn" id="ra-collapse" aria-label="Collapse navigation">≡</button></div><div id="ra-nav"></div></aside><main class="ra-main"><header class="ra-pagehead"><div><h2 id="ra-page-title">Search & Results</h2><p id="ra-page-desc"></p></div><div id="ra-page-actions"></div></header><div class="ra-content" id="ra-content"></div><aside id="ra-drawer" class="ra-drawer" hidden></aside><div id="ra-modal" class="ra-modal" hidden></div></main></div>`;document.body.appendChild(app);const hover=document.createElement('div');hover.id='ra-hover';hover.className='ra-hover';hover.hidden=true;hover.setAttribute('role','dialog');hover.setAttribute('aria-label','Candidate intelligence');document.body.appendChild(hover);const context=document.createElement('div');context.id='ra-context';context.hidden=true;context.setAttribute('role','menu');document.body.appendChild(context);const help=document.createElement('div');help.id='ra-help-popover';help.className='ra-help-popover';help.hidden=true;help.setAttribute('role','dialog');document.body.appendChild(help);const toasts=document.createElement('div');toasts.id='ra-toastbox';toasts.className='ra-toastbox';document.body.appendChild(toasts);document.getElementById('ra-close').onclick=()=>app.style.display='none';document.getElementById('ra-settings-button').onclick=()=>route('settings');document.getElementById('ra-collapse').onclick=async()=>{await saveSettings({sidebarCollapsed:!state.settings.sidebarCollapsed});rebuildNav();};document.getElementById('ra-mobile-menu').onclick=()=>document.querySelector('.ra-shell')?.classList.toggle('sidebar-open');document.addEventListener('click',e=>{if(!e.target.closest('#ra-context'))closeContextMenu();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeContextMenu();closeCandidateHover();closeHelp(true);closeModal();document.querySelector('.ra-shell')?.classList.remove('sidebar-open');const drawer=document.getElementById('ra-drawer');if(drawer&&!drawer.hidden){drawer.hidden=true;state.drawerCandidateId='';}}});bindWindow();rebuildNav();restoreGeometry().catch(()=>{});}

  async function start(options={}){
    if(state.mounted)return;
    state.db=options.db||await openDB(options.indexedDB);
    state.settings=mergeSettings((await getMeta()).settings||{});
    state.page=V46Navigation.normalizeRoute(state.settings.activePage,state.settings.complexity);
    if(!visibleRouteSet().has(state.page))state.page=defaultDomainRoute();
    const meta=await getMeta();meta.settings=state.settings;meta.ui=meta.ui||{windowGeometry:{}};await idb.put('meta',meta);
    await migrateLegacyUsers();await repositories.backfillLegacy(Date.now());await ensureDefaultMatchProfile();
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    applyTheme();mount();state.mounted=true;
    V46CompanyPlatform.install(companyPlatformApp,{renderInitial:false});
    V47FactionPlatform.install(companyPlatformApp,{renderInitial:false});
    await route(state.page,false);
    ensureTornLauncher();syncLauncherVisibility();
    void restorePendingPrivateChatDraft().catch(error=>toast(error.message,true));
    const observer=new MutationObserver(()=>{if(!document.getElementById('ra-sidebar-launcher'))ensureTornLauncher();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    await logEvent('startup',`Recruitment Agency v${SCRIPT_VERSION} source started`,{version:SCRIPT_VERSION,dbVersion:DB_VERSION});
    if(state.settings.global.enabled&&globalEndpoint())void flushGlobalQueue(false);
    return true;
  }

  return Object.freeze({SCRIPT_VERSION,DB_VERSION,HARD_API_RATE,MIN_API_GAP_MS,DEFAULT_VISIBLE_COLUMNS,OPTIONAL_COLUMNS,openDB,mergeSettings,start,_test:{navigate:route,state,repositories,companyRepositories,factionRepositories,recruitmentDomainForFeed,persistDiscoveredCandidate,getDiscoveryCandidate,syncDomainForums,normalizeApiSearchCandidate,persistApiSearchCandidate,searchCandidates,deleteCompanyCandidateData,clearRecruitmentData,applyCandidateFilters,candidateCsvRow,matchAvailability,forumThreadUrl,recruitCandidate,restorePendingPrivateChatDraft,findPrivateChatInput,setPrivateChatInputValue,currentProfileUserId}});
});

/* userscript bootstrap */
(() => {
  'use strict';
  const INSTALLER_VERSION = '4.8.4';
  const EXPECTED_APP_VERSION = '4.8.3';
  const DOM_GUARD = 'data-r4g3-ra-v45-owner';
  const RA_ROOT_SELECTOR = '#ra-app,#ra-hover,#ra-context,#ra-help-popover';
  const SHELL_STYLE_ID = 'ra-v454-shell-css';
  const shellUiState = {maximized:false, restoreGeometry:null, navObserver:null};

  if (window.top !== window.self) return;

  const root = document.documentElement;
  const OWNER_RELOAD_KEY = 'r4g3-ra-owner-conflict-reload';
  const existingOwner = root.getAttribute(DOM_GUARD);
  if (existingOwner) {
    if (existingOwner === INSTALLER_VERSION) return;
    const conflict = `${existingOwner}->${INSTALLER_VERSION}`;
    let previousConflict = '';
    try { previousConflict = sessionStorage.getItem(OWNER_RELOAD_KEY) || ''; } catch {}
    if (previousConflict !== conflict) {
      try { sessionStorage.setItem(OWNER_RELOAD_KEY, conflict); } catch {}
      location.reload();
      return;
    }
    try { sessionStorage.removeItem(OWNER_RELOAD_KEY); } catch {}
    const message = `Recruitment Agency ${INSTALLER_VERSION} detected another active Recruitment Agency instance (${existingOwner}). Disable or remove the older duplicate userscript, then reload Torn.`;
    console.error('[RA]', message);
    try { alert(message); } catch {}
    return;
  }
  root.setAttribute(DOM_GUARD, INSTALLER_VERSION);
  try { sessionStorage.removeItem(OWNER_RELOAD_KEY); } catch {}

  function clearDomGuard() {
    if (root.getAttribute(DOM_GUARD) === INSTALLER_VERSION) root.removeAttribute(DOM_GUARD);
  }

  function removeLegacyRecruitmentUi() {
    for (const id of ['ra-styles','ra-panel','ra-results-panel','ra-config-modal','ra-dock-fallback','ra-launcher']) {
      document.getElementById(id)?.remove();
    }
    document.querySelectorAll('.ra-dock-icon').forEach(node => node.remove());
  }

  function isRecruitmentElement(target) {
    return !!(target && typeof target.closest === 'function' && target.closest(RA_ROOT_SELECTOR));
  }

  function installClickListenerBridge() {
    if (window.__R4G3_RA_CLICK_BRIDGE__) return window.__R4G3_RA_CLICK_BRIDGE__;

    const registry = new WeakMap();
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const captureFlag = options => typeof options === 'boolean' ? options : !!options?.capture;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type === 'click' && listener && isRecruitmentElement(this)) {
        const capture = captureFlag(options);
        const entries = registry.get(this) || [];
        if (!entries.some(entry => entry.listener === listener && entry.capture === capture)) {
          entries.push({listener, capture, once:!!(options && typeof options === 'object' && options.once), options});
          registry.set(this, entries);
        }
      }
      return nativeAdd.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (type === 'click' && listener && registry.has(this)) {
        const capture = captureFlag(options);
        const remaining = registry.get(this).filter(entry => entry.listener !== listener || entry.capture !== capture);
        if (remaining.length) registry.set(this, remaining);
        else registry.delete(this);
      }
      return nativeRemove.call(this, type, listener, options);
    };

    const reportFailure = error => {
      console.error(`[RA] ${INSTALLER_VERSION} bridged click handler failed.`, error);
      try { alert(`Recruitment Agency click failed: ${error?.message || error}`); } catch {}
    };

    const bridge = {
      has(action) {
        return !!(action && (typeof action.onclick === 'function' || (registry.get(action)?.length)));
      },
      invoke(action, event) {
        let handled = false;
        if (typeof action.onclick === 'function') {
          handled = true;
          try {
            const result = action.onclick.call(action, event);
            if (result && typeof result.then === 'function') result.catch(reportFailure);
          } catch (error) {
            reportFailure(error);
          }
        }

        const entries = [...(registry.get(action) || [])];
        for (const entry of entries) {
          handled = true;
          try {
            const result = typeof entry.listener === 'function'
              ? entry.listener.call(action, event)
              : entry.listener?.handleEvent?.(event);
            if (result && typeof result.then === 'function') result.catch(reportFailure);
          } catch (error) {
            reportFailure(error);
          }
          if (entry.once) nativeRemove.call(action, 'click', entry.listener, entry.options);
        }
        return handled;
      }
    };

    window.__R4G3_RA_CLICK_BRIDGE__ = bridge;
    return bridge;
  }

  function installPrimaryInputShield(clickBridge) {
    if (window.__R4G3_RA_INPUT_SHIELD__) return;
    window.__R4G3_RA_INPUT_SHIELD__ = true;

    window.addEventListener('click', event => {
      try {
        if (event.defaultPrevented || event.button > 0) return;
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const raRoot = target.closest(RA_ROOT_SELECTOR);
        if (!raRoot) return;

        const action = target.closest('button,a,[role="button"]');
        if (!action || !raRoot.contains(action) || action.disabled || !clickBridge.has(action)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        clickBridge.invoke(action, event);
      } catch (error) {
        console.error(`[RA] ${INSTALLER_VERSION} primary click handler failed.`, error);
        try {
          alert(`Recruitment Agency click failed: ${error?.message || error}`);
        } catch {}
      }
    }, true);
  }

  function installShellResizeGuard() {
    const NativeResizeObserver = window.ResizeObserver;
    if (typeof NativeResizeObserver !== 'function') return () => {};

    class RecruitmentResizeObserver {
      constructor(callback) {
        this._native = new NativeResizeObserver((entries) => {
          const allowed = entries.filter(entry => !(entry.target?.id === 'ra-app' && entry.target.classList?.contains('ra-maximized')));
          if (allowed.length) callback(allowed, this);
        });
      }
      observe(...args) { return this._native.observe(...args); }
      unobserve(...args) { return this._native.unobserve(...args); }
      disconnect(...args) { return this._native.disconnect(...args); }
      takeRecords(...args) { return this._native.takeRecords?.(...args) || []; }
    }

    window.ResizeObserver = RecruitmentResizeObserver;
    return () => {
      if (window.ResizeObserver === RecruitmentResizeObserver) window.ResizeObserver = NativeResizeObserver;
    };
  }

  function installMaximizedDragGuard() {
    if (window.__R4G3_RA_MAX_DRAG_GUARD__) return;
    window.__R4G3_RA_MAX_DRAG_GUARD__ = true;
    window.addEventListener('pointerdown', event => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function' || target.closest('button')) return;
      const titlebar = target.closest('#ra-titlebar');
      if (!titlebar || !titlebar.closest('#ra-app.ra-maximized')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function injectShellStyles() {
    if (document.getElementById(SHELL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SHELL_STYLE_ID;
    style.textContent = `
#ra-app .ra-shell{min-height:0!important}
#ra-app .ra-main{min-height:0!important;overflow:hidden!important}
#ra-app .ra-pagehead{flex:0 0 auto!important}
#ra-app .ra-content{min-height:0!important;overflow:auto!important;flex:1 1 0!important;scrollbar-width:thin;scrollbar-color:var(--ra-accent) var(--ra-panel2)}
#ra-app .ra-content::-webkit-scrollbar{width:11px;height:11px}
#ra-app .ra-content::-webkit-scrollbar-track{background:var(--ra-panel2)}
#ra-app .ra-content::-webkit-scrollbar-thumb{background:var(--ra-accent);border:3px solid var(--ra-panel2);border-radius:99px}
#ra-app.ra-maximized{left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;border-radius:0!important;resize:none!important}
#ra-app.ra-maximized .ra-titlebar{cursor:default!important}
#ra-app .ra-table thead th{color:var(--ra-text)!important}
#ra-app .ra-table tbody td{color:var(--ra-text)!important}
#ra-app .ra-table tbody td .ra-muted{color:var(--ra-muted)!important}
#ra-app .ra-table tbody td .ra-btn,
#ra-app .ra-table tbody td input,
#ra-app .ra-table tbody td select,
#ra-app .ra-table tbody td textarea{color:var(--ra-text)!important}
#ra-app .ra-table tbody td a,
#ra-app .ra-table tbody td .ra-link{color:var(--ra-accent2)!important}
#ra-app .ra-settings summary{color:var(--ra-accent2)!important}
#ra-app .ra-settings .ra-field label{color:var(--ra-accent2)!important}
#ra-app .ra-settings .ra-field input,
#ra-app .ra-settings .ra-field select,
#ra-app .ra-settings .ra-field textarea,
#ra-app .ra-settings .ra-field option{color:var(--ra-text)!important}
#ra-app .ra-settings .ra-muted{color:var(--ra-muted)!important}
#ra-app .ra-settings .ra-danger-zone summary{color:var(--ra-danger)!important}
:root[data-ra-theme="light"] #ra-app .ra-titlebar,
:root[data-ra-theme="light"] #ra-app .ra-sidebar,
:root[data-ra-theme="light"] #ra-app .ra-panel,
:root[data-ra-theme="light"] #ra-app .ra-kpi{background:linear-gradient(180deg,var(--ra-panel2),var(--ra-panel))!important;color:var(--ra-text)!important}
:root[data-ra-theme="light"] #ra-app .ra-domain-switch,
:root[data-ra-theme="light"] #ra-app .ra-field input,
:root[data-ra-theme="light"] #ra-app .ra-field select,
:root[data-ra-theme="light"] #ra-app .ra-field textarea,
:root[data-ra-theme="light"] #ra-app .ra-log{background:var(--ra-bg)!important;color:var(--ra-text)!important}
`;
    document.head.appendChild(style);
  }

  function stripSidebarSettings() {
    document.querySelectorAll('#ra-nav [data-page="settings"]').forEach(node => node.remove());
  }

  function syncPublicVersionLabel() {
    const version = document.querySelector('#ra-titlebar .ra-version, #ra-titlebar b .ra-muted');
    if (version) version.textContent = `v${INSTALLER_VERSION}`;
  }

  function readWindowGeometry(appNode) {
    if (!appNode) return null;
    const rect = appNode.getBoundingClientRect();
    return {x:rect.left, y:rect.top, width:rect.width, height:rect.height};
  }

  function clampWindowGeometry(geometry) {
    const maxWidth = Math.max(0, window.innerWidth - 8);
    const maxHeight = Math.max(0, window.innerHeight - 8);
    const minWidth = Math.min(560, maxWidth);
    const minHeight = Math.min(420, maxHeight);
    const width = Math.max(minWidth, Math.min(Number(geometry?.width) || 900, maxWidth));
    const height = Math.max(minHeight, Math.min(Number(geometry?.height) || 650, maxHeight));
    const maxX = Math.max(4, window.innerWidth - width - 4);
    const maxY = Math.max(4, window.innerHeight - height - 4);
    return {
      x:Math.max(4, Math.min(Number(geometry?.x) || 20, maxX)),
      y:Math.max(4, Math.min(Number(geometry?.y) || 50, maxY)),
      width,
      height
    };
  }

  function applyWindowGeometry(appNode, geometry) {
    if (!appNode || !geometry) return;
    appNode.style.left = `${geometry.x}px`;
    appNode.style.top = `${geometry.y}px`;
    appNode.style.width = `${geometry.width}px`;
    appNode.style.height = `${geometry.height}px`;
  }

  function persistNormalGeometry(appModule, geometry) {
    const db = appModule?._test?.state?.db;
    if (!db || !geometry) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        const request = store.get('global');
        request.onsuccess = () => {
          const meta = request.result || {key:'global', settings:appModule._test?.state?.settings || {}};
          meta.ui = meta.ui || {};
          meta.ui.windowGeometry = meta.ui.windowGeometry || {};
          meta.ui.windowGeometry.main = {...geometry};
          store.put(meta);
        };
        request.onerror = () => reject(request.error || new Error('Failed to read Recruitment Agency geometry.'));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Failed to save Recruitment Agency geometry.'));
      } catch (error) {
        reject(error);
      }
    });
  }

  function syncMaximizeButton() {
    const button = document.getElementById('ra-maximize');
    if (!button) return;
    const label = shellUiState.maximized ? 'Restore' : 'Maximize';
    button.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  async function maximizeApp(appModule) {
    const appNode = document.getElementById('ra-app');
    if (!appNode || shellUiState.maximized) return;
    const geometry = readWindowGeometry(appNode);
    if (!geometry) return;

    const appState = appModule?._test?.state;
    if (appState?.resizeTimer) {
      clearTimeout(appState.resizeTimer);
      appState.resizeTimer = null;
    }

    shellUiState.restoreGeometry = geometry;
    shellUiState.maximized = true;
    appNode.classList.add('ra-maximized');
    syncMaximizeButton();
    try {
      await persistNormalGeometry(appModule, geometry);
    } catch (error) {
      shellUiState.maximized = false;
      appNode.classList.remove('ra-maximized');
      shellUiState.restoreGeometry = null;
      syncMaximizeButton();
      throw error;
    }
  }

  async function restoreApp(appModule) {
    const appNode = document.getElementById('ra-app');
    if (!appNode || !shellUiState.maximized) return;
    const geometry = clampWindowGeometry(shellUiState.restoreGeometry || readWindowGeometry(appNode));

    shellUiState.maximized = false;
    appNode.classList.remove('ra-maximized');
    applyWindowGeometry(appNode, geometry);
    shellUiState.restoreGeometry = null;
    syncMaximizeButton();
    await persistNormalGeometry(appModule, geometry);
  }

  async function toggleMaximize(appModule) {
    if (shellUiState.maximized) await restoreApp(appModule);
    else await maximizeApp(appModule);
  }

  function enhanceShellUi(appModule) {
    const appNode = document.getElementById('ra-app');
    const actions = appNode?.querySelector('.ra-title-actions');
    const settings = document.getElementById('ra-settings-button');
    if (!appNode || !actions || !settings) throw new Error('Recruitment Agency shell controls are unavailable.');

    injectShellStyles();
    stripSidebarSettings();
    syncPublicVersionLabel();

    const nav = document.getElementById('ra-nav');
    if (nav && !shellUiState.navObserver) {
      shellUiState.navObserver = new MutationObserver(stripSidebarSettings);
      shellUiState.navObserver.observe(nav, {childList:true, subtree:true});
    }

    let maximize = document.getElementById('ra-maximize');
    if (!maximize) {
      maximize = document.createElement('button');
      maximize.type = 'button';
      maximize.className = 'ra-btn';
      maximize.id = 'ra-maximize';
      maximize.textContent = 'Maximize';
      maximize.title = 'Maximize';
      maximize.setAttribute('aria-label', 'Maximize');
      actions.insertBefore(maximize, settings);
    }
    maximize.onclick = () => toggleMaximize(appModule).catch(error => {
      console.error(`[RA] ${INSTALLER_VERSION} maximize/restore failed.`, error);
      try { alert(`Recruitment Agency window control failed: ${error?.message || error}`); } catch {}
    });
    syncMaximizeButton();
  }

  removeLegacyRecruitmentUi();
  const clickBridge = installClickListenerBridge();
  installPrimaryInputShield(clickBridge);
  installMaximizedDragGuard();

  const app = window.RA_V45App;
  if (!app || typeof app.start !== 'function') {
    clearDomGuard();
    const message = `Recruitment Agency ${INSTALLER_VERSION} could not load its application module. Update or reinstall the userscript so Tampermonkey refreshes the pinned runtime files.`;
    console.error('[RA]', message);
    alert(message);
    return;
  }

  if (String(app.SCRIPT_VERSION || '') !== EXPECTED_APP_VERSION) {
    clearDomGuard();
    const message = `Recruitment Agency ${INSTALLER_VERSION} detected a mismatched runtime (${app.SCRIPT_VERSION || 'unknown'}). Update or reinstall the userscript before continuing.`;
    console.error('[RA]', message);
    alert(message);
    return;
  }

  const restoreResizeObserver = installShellResizeGuard();
  app.start().then(() => {
    restoreResizeObserver();
    enhanceShellUi(app);
  }).catch(error => {
    restoreResizeObserver();
    clearDomGuard();
    console.error(`[RA] ${INSTALLER_VERSION} failed to start.`, error);
    alert(`Recruitment Agency could not start: ${error?.message || error}`);
  });
})();
