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


  const RECRUITMENT_FIT_DEFAULT_WEIGHTS = Object.freeze({
    requirements:28,
    eligibility:20,
    activity:15,
    scoutFit:12,
    organization:10,
    intent:15,
    contact:10
  });

  function uniqueText(values=[]) {
    const seen=new Set(),out=[];
    for(const value of values){const cleaned=text(value);if(!cleaned)continue;const key=cleaned.toLowerCase();if(seen.has(key))continue;seen.add(key);out.push(cleaned);}
    return out;
  }

  function normalizeSourceLabel(value) {
    const raw=text(value),key=lower(raw);
    if(!raw)return '';
    if(/job seeker|company forum|faction forum|recruitment forum|forum/.test(key))return 'Recruitment Forum';
    if(/leaderboard|work[- ]?stat/.test(key))return 'Work-Stat Leaderboard';
    if(/user search|api search|torn search|search/.test(key))return 'Torn User Search';
    if(/scout/.test(key))return 'Scout';
    if(/global|existing intelligence|player intelligence/.test(key))return 'Existing Intelligence';
    if(/manual/.test(key))return 'Manual';
    return raw;
  }

  function candidateRecordOf(row,domain='company') {
    if(domain==='faction')return row?.factionRecord||row?.candidateLocal||row?.candidate||{};
    return row?.companyRecord||row?.candidateLocal||row?.candidate||{};
  }

  function timestamp(value) {
    const n=finite(value);
    if(n!==null&&n>0)return n < 1e12 ? n*1000 : n;
    const parsed=Date.parse(value);
    return Number.isFinite(parsed)?parsed:null;
  }

  function latestTimestamp(values=[]) {
    const known=values.map(timestamp).filter(v=>v!==null);
    return known.length?Math.max(...known):null;
  }

  function earliestTimestamp(values=[]) {
    const known=values.map(timestamp).filter(v=>v!==null);
    return known.length?Math.min(...known):null;
  }

  function domainStageOf(row={},domain='company') {
    const record=candidateRecordOf(row,domain);
    const stage=text(row?.pipelineStage||record?.pipelineStage);
    return stage||(domain==='faction'?'Prospect':'Not Contacted');
  }

  function prospectProvenance(row={},options={}) {
    const domain=options.domain==='faction'?'faction':'company';
    const record=candidateRecordOf(row,domain);
    const candidate=candidateOf(row);
    const player=row?.playerRecord||row?.player||row;
    const latestSource=row?.latestSource||candidate?.latestSource||{};
    const rawSources=uniqueText([
      ...(Array.isArray(record?.discoverySources)?record.discoverySources:[]),
      ...(Array.isArray(candidate?.discoverySources)?candidate.discoverySources:[]),
      ...(Array.isArray(row?.discoverySources)?row.discoverySources:[]),
      row?.sourceType,candidate?.sourceType,latestSource?.sourceType,latestSource?.source
    ]);
    const sources=uniqueText(rawSources.map(normalizeSourceLabel));
    const firstDiscoveredAt=earliestTimestamp([
      record?.newlyDiscoveredAt,record?.createdAt,candidate?.createdAt,candidate?.firstSeenAt,row?.createdAt,row?.firstSeenAt,
      latestSource?.postedAt,latestSource?.observedAt
    ]);
    const observedEvidenceAt=latestTimestamp([
      candidate?.lastSeenAt,row?.lastSeenPost,row?.lastObservedAt,
      player?.lastSeenAt,player?.lastScoutAt,latestSource?.postedAt,latestSource?.observedAt
    ]);
    const lastObservedAt=observedEvidenceAt??latestTimestamp([
      record?.newlyDiscoveredAt,record?.createdAt,candidate?.createdAt,row?.createdAt
    ]);
    const lastEnrichedAt=latestTimestamp([
      row?.lastEnrichedAt,player?.lastEnrichedAt,player?.lastScoutAt,row?.scout?.capturedAt
    ]);
    const now=timestamp(options.nowMs)||Date.now();
    const ageMs=lastObservedAt===null?null:Math.max(0,now-lastObservedAt);
    const freshness=ageMs===null?'Unknown':ageMs<=86400000?'Fresh':ageMs<=7*86400000?'Recent':ageMs<=30*86400000?'Aging':'Stale';
    const stage=domainStageOf(row,domain);
    const explicitForum=sources.includes('Recruitment Forum');
    const passiveSource=sources.includes('Work-Stat Leaderboard')||sources.includes('Torn User Search');
    const terminal=['Hired','Rejected','Joined'].includes(stage);
    let state='Known Candidate';
    if(!terminal&&ageMs!==null&&ageMs>60*86400000)state='Reactivation Candidate';
    else if(!terminal&&(explicitForum||['Shortlisted','Contacted','Replied'].includes(stage)))state='Active Lead';
    else if(!terminal&&passiveSource)state='Passive Prospect';
    return Object.freeze({
      sources:Object.freeze(sources),
      rawSources:Object.freeze(rawSources),
      firstDiscoveredAt,
      lastObservedAt,
      lastEnrichedAt,
      freshness,
      state
    });
  }

  function activityFactor(lastActive,nowMs=Date.now()) {
    const ts=timestamp(lastActive);
    if(ts===null)return null;
    const age=Math.max(0,nowMs-ts);
    if(age<=3600000)return 1;
    if(age<=86400000)return .9;
    if(age<=3*86400000)return .75;
    if(age<=7*86400000)return .55;
    if(age<=30*86400000)return .25;
    return 0;
  }

  function organizationFactor(row,domain='company') {
    const direct=domain==='faction'
      ? text(row?.currentFaction||row?.factionName||row?.player?.factionName||row?.playerRecord?.factionName||row?.currentOrganizationLabel)
      : text(row?.currentCompany||row?.playerRecord?.currentCompany||row?.player?.currentCompany||row?.currentOrganizationLabel);
    if(!direct||/^unknown$/i.test(direct))return null;
    if(/^(none|no company|no faction|unemployed)$/i.test(direct))return 1;
    return .25;
  }

  function intentFactor(provenance) {
    const sources=provenance?.sources||[];
    if(sources.includes('Recruitment Forum'))return 1;
    if(sources.includes('Torn User Search'))return .65;
    if(sources.includes('Work-Stat Leaderboard'))return .55;
    if(sources.includes('Existing Intelligence')||sources.includes('Scout'))return .45;
    if(sources.includes('Manual'))return .4;
    return sources.length?.4:null;
  }

  function eligibilityFactor(row) {
    const score=finite(row?.eligibilityScore??row?.matchScore??row?.specialistMatchScore);
    if(score!==null)return Math.max(0,Math.min(1,score>1?score/100:score));
    const label=lower(row?.eligibility);
    if(!label||label==='unknown')return null;
    if(label.includes('eligible by waiver'))return .8;
    if(label==='eligible'||label.includes('eligible'))return 1;
    if(label.includes('not currently eligible')||label.includes('ineligible'))return 0;
    return null;
  }

  function contactFactor(row,domain='company',nowMs=Date.now(),exclusionWindowDays=7) {
    const record=candidateRecordOf(row,domain);
    const outcomes=Array.isArray(record?.outcomes)?record.outcomes:[];
    const lastContactAt=latestTimestamp([
      row?.lastContactAt,record?.lastContactAt,
      ...outcomes.map(item=>item?.at??item?.createdAt??item?.timestamp)
    ]);
    if(lastContactAt!==null){
      const age=Math.max(0,nowMs-lastContactAt);
      if(age<Math.max(1,finite(exclusionWindowDays)??7)*86400000)return .2;
      return .85;
    }
    const stage=domainStageOf(row,domain);
    if(stage==='Not Contacted'||stage==='Prospect')return 1;
    if(stage==='Shortlisted'||stage==='Evaluating')return .9;
    if(stage==='Contacted'||stage==='Invite Ready')return .35;
    if(stage==='Replied')return .55;
    if(stage==='Hired'||stage==='Rejected'||stage==='Joined')return 0;
    return null;
  }

  function workStatFactor(row,requirements={}) {
    const specs=[
      ['man',finite(requirements.minMan??requirements.man)],
      ['int',finite(requirements.minInt??requirements.int)],
      ['end',finite(requirements.minEnd??requirements.end)]
    ].filter(([,threshold])=>threshold!==null&&threshold>0);
    if(!specs.length)return {factor:null,coverage:0,reason:'No work-stat requirement configured.'};
    let known=0,total=0;
    for(const[key,threshold]of specs){
      const value=finite(row?.[key]??row?.stats?.[key]);
      if(value===null)continue;
      known++;
      total+=Math.max(0,Math.min(1,value/threshold));
    }
    if(!known)return {factor:null,coverage:0,reason:'Required work stats are not known.'};
    return{
      factor:total/known,
      coverage:known/specs.length,
      reason:`${known}/${specs.length} configured work-stat requirement${specs.length===1?'':'s'} measured.`
    };
  }

  function recruitmentFit(row={},options={}) {
    const domain=options.domain==='faction'?'faction':'company';
    const now=timestamp(options.nowMs)||Date.now();
    const weights={...RECRUITMENT_FIT_DEFAULT_WEIGHTS,...(options.weights||{})};
    const requirements=options.requirements||{};
    const provenance=prospectProvenance(row,{domain,nowMs:now});
    const components=[];
    let possibleWeight=0,knownWeight=0,weighted=0;

    const add=(key,label,weight,factor,reason,coverage=1)=>{
      const safeWeight=Math.max(0,finite(weight)??0);
      if(!safeWeight)return;
      possibleWeight+=safeWeight;
      const known=factor!==null&&factor!==undefined&&Number.isFinite(Number(factor));
      const evidenceWeight=known?safeWeight*Math.max(0,Math.min(1,finite(coverage)??1)):0;
      const normalized=known?Math.max(0,Math.min(1,Number(factor))):null;
      if(known){knownWeight+=evidenceWeight;weighted+=evidenceWeight*normalized;}
      components.push(Object.freeze({key,label,weight:safeWeight,evidenceWeight,known,factor:normalized,points:known?evidenceWeight*normalized:null,reason:text(reason)}));
    };

    const work=workStatFactor(row,requirements);
    if(Object.values(requirements).some(value=>finite(value)!==null&&finite(value)>0))add('requirements','Work-stat match',weights.requirements,work.factor,work.reason,work.coverage);

    if(options.useEligibility!==false){
      const elig=eligibilityFactor(row);
      add('eligibility','Role / eligibility match',weights.eligibility,elig,
        elig===null?'No role or eligibility evaluation is available.':'Uses the existing domain eligibility/match evaluation.');
    }

    const activity=activityFactor(row?.lastActive??row?.lastActionTs??row?.playerRecord?.lastActive??row?.player?.lastActive,now);
    add('activity','Recent activity',weights.activity,activity,
      activity===null?'Last activity is unknown.':'Based on observed last-action recency.');

    const scout=finite(row?.fit??row?.scoutFit??row?.playerRecord?.fit??row?.player?.fit);
    add('scoutFit','Scout Fit signal',weights.scoutFit,scout===null?null:Math.max(0,Math.min(1,scout/100)),
      scout===null?'Scout Fit is unavailable.':'Existing Scout Fit is used only as one activity-quality signal; it remains a separate metric.');

    const org=organizationFactor(row,domain);
    add('organization',domain==='faction'?'Faction availability':'Company availability',weights.organization,org,
      org===null?'Current organization state is unknown.':org===1?'No current organization detected.':'Currently belongs to an organization.');

    const intent=intentFactor(provenance);
    add('intent','Recruitment intent / source',weights.intent,intent,
      intent===null?'No discovery provenance is available.':`Derived from: ${provenance.sources.join(', ')}.`);

    const contact=contactFactor(row,domain,now,options.exclusionWindowDays);
    add('contact','Contact timing',weights.contact,contact,
      contact===null?'Contact timing is unknown.':'Uses existing contact/stage history to avoid over-prioritizing recently contacted candidates.');

    const score=knownWeight>0?Math.round((weighted/knownWeight)*1000)/10:null;
    const coverage=possibleWeight>0?knownWeight/possibleWeight:0;
    let confidence=coverage>=.72?'High':coverage>=.42?'Medium':'Low';
    if(provenance.freshness==='Stale'&&confidence==='High')confidence='Medium';
    if(provenance.freshness==='Stale'&&confidence==='Medium'&&coverage<.58)confidence='Low';
    return Object.freeze({
      score,
      confidence,
      coverage:Math.round(coverage*1000)/1000,
      provenance,
      components:Object.freeze(components)
    });
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
    activeFilterCount,
    RECRUITMENT_FIT_DEFAULT_WEIGHTS,
    normalizeSourceLabel,
    domainStageOf,
    prospectProvenance,
    recruitmentFit
  });
});
