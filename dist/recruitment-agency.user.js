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
  const SCOUT_STATUS_ORDER = Object.freeze(['live','fresh','cached','provisional','stale','failed','unscouted']);

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





  function scoutOf(row) { return row?.scout || (row?.w30 || row?.profile ? row : null); }
  function profileOf(row) { return scoutOf(row)?.profile || row?.api || row?.profile || {}; }
  function candidateOf(row) { return row?.candidateLocal || row?.candidate || {}; }



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
    if(n!==null)return n>0?(n < 1e12 ? n*1000 : n):null;
    if(value===null||value===undefined||value==='')return null;
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
    // candidateLocal belongs to Company; never import its provenance into Faction.
    const candidate=domain==='faction'?null:candidateOf(row);
    const player=row?.playerRecord||row?.player||row;
    const latestSource=domain==='faction'?(record?.latestSource||{}):(row?.latestSource||candidate?.latestSource||{});
    const rawSources=uniqueText([
      ...(Array.isArray(record?.discoverySources)?record.discoverySources:[]),
      ...(Array.isArray(candidate?.discoverySources)?candidate.discoverySources:[]),
      ...(Array.isArray(row?.discoverySources)?row.discoverySources:[]),
      row?.sourceType,candidate?.sourceType,latestSource?.sourceType,latestSource?.feedId,latestSource?.kind
    ]);
    const sources=uniqueText(rawSources.map(normalizeSourceLabel));
    const firstDiscoveredAt=earliestTimestamp([
      record?.newlyDiscoveredAt,record?.createdAt,candidate?.createdAt,candidate?.firstSeenAt,row?.createdAt,row?.firstSeenAt,
      latestSource?.postedAt,latestSource?.observedAt
    ]);
    const observedEvidenceAt=latestTimestamp([
      candidate?.lastSeenAt,row?.lastSeenPost,row?.lastObservedAt,
      player?.lastObservedAt,player?.lastSeenAt,player?.lastScoutAt,latestSource?.postedAt,latestSource?.observedAt
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
    else if(!terminal&&(explicitForum||['Shortlisted','Contacted','Replied','Evaluating','Invite Ready'].includes(stage)))state='Active Lead';
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
    const player=row?.playerRecord||row?.player||{};
    const direct=domain==='faction'
      ? text(row?.currentFaction||row?.factionName||player?.factionName||row?.currentOrganizationLabel)
      : text(row?.currentCompany||player?.currentCompany||row?.currentOrganizationLabel);
    if(direct&&!/^unknown$/i.test(direct)){
      if(/^(none|no company|no faction|unemployed)$/i.test(direct))return 1;
      return .25;
    }
    const rawId=domain==='faction'
      ? (row?.factionId??player?.factionId)
      : (row?.currentCompanyId??player?.currentCompanyId);
    if(rawId===null||rawId===undefined||rawId==='')return null;
    const id=Number(rawId);
    if(!Number.isFinite(id)||id<0)return null;
    return id===0?1:.25;
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
    const label=lower(row?.eligibility);
    if(label.includes('not eligible')||label.includes('not currently eligible')||label.includes('ineligible'))return 0;
    const score=finite(row?.eligibilityScore??row?.matchScore??row?.specialistMatchScore);
    if(score!==null)return Math.max(0,Math.min(1,score/100));
    if(!label||label==='unknown')return null;
    if(label.includes('eligible by waiver'))return .8;
    if(label==='eligible')return 1;
    return null;
  }

  function contactFactor(row,domain='company',nowMs=Date.now(),exclusionWindowDays=7) {
    const record=candidateRecordOf(row,domain);
    const stage=domainStageOf(row,domain);
    if(stage==='Hired'||stage==='Rejected'||stage==='Joined')return 0;
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

    // Contact timing and discovery provenance are not suitability evidence.
    const hasSuitabilityEvidence=components.some(item=>item.known&&item.evidenceWeight>0&&
      ['requirements','eligibility','activity','scoutFit','organization'].includes(item.key));
    const score=knownWeight>0&&hasSuitabilityEvidence?Math.round((weighted/knownWeight)*1000)/10:null;
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
    SCOUT_STATUS_ORDER,
    COMPANY_KEYS,
    classifyScoutStatus,
    RECRUITMENT_FIT_DEFAULT_WEIGHTS,
    normalizeSourceLabel,
    domainStageOf,
    prospectProvenance,
    recruitmentFit
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

  const COMPANY_SEARCH_FILTER_KEYS = Object.freeze(['search','minEnd','minMan','minInt','onlineStatus','organization','organizationPresence']);

  function normalizeCompanySearchFilters(input) {
    const source=input&&typeof input==='object'?input:{};
    const out={};
    for(const key of COMPANY_SEARCH_FILTER_KEYS)out[key]=cleanText(source[key]);
    const presence=cleanText(out.organizationPresence).toLowerCase();
    out.organizationPresence=['any','none','has'].includes(presence)?presence:'any';
    const status=cleanText(out.onlineStatus);
    out.onlineStatus=['Online','Idle','Offline'].includes(status)?status:'';
    return out;
  }

  function normalizeProfile(input) {
    const source = input && typeof input === 'object' ? input : {};
    const hasCriteria = !!(source.criteria && typeof source.criteria === 'object');
    const criteriaSource = hasCriteria ? source.criteria : {};
    const criteria = {};
    CRITERIA_KEYS.forEach((key) => {
      criteria[key] = normalizeCriterion(key, criteriaSource[key], hasCriteria);
    });
    const searchSource=source.searchFilters&&typeof source.searchFilters==='object'?source.searchFilters:{};
    return {
      profileId: cleanText(source.profileId) || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanText(source.name) || 'Smart Match',
      criteria,
      searchFilters:{company:normalizeCompanySearchFilters(searchSource.company)},
      searchFiltersCustom:source.searchFiltersCustom===true,
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
    normalizeCompanySearchFilters,
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






  function tornProfileUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/profiles.php?XID=${id}` : '';
  }


  return Object.freeze({
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    composeCandidateView,
    tornProfileUrl
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

  const COMPANY_RECRUITMENT_PLACEHOLDERS = Object.freeze(['name','company_name','company_type']);
  const FACTION_RECRUITMENT_PLACEHOLDERS = Object.freeze(['name','faction_name']);
  const TORN_CHAT_MAX_LENGTH = 840;
  const PRIVATE_CHAT_DRAFT_KEY = 'r4g3-ra-private-chat-draft';
  const PRIVATE_CHAT_DRAFT_TTL_MS = 2 * 60 * 1000;
  const DEFAULT_COMPANY_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI own a {company_type} company called {company_name}. I noticed that you currently are not working for a company and was wondering whether you would be interested in joining us.\n\nWe are actively recruiting and I would be happy to discuss the position with you if you are interested.';
  const DEFAULT_FACTION_RECRUITMENT_MESSAGE = 'Hello {name},\n\nI noticed that you currently are not in a faction. I would like to invite you to join {faction_name}.\n\nWe are currently looking for active players who would like to become part of the team. If you are interested, I would be happy to tell you more.';

  function text(value) { return String(value ?? '').trim(); }


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
      dncOverrideConfirmed:plan?.dncOverrideConfirmed===true,
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



  return Object.freeze({
    COMPANY_RECRUITMENT_PLACEHOLDERS,
    FACTION_RECRUITMENT_PLACEHOLDERS,
    TORN_CHAT_MAX_LENGTH,
    PRIVATE_CHAT_DRAFT_KEY,
    PRIVATE_CHAT_DRAFT_TTL_MS,
    DEFAULT_COMPANY_RECRUITMENT_MESSAGE,
    DEFAULT_FACTION_RECRUITMENT_MESSAGE,
    cleanPreparedText,
    recruitmentPlaceholders,
    prepareRecruitmentMessage,
    companyRecruitmentEligibility,
    factionRecruitmentEligibility,
    profileUrl,
    recruitmentChatPlan,
    queuePrivateChatDraft,
    consumePrivateChatDraft
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
    for (const key of SHARED_PLAYER_FIELDS) if (key!=='lastObservedAt'&&Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    const previousObserved=Number(existing?.lastObservedAt),incomingObserved=Number(patch?.lastObservedAt);const hasPreviousObserved=Number.isFinite(previousObserved)&&previousObserved>0,hasIncomingObserved=Number.isFinite(incomingObserved)&&incomingObserved>0;if(hasPreviousObserved||hasIncomingObserved)next.lastObservedAt=Math.max(hasPreviousObserved?previousObserved:0,hasIncomingObserved?incomingObserved:0);
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
      if(options.skipShared!==true)await players.ensure(id,{...candidateSharedPatch(recruitmentPatch),...definedPatch(options.sharedPatch || {})},options.source || 'company',observedAt);
      const existing = await idb.get('companyRecruitment',id);
      const input = {...(existing || {}),...recruitmentPatch,userId:id};
      if (!Object.prototype.hasOwnProperty.call(recruitmentPatch,'updatedAt')) input.updatedAt = observedAt;
      // Keep fields written by earlier versions (for example removed workflow pages) that the normalizer does not know.
      const next = {...(existing || {}),...Domain.normalizeCompanyRecruitment(input,observedAt,{ambiguous:options.ambiguous === true,assumed:options.assumed === true})};
      await idb.put('companyRecruitment',next);
      return next;
    }

    async function ensureFaction(userId, recruitmentPatch = {}, options = {}) {
      const id = Domain.normalizeUserId(userId);
      const observedAt = legacyTimestamp(options.observedAt,Date.now());
      if(options.skipShared!==true)await players.ensure(id,{...candidateSharedPatch(recruitmentPatch),...definedPatch(options.sharedPatch || {})},options.source || 'faction',observedAt);
      const existing = await idb.get('factionRecruitment',id);
      const input = {...(existing || {}),...recruitmentPatch,userId:id};
      if (!Object.prototype.hasOwnProperty.call(recruitmentPatch,'updatedAt')) input.updatedAt = observedAt;
      // Keep fields written by earlier versions (for example removed workflow pages) that the normalizer does not know.
      const next = {...(existing || {}),...Domain.normalizeFactionRecruitment(input,observedAt,{ambiguous:options.ambiguous === true})};
      await idb.put('factionRecruitment',next);
      return next;
    }

    function addObservation(map,userId,patch,source,observedAt,fallbackAt=Date.now()) {
      let id;
      try { id = Domain.normalizeUserId(userId); } catch { return; }
      const explicitAt=legacyTimestamp(observedAt,0);
      const hasExplicitAt=Number.isFinite(explicitAt)&&explicitAt>0;
      const processingAt=hasExplicitAt?explicitAt:0;
      const clean = definedPatch({...patch,...(hasExplicitAt?{lastObservedAt:explicitAt}:{})});
      const list = map.get(id) || [];
      list.push({patch:clean,source,observedAt:processingAt});
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
        age:profile.age,
        factionId:profile.factionId,
        factionName:profile.factionName,
        networth:snapshot.extra?.networth,
        activeStreak:snapshot.extra?.activeStreak,
        bestActiveStreak:snapshot.extra?.bestActiveStreak,
        fit:snapshot.currentFit ?? snapshot.originalFit,
        fitType:snapshot.official ? 'official' : (snapshot.provisionalSource ? 'provisional' : 'unmeasured'),
        lastActive:profile.lastActionTs ? Number(profile.lastActionTs) * 1000 : null,
        lastScoutAt:snapshot.capturedAt,
        lastObservedAt:snapshot.capturedAt
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
        activeStreak:global.activeStreak,
        bestActiveStreak:global.bestActiveStreak,
        scoutStatus:global.scoutStatus,
        lastGlobalAt:global.observedAt,
        lastObservedAt:global.observedAt
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
        addObservation(observations,row.userId,candidateSharedPatch(row),'legacy-candidate',row.companyCheckedAt || row.lastSeenPost || row.observedAt || row.postedAt || row.postDate,observedAt);
      }
      for (const row of forumSources) {
        addObservation(observations,row.userId,{name:row.authorName},'legacy-forum',row.lastSeenPost || row.postedAt || row.observedAt,observedAt);
      }
      for (const row of users) {
        addObservation(observations,row.userId,{...candidateSharedPatch(row),name:row.name,ee:row.ee},'legacy-user',row.lastSeenPost || row.postedAt || row.postDate,observedAt);
      }
      for (const row of scouts) {
        addObservation(observations,row.userId,scoutSharedPatch(row),'scout',row.capturedAt,observedAt);
      }
      for (const row of globals) {
        addObservation(observations,row.userId ?? row.playerId,globalSharedPatch(row),'global',row.observedAt,observedAt);
      }

      for (const [userId,list] of observations.entries()) {
        list.sort((a,b)=>a.observedAt-b.observedAt);
        let current=await idb.get('playerIntelligence',userId);
        for (const item of list) {
          const currentObserved=Number(current?.lastObservedAt),incomingObserved=Number(item.patch?.lastObservedAt);
          const currentIsAuthoritative=Number.isFinite(currentObserved)&&currentObserved>0;
          const incomingHasObservation=Number.isFinite(incomingObserved)&&incomingObserved>0;
          const incomingIsNewer=incomingHasObservation&&(!currentIsAuthoritative||incomingObserved>currentObserved);
          let patch=item.patch;
          if(current&&(!incomingHasObservation||(currentIsAuthoritative&&!incomingIsNewer))){
            const safe={};
            for(const [key,value] of Object.entries(item.patch||{})){
              if(key==='lastObservedAt')continue;
              const existing=current?.[key];
              if(existing===undefined||existing===null||existing==='')safe[key]=value;
            }
            patch=safe;
          }
          current=await players.ensure(userId,patch,item.source,item.observedAt);
        }
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
          const existing = await idb.get('companyRecruitment',userId);
          if(!existing){
            const converted = Domain.legacyCandidateToCompany(candidate,at,{ambiguous,assumed:!knownEvidence});
            await idb.put('companyRecruitment',converted);
            companyCount += 1;
          }
        }

        if (domains.includes('faction')) {
          const existing = await idb.get('factionRecruitment',userId);
          if(!existing){
            const converted = Domain.legacyCandidateToFaction(candidate,at,{ambiguous});
            await idb.put('factionRecruitment',converted);
            factionCount += 1;
          }
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
    Object.freeze({id:'company-candidates',label:'Search & Results',core:true})
  ]);

  const FACTION_PAGES = Object.freeze([
    Object.freeze({id:'faction-candidates',label:'Search & Results',core:true})
  ]);

  const GROUPS = Object.freeze([
    Object.freeze({id:'company-recruitment',label:'COMPANY',pages:COMPANY_PAGES}),
    Object.freeze({id:'faction-recruitment',label:'FACTION',pages:FACTION_PAGES}),
    Object.freeze({id:'intelligence',label:'OPTIONAL TOOLS',pages:Object.freeze([
      Object.freeze({id:'company-discover',label:'Forum Discovery',flag:'companyDiscovery'}),
      Object.freeze({id:'scout',label:'Scout',flag:'scout'}),
      Object.freeze({id:'smart-match',label:'Smart Match',flag:'smartMatch'}),
      Object.freeze({id:'global-intelligence',label:'Global Intelligence',flag:'globalIntelligence'})
    ])}),
    Object.freeze({id:'application',label:'ADVANCED',pages:Object.freeze([
      Object.freeze({id:'data',label:'Data',flag:'data'})
    ])})
  ]);

  const GROUP_IDS = Object.freeze(GROUPS.map(group => group.id));
  const ROUTES = Object.freeze([...GROUPS.flatMap(group => group.pages.map(page => page.id)),'settings']);

  function normalizeRoute(value) {
    const requested = String(value || '').trim().toLowerCase();
    return ROUTES.includes(requested) ? requested : 'company-candidates';
  }

  function moduleEnabled(settings, page) {
    if (page.core) return true;
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
    const requested = new Set(value.map(item => String(item || '').trim().toLowerCase()));
    return GROUP_IDS.filter(id => requested.has(id));
  }

  function toggleExpandedGroup(current, groupId) {
    const id = String(groupId || '').trim().toLowerCase();
    const normalized = normalizeExpandedGroups(Array.isArray(current) ? current : undefined);
    if (!GROUP_IDS.includes(id)) return normalized;
    const open = new Set(normalized);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    return GROUP_IDS.filter(group => open.has(group));
  }

  return Object.freeze({COMPANY_PAGES,FACTION_PAGES,GROUPS,GROUP_IDS,ROUTES,normalizeRoute,visibleGroups,normalizeExpandedGroups,toggleExpandedGroup});
});

/* bundled runtime: v46-recruitment-shared.js */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46RecruitmentShared=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let idSequence=0;
  function makeId(prefix){const uuid=globalThis.crypto?.randomUUID?.();if(uuid)return `${prefix}-${uuid}`;idSequence=(idSequence+1)%1000000;return `${prefix}-${Date.now()}-${idSequence}`;}

  function normalizeKind(value){return text(value).toLowerCase()==='hard'?'Hard':'Preferred';}
  function normalizeRequirement(raw={},index=0){const field=text(raw.field);return{id:text(raw.id)||`${field||'criterion'}-${index+1}`,field,operator:text(raw.operator||'gte').toLowerCase(),value:raw.value,value2:raw.value2,kind:normalizeKind(raw.kind),label:text(raw.label)||field||`Criterion ${index+1}`,weight:Math.max(0,number(raw.weight,1))};}
  function normalizeBaseline(config={}){return{criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),updatedAt:number(config.updatedAt,0)};}
  function compare(operator,actual,value,value2){
    if(actual===undefined||actual===null||actual==='')return{known:false,passed:false};
    const op=text(operator).toLowerCase();
    if(op==='gte'||op==='gt'||op==='lte'||op==='lt'){const a=Number(actual),b=Number(value);if(!Number.isFinite(a)||!Number.isFinite(b))return{known:false,passed:false};if(op==='gte')return{known:true,passed:a>=b};if(op==='gt')return{known:true,passed:a>b};if(op==='lte')return{known:true,passed:a<=b};return{known:true,passed:a<b};}
    if(op==='between'){const a=Number(actual),lo=Number(value),hi=Number(value2);if(![a,lo,hi].every(Number.isFinite))return{known:false,passed:false};return{known:true,passed:a>=Math.min(lo,hi)&&a<=Math.max(lo,hi)};}
    if(op==='contains')return{known:true,passed:text(actual).toLowerCase().includes(text(value).toLowerCase())};
    if(op==='oneof'){const allowed=(Array.isArray(value)?value:[value]).map(item=>text(item).toLowerCase());return{known:true,passed:allowed.includes(text(actual).toLowerCase())};}
    return{known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
  }
  // waiverFor(requirementId) is supplied by each domain, so Company and Faction waiver scoping stay separate.
  function evaluateCriteria(criteria=[],facts={},waiverFor=()=>null){
    const results=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement).map(req=>{const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);const waiver=req.kind==='Hard'&&verdict.known&&!verdict.passed?waiverFor(req.id):null;return{...req,known:verdict.known,passed:verdict.passed,waived:Boolean(waiver),waiver,effectivePass:verdict.passed||Boolean(waiver)};});
    const hardFailures=results.filter(r=>r.kind==='Hard'&&r.known&&!r.passed),unknownHard=results.filter(r=>r.kind==='Hard'&&!r.known),unwaivedHardFailures=hardFailures.filter(r=>!r.waived),failures=results.filter(r=>r.known&&!r.passed),known=results.filter(r=>r.known);
    const totalWeight=known.reduce((sum,r)=>sum+(r.weight||1),0),earned=known.filter(r=>r.passed).reduce((sum,r)=>sum+(r.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):null,hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':unknownHard.length?'Unknown':'Eligible';
    return{results,failures,hardFailures,unknownHard,unwaivedHardFailures,hardFailed,eligibility,score};
  }

  function applyStoreDefinitions(db,definitions){for(const[storeName,definition]of Object.entries(definitions)){if(db.objectStoreNames.contains(storeName))continue;const store=db.createObjectStore(storeName,{keyPath:definition.keyPath});for(const index of definition.indexes)store.createIndex(index.name,index.keyPath,{unique:false});}}
  function normalizeDomainConfig(raw,key,extra={}){const thresholds={};for(const[k,value]of Object.entries(raw.stageThresholds||{})){const days=Math.max(0,Math.floor(number(value,0)));if(days>0)thresholds[text(k)]=days;}const weights={};for(const[k,value]of Object.entries(raw.opportunityWeights||{}))weights[text(k)]=Math.max(0,number(value,0));return{key,baseline:normalizeBaseline(raw.baseline||{}),stageThresholds:thresholds,opportunityWeights:weights,...extra,updatedAt:number(raw.updatedAt,Date.now())};}

  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const RESULTS_PAGE_SIZE=100;
  const NUMERIC_SORT_KEYS=['level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit'];
  const SORT_KEYS=new Set(['player',...NUMERIC_SORT_KEYS,'lastActive']);
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  // spec: {player:'playerRecord'|'player', name:'currentCompany'|'factionName', id:'currentCompanyId'|'factionId', label:'Company'|'Faction'}
  function organizationInfoFor(spec){return function organizationInfo(row={}){const player=row[spec.player]||{};const name=text(row[spec.name]||player[spec.name]);const rawId=row[spec.id]??player[spec.id];if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`${spec.label} #${id}`};}}return{state:'unknown',label:'Unknown'};};}
  function belowMin(row,key,min){return min!==null&&(!Number.isFinite(Number(row[key]))||row[key]===null||row[key]===undefined||row[key]===''||Number(row[key])<min);}
  function filterRows(rows,filters={},organizationInfo){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return(Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(belowMin(row,'end',minEnd)||belowMin(row,'man',minMan)||belowMin(row,'int',minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(NUMERIC_SORT_KEYS.includes(key)){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const sign=sortState?.direction==='desc'?-1:1;return[...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  function normalizeResultsView(raw={}){const src=raw&&typeof raw.filters==='object'&&raw.filters?raw.filters:{};const filters={...DEFAULT_SEARCH_FILTERS};for(const key of Object.keys(DEFAULT_SEARCH_FILTERS))if(src[key]!==undefined&&src[key]!==null)filters[key]=text(src[key]);if(!['any','has','none'].includes(filters.organizationPresence))filters.organizationPresence='any';const key=SORT_KEYS.has(text(raw?.sort?.key))?text(raw.sort.key):DEFAULT_SORT.key;return{filters,sort:{key,direction:raw?.sort?.direction==='desc'?'desc':'asc'},resultPage:Math.max(0,Math.floor(number(raw?.resultPage,0))),profileId:text(raw?.profileId),profileVersion:text(raw?.profileVersion)};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbWrite(db,store,op,arg,result,verb){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store)[op](arg);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error(`Failed to ${verb} ${store}.`));}catch(error){reject(error);}});}
  function dbPut(db,store,value){return dbWrite(db,store,'put',value,value,'save');}
  function dbDelete(db,store,key){return dbWrite(db,store,'delete',key,true,'delete from');}

  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus).toLowerCase();if(status==='online')return '<span class="ra-online-live">Online</span>';if(status==='idle')return '<span class="ra-online-idle">Idle</span>';if(status==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function recruitmentFitCell(row={}){if(row.recruitmentFit===null||row.recruitmentFit===undefined||text(row.recruitmentFit)==='')return '<span class="ra-muted">—</span>';const value=Number(row.recruitmentFit);if(!Number.isFinite(value))return '<span class="ra-muted">—</span>';const confidence=text(row.recruitmentConfidence)||'Low';return `<span title="Recruitment Fit · ${esc(confidence)} confidence"><b>${value.toFixed(1)}</b><small class="ra-muted"> ${esc(confidence)}</small></span>`;}
  function provenanceCell(row={}){const p=row.prospectProvenance||{};const source=Array.isArray(p.sources)&&p.sources.length?p.sources[0]:'Unknown';const state=text(row.prospectState)||text(p.state)||'Known Candidate';return `<span title="${esc(state)}"><b>${esc(source)}</b><small class="ra-muted"> · ${esc(state)}</small></span>`;}
  const known=value=>value!==null&&value!==undefined&&text(value)!==''&&Number.isFinite(Number(value));
  function battleCell(row){const a=known(row.attacks30),r=known(row.rwHits30);if(!a&&!r)return '—';return `${a?Number(row.attacks30).toLocaleString():'—'} / ${r?Number(row.rwHits30).toLocaleString():'—'}`;}

  // Criterion editor rows. prefix '' keeps Company's data-criterion-* attributes; 'faction-' keeps Faction's.
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);
  function renderCriterionRow(raw={},scope='baseline',prefix='',defaultField='level'){
    const a=`data-${prefix}criterion`,req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||defaultField,operator:text(raw.operator)||'gte',kind:text(raw.kind)==='Hard'?'Hard':'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    const options=(list,current)=>list.map(item=>`<option value="${item}" ${item===current?'selected':''}>${item}</option>`).join('');
    return `<div class="ra-formgrid" ${a}-row ${a}-id="${esc(req.id)}"${prefix?` ${a}-scope="${esc(scope)}"`:''} style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input ${a}-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select ${a}-field="field">${options(CRITERION_FIELDS,req.field)}</select></div><div class="ra-field"><label>Operator</label><select ${a}-field="operator">${options(CRITERION_OPERATORS,req.operator)}</select></div><div class="ra-field"><label>Type</label><select ${a}-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind==='Preferred'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input ${a}-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input ${a}-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-${prefix}remove-criterion="${esc(scope)}">×</button></div>`;
  }
  function readCriteria(host,prefix=''){if(!host)return[];const a=`data-${prefix}criterion`;return[...host.querySelectorAll(`[${a}-row]`)].map((row,index)=>{const get=key=>row.querySelector(`[${a}-field="${key}"]`)?.value??'';const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;return{id:text(row.getAttribute(`${a}-id`))||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};});}

  // Results table. spec: {domain,label,orgHeader,orgPlaceholder,columns,contactedStages,messageCell,profileBar,headActions,extraButtons}
  function sortHeader(domain,key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-${domain}-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  const STAT_COLUMNS={level:'Level',age:'Age',man:'MAN',int:'INT',end:'END',networth:'Net Worth',activity30:'30d Active',activeStreak:'Streak',xanax30:'Xanax 30d'};
  function column(key,spec){
    if(STAT_COLUMNS[key])return[[key,STAT_COLUMNS[key]],row=>stat(row[key])];
    return({
      player:[['player','Player'],row=>`<a class="ra-link" href="#" data-player-card="${esc(row.userId)}" data-player-domain="${spec.domain}">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small>`],
      drug:['Drug Use',row=>esc(text(row.drugUse)||'—')],
      battle:['Battle / RW',battleCell],
      org:[spec.orgHeader,row=>esc(row.currentOrganizationLabel||'Unknown')],
      lastActive:[['lastActive','Last Online'],lastOnlineHtml],
      recruitmentFit:[['recruitmentFit','Recruit Fit'],recruitmentFitCell],
      fit:['Recruit Fit',recruitmentFitCell],
      source:['Source',provenanceCell],
      contacted:['Contacted',row=>{if(Array.isArray(row.outcomes)&&row.outcomes.length)return 'Contacted';return spec.contactedStages.includes(text(row.pipelineStage).toLowerCase())?'Contacted':'Not yet';}],
      message:['Message',spec.messageCell]
    })[key];
  }
  function resultsTable(rows,keys,sort,spec,className){const cols=keys.map(key=>column(key,spec));const head=cols.map(([h])=>`<th>${Array.isArray(h)?sortHeader(spec.domain,h[0],h[1],sort):h}</th>`).join('');const body=rows.map(row=>`<tr>${cols.map(([,cell])=>`<td>${cell(row)}</td>`).join('')}</tr>`).join('');return `<table class="ra-table ra-core-results ${className}"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${cols.length}">No matching ${spec.label} candidates.</td></tr>`}</tbody></table>`;}
  function renderResults(rows=[],options={},spec){
    rows=Array.isArray(rows)?rows:[];const d=spec.domain,L=spec.label,filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'},layout=options.layout==='compact'?'compact':'expanded';const total=Number.isFinite(Number(options.total))?Number(options.total):rows.length;
    const pagination=options.pagination||{page:0,pageCount:1,start:0,end:rows.length};const filteredTotal=Number.isFinite(Number(options.filteredTotal))?Number(options.filteredTotal):rows.length;
    const rangeText=filteredTotal?`${Number(pagination.start||0)+1}-${Number(pagination.end||0)}`:'0';
    const pager=`<div class="ra-actions"><button type="button" class="ra-btn" data-results-page="prev" ${Number(pagination.page||0)<=0?'disabled':''}>Previous</button><span class="ra-muted">${rangeText} of ${filteredTotal}</span><button type="button" class="ra-btn" data-results-page="next" ${Number(pagination.page||0)>=Number(pagination.pageCount||1)-1?'disabled':''}>Next</button></div>`;
    const table=layout==='compact'?resultsTable(rows,['player','end','man','int','lastActive','fit','message'],sort,spec,'ra-results-compact'):resultsTable(rows,spec.columns,sort,spec,'ra-results-expanded');
    const status=text(filters.onlineStatus).toLowerCase(),presence=filters.organizationPresence;
    const input=(key,label,value,placeholder)=>`<div class="ra-field"><label>${label}</label><input id="ra-${d}-filter-${key}" value="${esc(value||'')}" placeholder="${placeholder}"></div>`;
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Find players, narrow the list with filters, then message the ones you want.</p></div>${spec.headActions||''}</div>${spec.profileBar||''}<div class="ra-formgrid ra-core-search-grid">${input('search','Name / ID',filters.search,'Player name or ID')}<div class="ra-field"><label>Status</label><select id="ra-${d}-filter-status"><option value="">Any</option>${['Online','Idle','Offline'].map(s=>`<option value="${s}" ${status===s.toLowerCase()?'selected':''}>${s}</option>`).join('')}</select></div>${input('organization',`Current ${L}`,filters.organization,spec.orgPlaceholder)}<div class="ra-field"><label>${L} Presence</label><select id="ra-${d}-filter-organization-presence"><option value="any" ${!presence||presence==='any'?'selected':''}>Any</option><option value="none" ${presence==='none'?'selected':''}>None</option><option value="has" ${presence==='has'?'selected':''}>Has ${L}</option></select></div>${input('end','END ≥',filters.minEnd,'e.g. 100k')}${input('man','MAN ≥',filters.minMan,'e.g. 50k')}${input('int','INT ≥',filters.minInt,'e.g. 50k')}</div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-${d}-search-apply">Search</button><button type="button" class="ra-btn" id="ra-${d}-search-clear">Clear</button>${spec.extraButtons||''}</div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${filteredTotal} matching of ${total} ${L} candidate(s).</p></div><div class="ra-actions"><button type="button" class="ra-btn ${layout==='expanded'?'ra-primary':''}" data-results-layout="expanded">Expanded</button><button type="button" class="ra-btn ${layout==='compact'?'ra-primary':''}" data-results-layout="compact">Compact</button></div></div><div class="ra-table-wrap">${table}</div><div class="ra-panel-foot">${pager}</div></section>`;
  }

  // Search & Results page controller. Each call builds an independent runtime, so Company and Faction
  // keep their own filters, sort, paging and profile state.
  // spec: {domain,label,logTag,routes,implemented,meta,organizationInfo,buildRows(app),selectProfile(app),beforePage(app,ctx),renderHtml(app,sorted,options,ctx),bindControls(),goPageSelector}
  function createResultsPlatform(spec){
    const d=spec.domain,route=`${d}-candidates`,IMPLEMENTED_ROUTES=new Set(spec.implemented);
    const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT},hofOffset:0,resultPage:0};
    const isRoute=value=>spec.routes.includes(text(value));
    function routeMeta(page){const [title,description]=spec.meta[text(page)]||spec.meta[`${d}-overview`];return{title,description};}
    const filter=(rows,filters)=>filterRows(rows,filters,spec.organizationInfo);
    function savedResultsView(app){const raw=app?._test?.state?.settings?.candidates?.resultsView?.[d];return raw&&typeof raw==='object'?normalizeResultsView(raw):null;}
    async function persistResultsView(app){if(typeof app?.saveResultsView!=='function')return;const view=normalizeResultsView({filters:runtime.searchFilters,sort:runtime.sort,resultPage:runtime.resultPage,profileId:runtime.profileFiltersId,profileVersion:runtime.profileFiltersVersion});const key=JSON.stringify(view);if(key===runtime.savedResultsViewKey)return;runtime.savedResultsViewKey=key;await app.saveResultsView(d,view);}
    async function persistRoute(app,page){const state=app?._test?.state;if(!state?.db)return false;state.page=page;state.settings=state.settings||{};state.settings.activePage=page;const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};meta.settings={...(meta.settings||{}),activePage:page};await dbPut(state.db,'meta',meta);return true;}
    function claimRoute(app,page){const state=app?._test?.state,r=text(page);if(!state||!IMPLEMENTED_ROUTES.has(r))return false;state.page=r;state.settings=state.settings||{};state.settings.activePage=r;return true;}
    function navigate(page,persist=true){const r=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(r))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(r,persist));claimRoute(runtime.app,r);return renderPage(r,{persist});}
    async function rowFor(userId){const rows=await spec.buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error(`${spec.label} candidate was not found.`);return row;}
    function reportError(error){console.error(spec.logTag,error);try{globalThis.alert?.(`${spec.label} Recruitment failed: ${error?.message||error}`);}catch{}}
    const rerender=()=>renderPage(route,{persist:false});
    function readVisibleSearchFilters(){const v=key=>text(document.getElementById(`ra-${d}-filter-${key}`)?.value);return{search:v('search'),minEnd:v('end'),minMan:v('man'),minInt:v('int'),onlineStatus:v('status'),organization:v('organization'),organizationPresence:v('organization-presence')||'any'};}
    function bindContentControls(){
      document.getElementById(`ra-${d}-search-apply`)?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.resultPage=0;runtime.searchFilters=readVisibleSearchFilters();try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates(d,runtime.searchFilters);await rerender();}catch(error){reportError(error);rerender().catch(reportError);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
      document.getElementById(`ra-${d}-search-clear`)?.addEventListener('click',()=>{runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};rerender().catch(reportError);});
      document.querySelectorAll(`#ra-content [data-${d}-sort]`).forEach(button=>{button.onclick=()=>{runtime.resultPage=0;runtime.sort=toggleSort(runtime.sort,button.getAttribute(`data-${d}-sort`));rerender().catch(reportError);};});
      document.querySelectorAll('#ra-content [data-results-page]').forEach(button=>{button.onclick=()=>{runtime.resultPage=Math.max(0,runtime.resultPage+(button.dataset.resultsPage==='next'?1:-1));rerender().catch(reportError);};});
      document.querySelectorAll('#ra-content [data-results-layout]').forEach(button=>{button.onclick=()=>{if(typeof runtime.app?.setResultsLayout!=='function')return;runtime.app.setResultsLayout(button.dataset.resultsLayout).then(rerender).catch(reportError);};});
      document.querySelectorAll('#ra-content [data-player-card]').forEach(link=>{link.onclick=event=>{event.preventDefault();runtime.app?.openPlayerCard?.(d,link.dataset.playerCard);};});
      document.querySelectorAll(spec.goPageSelector).forEach(button=>{if(!isRoute(button.dataset.goPage))return;button.onclick=event=>{event?.preventDefault?.();navigate(button.dataset.goPage,true).catch(reportError);};});
      spec.bindControls();
    }
    async function renderPage(page,options={}){
      const app=runtime.app;page=text(page);
      if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
      if(options.persist!==false)claimRoute(app,page);
      const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
      if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
      const rows=await spec.buildRows(app);
      const ctx=await spec.selectProfile(app);const selected=ctx.selected;const selectedId=text(selected?.profileId);const selectedVersion=text(selected?.updatedAt);
      if(!runtime.profileFiltersInitialized||runtime.profileFiltersId!==selectedId||runtime.profileFiltersVersion!==selectedVersion){const saved=runtime.profileFiltersInitialized?null:savedResultsView(app);if(saved)runtime.sort=saved.sort;if(saved&&saved.profileId===selectedId&&saved.profileVersion===selectedVersion){runtime.searchFilters=saved.filters;runtime.resultPage=saved.resultPage;}else{runtime.searchFilters=selected?spec.profileSearchFilters(selected):{...DEFAULT_SEARCH_FILTERS};runtime.resultPage=0;}runtime.profileFiltersInitialized=true;runtime.profileFiltersId=selectedId;runtime.profileFiltersVersion=selectedVersion;}
      const sortedAll=sortRows(filter(rows,runtime.searchFilters),runtime.sort).map(row=>({...row,currentOrganizationLabel:spec.organizationInfo(row).label}));
      if(spec.beforePage)await spec.beforePage(app,ctx);
      const pageCount=Math.max(1,Math.ceil(sortedAll.length/RESULTS_PAGE_SIZE));runtime.resultPage=Math.min(Math.max(0,runtime.resultPage),pageCount-1);const start=runtime.resultPage*RESULTS_PAGE_SIZE;const sorted=sortedAll.slice(start,start+RESULTS_PAGE_SIZE);
      await persistResultsView(app).catch(error=>console.warn('[RA] Results view was not saved.',error));
      const html=await spec.renderHtml(app,sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length,filteredTotal:sortedAll.length,layout:app._test.state.settings?.candidates?.resultsLayout,pagination:{page:runtime.resultPage,pageSize:RESULTS_PAGE_SIZE,pageCount,start,end:start+sorted.length}},ctx);
      if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
      const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
      document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));bindContentControls();if(options.persist!==false)await persistRoute(app,page);return true;
    }
    function bindNav(){if(!runtime.app)return;document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};});}
    function syncNavigation(){bindNav();return true;}
    function install(app,options={}){if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');uninstall();runtime.app=app;runtime.installed=true;runtime.profileFiltersInitialized=false;runtime.savedResultsViewKey='';runtime.profileFiltersId='';runtime.profileFiltersVersion='';bindNav();const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);return true;}
    function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.app=null;runtime.installed=false;}
    return{runtime,route,IMPLEMENTED_ROUTES,isRoute,routeMeta,filterRows:filter,persistRoute,navigate,rowFor,reportError,rerender,readVisibleSearchFilters,renderPage,syncNavigation,install,uninstall};
  }

  return Object.freeze({
    text,number,esc,makeId,
    normalizeKind,normalizeRequirement,normalizeBaseline,compare,evaluateCriteria,
    applyStoreDefinitions,normalizeDomainConfig,
    DEFAULT_SEARCH_FILTERS,DEFAULT_SORT,RESULTS_PAGE_SIZE,SORT_KEYS,parseThreshold,organizationInfoFor,filterRows,sortRows,toggleSort,normalizeResultsView,
    dbGetAll,dbGet,dbPut,dbDelete,
    relativeLastActive,stat,lastOnlineHtml,recruitmentFitCell,provenanceCell,CRITERION_FIELDS,CRITERION_OPERATORS,renderCriterionRow,readCriteria,renderResults,
    createResultsPlatform
  });
});

/* bundled runtime: v46-company-core.js */
(function(root,factory){
  let Shared=root&&root.RA_V46RecruitmentShared;
  if(!Shared&&typeof module==='object'&&module.exports)Shared=require('./v46-recruitment-shared');
  const api=factory(Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Shared){
  'use strict';
  if(!Shared)throw new Error('RA_V46RecruitmentShared is required.');

  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);
  const {text}=Shared;

  function waiverFor(requirementId,waivers=[]){
    return (Array.isArray(waivers)?waivers:[]).find(w=>text(w.requirementId)===text(requirementId)&&['active','review due'].includes(text(w.state).toLowerCase()))||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[]){return Shared.evaluateCriteria(criteria,facts,id=>waiverFor(id,waivers));}

  return Object.freeze({
    REQUIREMENT_KINDS,normalizeBaseline:Shared.normalizeBaseline,evaluateCriteria
  });
});

/* bundled runtime: v46-company-storage.js */
(function(root,factory){
  let CompanyCore=root&&root.RA_V46CompanyCore,Shared=root&&root.RA_V46RecruitmentShared;
  if(typeof module==='object'&&module.exports){CompanyCore=CompanyCore||require('./v46-company-core');Shared=Shared||require('./v46-recruitment-shared');}
  const api=factory(CompanyCore,Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(CompanyCore,Shared){
  'use strict';
  if(!CompanyCore||!Shared)throw new Error('RA_V46CompanyCore is required.');

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

  function applyUpgrade(db){Shared.applyStoreDefinitions(db,STORE_DEFINITIONS);}
  function normalizeConfig(raw={}){return Shared.normalizeDomainConfig(raw,'company');}

  function createRepositories(idb){
    if(!idb||!['get','put'].every(name=>typeof idb[name]==='function'))throw new Error('A compatible IndexedDB adapter is required.');

    const config={
      async get(){const existing=await idb.get('companyRecruitmentConfig','company');return normalizeConfig(existing||{});},
      async save(raw){const existing=await config.get();const next=normalizeConfig({...existing,...raw,key:'company',updatedAt:Date.now()});await idb.put('companyRecruitmentConfig',next);return next;}
    };

    return Object.freeze({config:Object.freeze(config)});
  }

  return Object.freeze({DB_VERSION,STORE_DEFINITIONS,applyUpgrade,normalizeConfig,createRepositories});
});

/* bundled runtime: v46-company-ui.js */
(function(root,factory){
  const deps={CompanyCore:root&&root.RA_V46CompanyCore,Shared:root&&root.RA_V46RecruitmentShared};
  if(typeof module==='object'&&module.exports){deps.CompanyCore=require('./v46-company-core');deps.Shared=require('./v46-recruitment-shared');}
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,Shared}=D;
  if(!CompanyCore||!Shared)throw new Error('CompanyCore is required.');
  const COMPANY_STAGES=Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const {text,esc}=Shared;
  function normalizeStage(value){const raw=text(value).toLowerCase();return COMPANY_STAGES.find(stage=>stage.toLowerCase()===raw)||'Not Contacted';}

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
        userId,name:text(player.name)||`User ${userId}`,level:player.level??null,age:player.age??player.ageDays??null,ee:player.ee??null,fit:player.fit??null,fitType:text(player.fitType),recruitmentFit:player.recruitmentFit??null,
        lastActive:player.lastActive??null,onlineStatus:text(player.onlineStatus),activity30:player.activity30??null,activeStreak:player.activestreak??player.activeStreak??null,drugUse:player.drugUse??player.drugUseLabel??null,xanax30:player.xanax30??null,refills30:player.refills30??null,
        attacks30:player.attacks30??null,rwHits30:player.rwHits30??null,networth:player.networth??null,currentCompany:text(player.currentCompany),
        pipelineStage:normalizeStage(record.pipelineStage),availability:text(record.availability)||'Unknown',desiredCompany:text(record.desiredCompany),desiredRole:text(record.desiredRole),
        expectedSalary:record.expectedSalary??null,recruiterNote:text(record.recruiterNote),followUps:Array.isArray(record.followUps)?record.followUps.map(item=>({...item})):[],
        campaigns:Array.isArray(record.campaigns)?[...record.campaigns]:[],outcomes:Array.isArray(record.outcomes)?record.outcomes.map(item=>({...item})):[],tags:Array.isArray(record.tags)?[...record.tags]:[],
        doNotContact:record.doNotContact===true,archived:record.archived===true,createdAt:record.createdAt??null,updatedAt:record.updatedAt??null,
        stageChangedAt:record.stageChangedAt??record.updatedAt??null,newlyDiscoveredAt:record.newlyDiscoveredAt??null,newlyEligibleAt:record.newlyEligibleAt??null,
        eligibility:text(evaluation.eligibility)||'Unknown',eligibilityScore:evaluation.score===null||evaluation.score===undefined||text(evaluation.score)===''?null:(Number.isFinite(Number(evaluation.score))?Number(evaluation.score):null),hardFailed:evaluation.hardFailed===true,
        companyRecord:record,playerRecord:player
      });
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }




  const COLUMNS=['player','level','age','man','int','end','drug','activity30','activeStreak','org','lastActive','recruitmentFit','source','contacted','message'];
  function renderCandidates(rows=[],options={}){
    const profiles=Array.isArray(options.profiles)?options.profiles:[],activeProfileId=text(options.activeProfileId);
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${text(profile.profileId)===activeProfileId?'selected':''}>${esc(profile.name)}</option>`).join('');
    const profileBar=`<div class="ra-actions ra-profile-bar"><label class="ra-muted" for="ra-company-profile-select">Recruitment profile</label><select id="ra-company-profile-select" class="ra-btn">${profileOptions}</select><button type="button" class="ra-btn" id="ra-company-profile-apply" ${profiles.length?'':'disabled'}>Apply Profile</button><button type="button" class="ra-btn" id="ra-company-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><details class="ra-profile-more"><summary class="ra-btn">More…</summary><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-profile-save-search" ${profiles.length?'':'disabled'}>Save Search to Profile</button><button type="button" class="ra-btn" id="ra-company-profile-manage">Manage Profiles</button></div></details></div>`;
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-company-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-company-recruit="${esc(row.userId)}">Message</button>`;
    return Shared.renderResults(rows,options,{domain:'company',label:'Company',orgHeader:'Employment',orgPlaceholder:'Company name',columns:COLUMNS,contactedStages:['contacted','replied','hired'],messageCell,profileBar,extraButtons:'<button type="button" class="ra-btn" id="ra-company-hof-discover" title="Import one bounded page of public work-stat HOF prospects without per-player enrichment">Discover Workstat Prospects</button>'});
  }

  function renderCriterionRow(raw={},scope='baseline'){return Shared.renderCriterionRow(raw,scope,'','ee');}

  function renderBaselineEditor(config={},options={}){
    const criteria=Array.isArray(config.baseline?.criteria)?config.baseline.criteria:[];
    return `<details class="ra-panel" id="ra-company-baseline-editor" ${options.open?'open':''}><summary><b>Eligibility baseline</b> <span class="ra-muted">${criteria.length} criteria</span></summary><p class="ra-muted">Hard criteria mark candidates as not eligible in results. Preferred criteria only affect quality.</p><div id="ra-company-baseline-criteria" data-criteria-host>${criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-baseline-add">Add criterion</button><button type="button" class="ra-btn ra-primary" id="ra-company-baseline-save">Save Baseline</button></div></details>`;
  }
  return Object.freeze({COMPANY_STAGES,buildCandidateRows,renderCandidates,renderCriterionRow,renderBaselineEditor});
});

/* bundled runtime: v46-company-platform.js */
(function(root,factory){
  const deps={
    CompanyCore:root&&root.RA_V46CompanyCore,
    CompanyUI:root&&root.RA_V46CompanyUI,
    Messaging:root&&root.RA_V45Messaging,
    ResultsCore:root&&root.RA_ResultsCore,
    Shared:root&&root.RA_V46RecruitmentShared
  };
  if(typeof module==='object'&&module.exports){
    deps.CompanyCore=require('./v46-company-core');
    deps.CompanyUI=require('./v46-company-ui');
    deps.Messaging=require('./v45-messaging');
    deps.ResultsCore=require('./results-core');
    deps.Shared=require('./v46-recruitment-shared');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,CompanyUI,Messaging,ResultsCore,Shared}=D;
  if(!CompanyCore||!CompanyUI||!Messaging||!ResultsCore||!Shared)throw new Error('CompanyCore, CompanyUI, Messaging and ResultsCore are required.');

  const {text,makeId,dbGetAll,dbGet,dbPut,DEFAULT_SEARCH_FILTERS,RESULTS_PAGE_SIZE,sortRows,toggleSort}=Shared;
  const COMPANY_ROUTES=Object.freeze(['company-discover','company-candidates']);
  const organizationInfo=Shared.organizationInfoFor({player:'playerRecord',name:'currentCompany',id:'currentCompanyId',label:'Company'});
  function profileRequirements(profile={}){
    const criteria=profile?.criteria||{},out={};
    for(const [key,target] of [['man','minMan'],['int','minInt'],['end','minEnd']]){
      const criterion=criteria[key];
      const value=criterion?.enabled===true?Number(criterion.target):NaN;
      if(Number.isFinite(value)&&value>0)out[target]=value;
    }
    return out;
  }
  function profileSearchFilters(profile={}){
    const saved=profile?.searchFilters?.company||{};
    const filters={...DEFAULT_SEARCH_FILTERS,...saved};
    const requirements=profileRequirements(profile);
    for(const key of ['minMan','minInt','minEnd'])if(profile.searchFiltersCustom!==true&&!text(saved[key])&&requirements[key])filters[key]=String(requirements[key]);
    return filters;
  }

  async function getConfig(app){if(app?._test?.companyRepositories?.config?.get)return app._test.companyRepositories.config.get();return(await dbGet(app._test.state.db,'companyRecruitmentConfig','company'))||{key:'company',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.companyRepositories?.config?.save)return app._test.companyRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentConfig',next);return next;}

  async function buildRows(app){
    const db=app._test.state.db;
    const[companyRecords,players,candidateLocals,config,activeProfile]=await Promise.all([dbGetAll(db,'companyRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),typeof app.getActiveMatchProfile==='function'?app.getActiveMatchProfile():Promise.resolve(null)]);
    const baseline=CompanyCore.normalizeBaseline(config.baseline||{});
    const rows=CompanyUI.buildCandidateRows(companyRecords,players,{eligibilityFor:(record,player)=>CompanyCore.evaluateCriteria(baseline.criteria,player,record.waivers||[])});
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return rows.map(row=>{
      const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.playerRecord||{};
      const enriched={...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),candidateLocal:candidate};
      const intelligence=ResultsCore.recruitmentFit(enriched,{domain:'company',useEligibility:false,requirements:profileRequirements(activeProfile||{})});
      return{...enriched,recruitmentFit:intelligence.score,recruitmentConfidence:intelligence.confidence,recruitmentFitBreakdown:intelligence.components,prospectProvenance:intelligence.provenance,prospectState:intelligence.provenance.state,intelligenceFreshness:intelligence.provenance.freshness};
    });
  }

  const P=Shared.createResultsPlatform({
    domain:'company',label:'Company',logTag:'[RA v4.6 Company]',routes:COMPANY_ROUTES,implemented:['company-candidates'],goPageSelector:'#ra-content [data-go-page]',
    meta:{'company-discover':['Forum Discovery','Official Torn forum recruitment sources.'],'company-candidates':['Company Candidates','Search and manage Company recruitment candidates.']},
    organizationInfo,buildRows,profileSearchFilters,
    async selectProfile(app){return{selected:typeof app.getActiveMatchProfile==='function'?await app.getActiveMatchProfile():null};},
    async beforePage(app,ctx){ctx.profiles=typeof app.listMatchProfiles==='function'?await app.listMatchProfiles():[];ctx.activeProfile=typeof app.getActiveMatchProfile==='function'?await app.getActiveMatchProfile():null;},
    async renderHtml(app,sorted,options,ctx){const baselineHtml=CompanyUI.renderBaselineEditor(await getConfig(app),{open:runtime.baselineEditorOpen===true});return CompanyUI.renderCandidates(sorted,{...options,profiles:ctx.profiles,activeProfileId:ctx.activeProfile?.profileId||''})+baselineHtml;},
    bindControls
  });
  const {runtime,renderPage,reportError}=P;
  const readCriteria=host=>Shared.readCriteria(host);

  async function recruitPlayer(userId,override=false){const row=await P.rowFor(userId);if(row.companyRecord?.doNotContact===true&&override!==true)throw new Error('This candidate is marked Do Not Contact. Use the explicit override only when you deliberately intend to contact them.');if(override){if(typeof globalThis.confirm!=='function')throw new Error('Do Not Contact override confirmation is unavailable. Recruitment stopped.');if(!globalThis.confirm('This candidate is marked Do Not Contact. Override it for this recruitment chat only?'))return false;}if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');return runtime.app.recruitCandidate?.('company',text(userId),row.name,{overrideDnc:override,dncConfirmed:override});}

  function bindControls(){
    const on=(id,handler)=>document.getElementById(id)?.addEventListener('click',handler);
    on('ra-company-profile-apply',async()=>{try{const id=text(document.getElementById('ra-company-profile-select')?.value);if(!id)throw new Error('Choose a Match Profile first.');if(typeof runtime.app?.setActiveMatchProfile!=='function')throw new Error('Match Profiles are unavailable.');const profile=await runtime.app.setActiveMatchProfile(id);runtime.resultPage=0;runtime.searchFilters=profileSearchFilters(profile);await P.rerender();}catch(error){reportError(error);}});
    on('ra-company-profile-clear',async()=>{try{if(typeof runtime.app?.setActiveMatchProfile!=='function')throw new Error('Match Profiles are unavailable.');await runtime.app.setActiveMatchProfile('');runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};await P.rerender();}catch(error){reportError(error);}});
    on('ra-company-profile-save-search',async()=>{try{const id=text(document.getElementById('ra-company-profile-select')?.value);if(!id)throw new Error('Choose a Match Profile first.');if(typeof runtime.app?.saveCompanySearchProfile!=='function')throw new Error('Saving Match Profile searches is unavailable.');runtime.searchFilters=P.readVisibleSearchFilters();await runtime.app.saveCompanySearchProfile(id,runtime.searchFilters);await P.rerender();}catch(error){reportError(error);}});
    on('ra-company-profile-manage',()=>runtime.app?.navigate?.('smart-match',true));
    on('ra-company-hof-discover',async event=>{const button=event?.currentTarget;try{if(button){button.disabled=true;button.textContent=runtime.hofOffset>0?'Loading next 100…':'Discovering…';}if(typeof runtime.app?.discoverWorkstatProspects!=='function')throw new Error('Work-stat HOF discovery is unavailable.');const result=await runtime.app.discoverWorkstatProspects({limit:100,offset:runtime.hofOffset});runtime.hofOffset=Math.max(runtime.hofOffset,Number(result?.nextOffset||runtime.hofOffset));await P.rerender();}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent=runtime.hofOffset>0?'Discover Next 100':'Discover Workstat Prospects';}}});
    const baselineEditor=document.getElementById('ra-company-baseline-editor');
    if(baselineEditor){baselineEditor.ontoggle=()=>{runtime.baselineEditorOpen=baselineEditor.open;};baselineEditor.onclick=event=>{const target=event.target;if(target?.closest?.('[data-remove-criterion]')){target.closest('[data-criterion-row]')?.remove();return;}if(target?.id==='ra-company-baseline-add'){document.getElementById('ra-company-baseline-criteria')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('baseline')},'baseline'));return;}if(target?.id==='ra-company-baseline-save'){runtime.baselineEditorOpen=true;saveConfig(runtime.app,{baseline:{criteria:readCriteria(document.getElementById('ra-company-baseline-criteria'))}}).then(P.rerender).catch(reportError);}};}
    document.querySelectorAll('#ra-content [data-company-recruit]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruit,false).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit-override]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruitOverride,true).catch(reportError);});
  }

  return Object.freeze({COMPANY_ROUTES,isCompanyRoute:P.isRoute,routeMeta:P.routeMeta,install:P.install,uninstall:P.uninstall,renderPage,syncNavigation:P.syncNavigation,_test:{buildRows,persistRoute:P.persistRoute,dbGetAll,dbGet,dbPut,readCriteria,filterRows:P.filterRows,sortRows,toggleSort,profileRequirements,profileSearchFilters,organizationInfo,RESULTS_PAGE_SIZE,IMPLEMENTED_ROUTES:P.IMPLEMENTED_ROUTES}});
});

/* bundled runtime: v47-faction-core.js */
(function(root,factory){
  let Shared=root&&root.RA_V46RecruitmentShared;
  if(!Shared&&typeof module==='object'&&module.exports)Shared=require('./v46-recruitment-shared');
  const api=factory(Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Shared){
  'use strict';
  if(!Shared)throw new Error('RA_V46RecruitmentShared is required.');

  const FACTION_STAGES=Object.freeze([
    'Prospect','Contacted','Replied','Evaluating','Invite Ready','Joined','Rejected','Deferred'
  ]);
  const PROFILE_STATES=Object.freeze(['Draft','Active','Paused','Archived']);
  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);

  const {text,number,normalizeRequirement,normalizeBaseline,compare}=Shared;
  function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,number(value)));}

  const FACTION_SEARCH_FILTER_KEYS=Object.freeze(['search','minEnd','minMan','minInt','onlineStatus','organization','organizationPresence']);
  function normalizeFactionSearchFilters(input={}){
    const source=input&&typeof input==='object'?input:{},out={};
    for(const key of FACTION_SEARCH_FILTER_KEYS)out[key]=text(source[key]);
    const presence=text(out.organizationPresence).toLowerCase();
    out.organizationPresence=['any','none','has'].includes(presence)?presence:'any';
    const status=text(out.onlineStatus);
    out.onlineStatus=['Online','Idle','Offline'].includes(status)?status:'';
    return out;
  }

  function normalizeSpecialistProfile(raw={}){
    const statusRaw=text(raw.status).toLowerCase();
    const status=PROFILE_STATES.find(value=>value.toLowerCase()===statusRaw)||'Draft';
    return {
      profileId:text(raw.profileId??raw.id),
      name:text(raw.name),
      status,
      criteria:(Array.isArray(raw.criteria)?raw.criteria:[]).map(normalizeRequirement),
      searchFilters:normalizeFactionSearchFilters(raw.searchFilters),
      searchFiltersCustom:raw.searchFiltersCustom===true,
      notes:text(raw.notes),
      version:Math.max(1,Math.floor(number(raw.version,1))),
      createdAt:number(raw.createdAt,0),
      updatedAt:number(raw.updatedAt,0)
    };
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

  function evaluateCriteria(criteria=[],facts={},waivers=[],scope={context:'baseline'}){return Shared.evaluateCriteria(criteria,facts,id=>waiverFor(id,waivers,scope));}

  function ratioScore(req,facts){
    const rawActual=facts?.[req.field],rawTarget=req.value;
    if(rawActual===null||rawActual===undefined||text(rawActual)===''||rawTarget===null||rawTarget===undefined||text(rawTarget)==='')return null;
    const actual=Number(rawActual);
    const target=Number(rawTarget);
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
    const raw=totalWeight?measured.reduce((sum,row)=>sum+row.score*(row.req.weight||1),0)/totalWeight:null;
    const matchScore=raw===null?null:Math.round(clamp(raw));
    return {
      profileId:profile.profileId,
      matchScore,
      eligible:criteria.eligibility==='Eligible'||criteria.eligibility==='Eligible by Waiver',
      hardFailed:criteria.hardFailed,
      eligibility:criteria.hardFailed?'NOT ELIGIBLE':criteria.eligibility==='Unknown'?'Unknown':criteria.hardFailures.length?'Eligible by Waiver':'Eligible',
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






  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    REQUIREMENT_KINDS,
    normalizeBaseline,
    normalizeFactionSearchFilters,
    normalizeSpecialistProfile,
    evaluateCriteria,
    evaluateSpecialistProfile,
    suggestSpecialistProfile
  });
});

/* bundled runtime: v47-faction-storage.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore,Shared=root&&root.RA_V46RecruitmentShared;
  if(typeof module==='object'&&module.exports){FactionCore=FactionCore||require('./v47-faction-core');Shared=Shared||require('./v46-recruitment-shared');}
  const api=factory(FactionCore,Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore,Shared){
  'use strict';
  if(!FactionCore||!Shared)throw new Error('RA_V47FactionCore is required.');

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

  const {text}=Shared;
  function applyUpgrade(db){
    if(!db||!db.objectStoreNames||typeof db.createObjectStore!=='function')throw new Error('A compatible IndexedDB database is required.');
    Shared.applyStoreDefinitions(db,STORE_DEFINITIONS);
  }
  function normalizeConfig(raw={}){return Shared.normalizeDomainConfig(raw,'faction',{activeResultsProfileId:text(raw.activeResultsProfileId)});}

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

    return Object.freeze({
      profiles:Object.freeze(profiles),
      config:Object.freeze(config)
    });
  }

  return Object.freeze({
    DB_VERSION,
    STORE_DEFINITIONS,
    applyUpgrade,
    normalizeConfig,
    createRepositories
  });
});

/* bundled runtime: v47-faction-ui.js */
(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore,Shared=root&&root.RA_V46RecruitmentShared;
  if(typeof module==='object'&&module.exports){FactionCore=FactionCore||require('./v47-faction-core');Shared=Shared||require('./v46-recruitment-shared');}
  const api=factory(FactionCore,Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore,Shared){
  'use strict';
  if(!FactionCore||!Shared)throw new Error('FactionCore is required.');

  const FACTION_STAGES=FactionCore.FACTION_STAGES;
  const {CRITERION_FIELDS,CRITERION_OPERATORS,text,esc}=Shared;
  const PROFILE_STATES=FactionCore.PROFILE_STATES;

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
        age:player.age??player.ageDays??null,
        ee:player.ee??null,
        fit:player.fit??null,
        recruitmentFit:player.recruitmentFit??null,
        drugUse:player.drugUse??player.drugUseLabel??null,
        activeStreak:player.activestreak??player.activeStreak??null,
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







  const COLUMNS=['player','level','age','end','man','int','networth','drug','activity30','battle','activeStreak','xanax30','org','lastActive','recruitmentFit','source','contacted','message'];
  function renderCandidates(rows=[],options={}){
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const activeProfileId=text(options.activeProfileId);
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${profile.profileId===activeProfileId?'selected':''}>${esc(profile.name||profile.profileId)}${profile.status==='Active'?'':' · '+esc(profile.status)}</option>`).join('');
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-faction-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-faction-recruit="${esc(row.userId)}">Message</button>`;
    const headActions=`<div class="ra-actions"><select id="ra-faction-results-profile" class="ra-btn" aria-label="Faction recruitment profile">${profileOptions}</select><button type="button" class="ra-btn" id="ra-faction-profile-apply">Apply Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-save-search" ${activeProfileId?'':'hidden'}>Save Search</button></div>`;
    return Shared.renderResults(rows,options,{domain:'faction',label:'Faction',orgHeader:'Faction',orgPlaceholder:'Faction name or ID',columns:COLUMNS,contactedStages:['contacted','replied','evaluating','invite ready','joined'],messageCell,headActions});
  }

  function renderCriterionRow(raw={},scope='baseline'){return Shared.renderCriterionRow(raw,scope,'faction-','level');}

  function renderProfileEditor({config={},profiles=[],open=false}={}){
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const list=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const cards=list.map(profile=>`<section class="ra-panel" data-faction-profile-card="${esc(profile.profileId)}"><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input data-faction-profile-field="name" value="${esc(profile.name)}"></div><div class="ra-field"><label>Status</label><select data-faction-profile-field="status">${PROFILE_STATES.map(state=>`<option value="${state}" ${state===profile.status?'selected':''}>${state}</option>`).join('')}</select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-faction-profile-field="notes">${esc(profile.notes)}</textarea></div></div><div data-faction-profile-criteria>${profile.criteria.map(req=>renderCriterionRow(req,`profile:${profile.profileId}`)).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" data-faction-profile-add-criterion="${esc(profile.profileId)}">Add criterion</button><button type="button" class="ra-btn ra-primary" data-faction-profile-save="${esc(profile.profileId)}">Save Profile</button><button type="button" class="ra-btn ra-danger" data-faction-profile-delete="${esc(profile.profileId)}">Delete</button></div></section>`).join('');
    return `<details class="ra-panel" id="ra-faction-profile-editor" ${open?'open':''}><summary><b>Requirements &amp; Specialist Profiles</b> <span class="ra-muted">${list.length} profile(s)</span></summary><h4>Faction Baseline</h4><p class="ra-muted">Hard requirements gate eligibility; Preferred requirements only affect score.</p><div id="ra-faction-baseline-criteria">${baseline.criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-faction-baseline-add">Add requirement</button><button type="button" class="ra-btn ra-primary" id="ra-faction-baseline-save">Save Baseline</button></div><h4>Specialist Profiles</h4>${cards||'<p class="ra-muted">No specialist profiles yet.</p>'}<div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-profile-new">Create Specialist Profile</button></div></details>`;
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    CRITERION_FIELDS,
    CRITERION_OPERATORS,
    buildCandidateRows,
    renderCandidates,
    renderCriterionRow,
    renderProfileEditor
  });
});

/* bundled runtime: v47-faction-platform.js */
(function(root,factory){
  const deps={
    FactionCore:root&&root.RA_V47FactionCore,
    FactionUI:root&&root.RA_V47FactionUI,
    Messaging:root&&root.RA_V45Messaging,
    ResultsCore:root&&root.RA_ResultsCore,
    Shared:root&&root.RA_V46RecruitmentShared
  };
  if(typeof module==='object'&&module.exports){
    deps.FactionCore=require('./v47-faction-core');
    deps.FactionUI=require('./v47-faction-ui');
    deps.Messaging=require('./v45-messaging');
    deps.ResultsCore=require('./results-core');
    deps.Shared=require('./v46-recruitment-shared');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {FactionCore,FactionUI,Messaging,ResultsCore,Shared}=D;
  if(!FactionCore||!FactionUI||!Messaging||!ResultsCore||!Shared)throw new Error('Faction platform dependencies are required.');

  const {text,makeId,dbGetAll,dbGet,dbPut,dbDelete,DEFAULT_SEARCH_FILTERS,RESULTS_PAGE_SIZE,sortRows,toggleSort}=Shared;
  const FACTION_ROUTES=Object.freeze(['faction-candidates']);
  const organizationInfo=Shared.organizationInfoFor({player:'player',name:'factionName',id:'factionId',label:'Faction'});
  function profileSearchFilters(profile={}){
    const saved=FactionCore.normalizeFactionSearchFilters(profile?.searchFilters||{});
    const out={...DEFAULT_SEARCH_FILTERS,...saved};
    for(const [field,key] of [['end','minEnd'],['man','minMan'],['int','minInt']]){
      if(profile.searchFiltersCustom===true||text(out[key]))continue;
      const req=(Array.isArray(profile?.criteria)?profile.criteria:[]).find(item=>text(item.field).toLowerCase()===field&&['gte','gt'].includes(text(item.operator).toLowerCase())&&Number.isFinite(Number(item.value))&&Number(item.value)>0);
      if(req)out[key]=String(req.value);
    }
    return out;
  }
  function activeResultsProfile(config={},profiles=[]){
    const id=text(config.activeResultsProfileId);
    return id?(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).find(profile=>profile.profileId===id)||null:null;
  }

  async function getConfig(app){if(app?._test?.factionRepositories?.config?.get)return app._test.factionRepositories.config.get();return(await dbGet(app._test.state.db,'factionRecruitmentConfig','faction'))||{key:'faction',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.factionRepositories?.config?.save)return app._test.factionRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'faction',updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentConfig',next);return next;}
  async function getProfiles(app){if(app?._test?.factionRepositories?.profiles?.list)return app._test.factionRepositories.profiles.list();return dbGetAll(app._test.state.db,'factionSpecialistProfiles');}
  async function saveProfile(app,profile){if(app?._test?.factionRepositories?.profiles?.save)return app._test.factionRepositories.profiles.save(profile);const next=FactionCore.normalizeSpecialistProfile({...profile,profileId:text(profile.profileId)||makeId('profile'),updatedAt:Date.now()});await dbPut(app._test.state.db,'factionSpecialistProfiles',next);return next;}
  async function removeProfile(app,profileId){if(app?._test?.factionRepositories?.profiles?.remove)return app._test.factionRepositories.profiles.remove(profileId);return dbDelete(app._test.state.db,'factionSpecialistProfiles',text(profileId));}

  async function buildRows(app){
    const db=app._test.state.db;
    const[factionRecords,players,candidateLocals,config,profiles]=await Promise.all([dbGetAll(db,'factionRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getProfiles(app)]);
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    const activeProfile=activeResultsProfile(config,profiles);
    return FactionUI.buildCandidateRows(factionRecords,players,{baseline:config.baseline||{},profiles}).map(row=>{const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.player||{};const selectedEvaluation=activeProfile?(row.profileEvaluations||[]).find(item=>text(item.profileId)===activeProfile.profileId):null;const enriched={...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),candidateLocal:candidate,eligibilityScore:selectedEvaluation?.matchScore??null,eligibility:selectedEvaluation?.eligibility??null};const intelligence=ResultsCore.recruitmentFit(enriched,{domain:'faction',useEligibility:Boolean(activeProfile)});return{...enriched,recruitmentFit:intelligence.score,recruitmentConfidence:intelligence.confidence,recruitmentFitBreakdown:intelligence.components,prospectProvenance:intelligence.provenance,prospectState:intelligence.provenance.state,intelligenceFreshness:intelligence.provenance.freshness,activeRecruitmentProfileId:activeProfile?.profileId||'',activeRecruitmentProfileName:activeProfile?.name||''};});
  }

  const P=Shared.createResultsPlatform({
    domain:'faction',label:'Faction',logTag:'[RA v4.7 Faction]',routes:FACTION_ROUTES,implemented:FACTION_ROUTES,goPageSelector:'[data-go-page]',
    meta:{'faction-candidates':['Faction Candidates','Search and manage Faction recruitment candidates.']},
    organizationInfo,buildRows,profileSearchFilters,
    async selectProfile(app){const [config,profiles]=await Promise.all([getConfig(app),getProfiles(app)]);return{config,profiles,selected:activeResultsProfile(config,profiles)};},
    renderHtml(app,sorted,options,{config,profiles}){return FactionUI.renderCandidates(sorted,{...options,profiles,activeProfileId:text(config.activeResultsProfileId)})+FactionUI.renderProfileEditor({config,profiles,open:runtime.profileEditorOpen===true});},
    bindControls
  });
  const {runtime,renderPage,reportError}=P;
  const readCriteria=host=>Shared.readCriteria(host,'faction-');

  async function saveBaselineFromUi(){const host=document.getElementById('ra-faction-baseline-criteria');return saveConfig(runtime.app,{baseline:{criteria:readCriteria(host)}});}
  async function createProfile(){return saveProfile(runtime.app,{profileId:makeId('profile'),name:'New Specialist Profile',status:'Draft',criteria:[],notes:''});}
  async function saveProfileFromCard(profileId){const card=document.querySelector(`[data-faction-profile-card="${profileId}"]`);if(!card)throw new Error('Specialist profile was not found.');const profiles=await getProfiles(runtime.app);const existing=profiles.find(profile=>text(profile.profileId)===text(profileId));if(!existing)throw new Error('Specialist profile was not found.');const criteriaHost=card.querySelector('[data-faction-profile-criteria]');return saveProfile(runtime.app,{...existing,name:text(card.querySelector('[data-faction-profile-field="name"]')?.value),status:text(card.querySelector('[data-faction-profile-field="status"]')?.value)||'Draft',notes:text(card.querySelector('[data-faction-profile-field="notes"]')?.value),criteria:readCriteria(criteriaHost)});}

  function recruitPlayer(row,override=false){
    if(row.doNotContact&&!override)throw new Error('This player is marked Do Not Contact. Use the deliberate override control if contact is still required.');
    if(override){if(typeof globalThis.confirm!=='function')throw new Error('Do Not Contact override confirmation is unavailable. Recruitment stopped.');if(!globalThis.confirm('This player is marked Do Not Contact. Override it for this recruitment chat only?'))return false;}
    if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');
    return runtime.app.recruitCandidate?.('faction',row.userId,row.name,{overrideDnc:override,dncConfirmed:override});
  }

  function addCriterionRow(host,scope){if(!host)return;host.insertAdjacentHTML('beforeend',FactionUI.renderCriterionRow({id:makeId('criterion'),field:'level',operator:'gte',kind:'Preferred',weight:1},scope));}
  function bindProfileEditor(){
    const editor=document.getElementById('ra-faction-profile-editor');if(!editor)return;
    const rerender=async work=>{try{runtime.profileEditorOpen=true;await work();await P.rerender();}catch(error){reportError(error);}};
    editor.ontoggle=()=>{runtime.profileEditorOpen=editor.open;};
    editor.onclick=event=>{
      const target=event.target?.closest?.('button');if(!target)return;const data=target.dataset;
      if(data.factionRemoveCriterion!==undefined)target.closest('[data-faction-criterion-row]')?.remove();
      else if(target.id==='ra-faction-baseline-add')addCriterionRow(document.getElementById('ra-faction-baseline-criteria'),'baseline');
      else if(target.id==='ra-faction-baseline-save')rerender(saveBaselineFromUi);
      else if(target.id==='ra-faction-profile-new')rerender(createProfile);
      else if(data.factionProfileAddCriterion)addCriterionRow(document.querySelector(`[data-faction-profile-card="${data.factionProfileAddCriterion}"] [data-faction-profile-criteria]`),`profile:${data.factionProfileAddCriterion}`);
      else if(data.factionProfileSave)rerender(()=>saveProfileFromCard(data.factionProfileSave));
      else if(data.factionProfileDelete){if(globalThis.confirm&&!globalThis.confirm('Delete this specialist profile?'))return;rerender(()=>removeProfile(runtime.app,data.factionProfileDelete));}
    };
  }

  function bindControls(){
    const on=(id,handler)=>document.getElementById(id)?.addEventListener('click',handler);
    on('ra-faction-profile-apply',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);const profiles=await getProfiles(runtime.app);const profile=profileId?profiles.find(item=>text(item.profileId)===profileId):null;if(profileId&&!profile)throw new Error('Faction specialist profile was not found.');await saveConfig(runtime.app,{activeResultsProfileId:profileId});runtime.resultPage=0;runtime.searchFilters=profile?profileSearchFilters(profile):{...DEFAULT_SEARCH_FILTERS};await P.rerender();}catch(error){reportError(error);}});
    on('ra-faction-profile-clear',async()=>{try{await saveConfig(runtime.app,{activeResultsProfileId:''});runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};await P.rerender();}catch(error){reportError(error);}});
    on('ra-faction-profile-save-search',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);if(!profileId)throw new Error('Choose a Faction specialist profile first.');const profiles=await getProfiles(runtime.app);const profile=profiles.find(item=>text(item.profileId)===profileId);if(!profile)throw new Error('Faction specialist profile was not found.');runtime.searchFilters=P.readVisibleSearchFilters();await saveProfile(runtime.app,{...profile,searchFilters:runtime.searchFilters,searchFiltersCustom:true});await saveConfig(runtime.app,{activeResultsProfileId:profileId});await P.rerender();}catch(error){reportError(error);}});
    bindProfileEditor();
    document.querySelectorAll('[data-faction-recruit]').forEach(button=>button.onclick=()=>P.rowFor(button.dataset.factionRecruit).then(row=>recruitPlayer(row,false)).catch(reportError));
    document.querySelectorAll('[data-faction-recruit-override]').forEach(button=>button.onclick=()=>P.rowFor(button.dataset.factionRecruitOverride).then(row=>recruitPlayer(row,true)).catch(reportError));
  }

  return Object.freeze({
    FACTION_ROUTES,isFactionRoute:P.isRoute,routeMeta:P.routeMeta,install:P.install,uninstall:P.uninstall,renderPage,syncNavigation:P.syncNavigation,
    _test:{IMPLEMENTED_ROUTES:P.IMPLEMENTED_ROUTES,buildRows,persistRoute:P.persistRoute,dbGetAll,dbGet,dbPut,dbDelete,getConfig,getProfiles,readCriteria,profileSearchFilters,activeResultsProfile,filterRows:P.filterRows,sortRows,toggleSort,organizationInfo,RESULTS_PAGE_SIZE}
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
    deps.V47FactionPlatform = require('./v47-faction-platform');
  }
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45App = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const {ScoutCore,ResultsCore,GlobalCore,MatchCore,ForumCore,Runtime,Candidates,Discovery,Messaging,V46Domain,V46Storage,V46Navigation,V46CompanyCore,V46CompanyStorage,V46CompanyPlatform,V47FactionCore,V47FactionStorage,V47FactionUI,V47FactionPlatform} = D;
  if (![ScoutCore,ResultsCore,GlobalCore,MatchCore,ForumCore,Runtime,Candidates,Discovery,Messaging,V46Domain,V46Storage,V46Navigation,V46CompanyCore,V46CompanyStorage,V46CompanyPlatform,V47FactionCore,V47FactionStorage,V47FactionUI,V47FactionPlatform].every(Boolean)) {
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
  const OPTIONAL_MODULES = Object.freeze([
    ['companyDiscovery','Forum Discovery'],['scout','Scout'],['smartMatch','Smart Match'],['globalIntelligence','Global Intelligence'],['data','Data']
  ]);
  const DEFAULT_OPTIONAL_MODULES = Object.freeze(Object.fromEntries(OPTIONAL_MODULES.map(([key])=>[key,false])));

  const defaultSettings = () => ({
    theme:'dark', density:'comfortable', textSize:'normal', complexity:'simple', sidebarCollapsed:false,
    launcherEnabled:true, includeInactive:false, activePage:'company-candidates', activeDomain:'company', navigation:{expandedGroups:['company-recruitment']}, optionalModules:{...DEFAULT_OPTIONAL_MODULES}, apiKey:'', ownCompanyName:'',
    recruitment:Runtime.normalizeRecruitmentSettings({companyThreadId:'15907925',factionThreadId:'15909136',trainingThreadId:'',recentImportDays:30,maxPagesPerFeed:20,candidateActiveAgeDays:30,explicitTrainBuyersOnly:true,companyType:'',companyRecruitmentMessage:Messaging.DEFAULT_COMPANY_RECRUITMENT_MESSAGE,factionName:'',factionRecruitmentMessage:Messaging.DEFAULT_FACTION_RECRUITMENT_MESSAGE}),
    scout:{rate:75,workers:3,budget:900,historyGapMs:0,maxCandidates:60,scoring:ScoutCore.DEFAULT_SCORING},
    candidates:{view:'table',resultsLayout:'expanded',playerCard:{openOnName:true,allowPopout:true,rememberPanel:true,autoOpenRow:false,pinned:false},visibleColumns:[...DEFAULT_VISIBLE_COLUMNS],filters:{search:'',stage:'',source:'',lookingFor:'',currentCompany:'',minMatch:'',minFit:'',activeOnly:false,moreOpen:false,minMan:'',minInt:'',minEnd:'',minActivity30:''}},
    match:{activeProfileId:''},
    global:{enabled:true,endpoint:'',lookupCacheMs:30*60*1000,maxRetryAttempts:5}
  });

  const state = {
    db:null, settings:null, page:'company-candidates', mounted:false, topZ:2147483400,
    apiGate:Promise.resolve(), apiNextAt:0,
    sync:{running:false,cancelled:false,feed:'',pages:0},
    fill:{running:false,cancelled:false,done:0,total:0,errors:[]},
    scout:{running:false,paused:false,cancelled:false,done:0,total:0,calls:0,currentId:null,status:'Idle'},
    help:{pinned:false,anchor:null}, drawerCandidateId:'', playerCard:{domain:'company',userId:'',pinned:false,popout:false},
    resizeTimer:null, logRefreshTimer:null, routeSeq:0, metaWrite:Promise.resolve()
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = value => String(value ?? '').trim();
  const number = (value, fallback = 0) => { const out=Number(value); return Number.isFinite(out)?out:fallback; };
  const finite = value => { if (value === '' || value === null || value === undefined) return null; const out=Number(value); return Number.isFinite(out)?out:null; };
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const clampRate = value => Math.max(10,Math.min(HARD_API_RATE,number(value,HARD_API_RATE)));
  const formatNumber = (value,dp=0) => finite(value)===null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:dp});
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
  const companyPlatformApp={navigate:(page,persist=true)=>route(page,persist),recruitCandidate:(domain,userId,name,options)=>recruitCandidate(domain,userId,name,options),searchCandidates:(domain,filters)=>searchCandidates(domain,filters),discoverWorkstatProspects:(options={})=>discoverWorkstatProspects(options),listMatchProfiles:async()=> (await idb.getAll('matchProfiles')).map(MatchCore.normalizeProfile),getActiveMatchProfile:()=>getActiveMatchProfile(),setActiveMatchProfile:async profileId=>{const id=text(profileId);if(!id){await saveSettings({match:{...state.settings.match,activeProfileId:''}});return null;}const row=await idb.get('matchProfiles',id);if(!row)throw new Error('Match Profile was not found.');await saveSettings({match:{...state.settings.match,activeProfileId:id}});return MatchCore.normalizeProfile(row);},saveCompanySearchProfile:async(profileId,filters={})=>{const id=text(profileId);const row=id?await idb.get('matchProfiles',id):null;if(!row)throw new Error('Match Profile was not found.');const profile=MatchCore.normalizeProfile(row);profile.searchFilters={...profile.searchFilters,company:MatchCore.normalizeCompanySearchFilters(filters)};profile.searchFiltersCustom=true;const saved=await saveMatchProfile(profile);await saveSettings({match:{...state.settings.match,activeProfileId:saved.profileId}});return saved;},openPlayerCard:(domain,userId)=>openPlayerCard(domain,userId),saveResultsView:async(domain,view)=>{const key=text(domain)==='faction'?'faction':'company';const current=state.settings.candidates?.resultsView;await saveSettings({candidates:{...state.settings.candidates,resultsView:{...(current&&typeof current==='object'?current:{}),[key]:view}}});return state.settings.candidates.resultsView[key];},setResultsLayout:async layout=>{await saveSettings({candidates:{...state.settings.candidates,resultsLayout:layout==='compact'?'compact':'expanded'}});return state.settings.candidates.resultsLayout;},_test:{state,repositories,companyRepositories,factionRepositories}};

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
      candidates:{...base.candidates,...candidateSettings,resultsLayout:candidateSettings.resultsLayout==='compact'?'compact':'expanded',playerCard:{...base.candidates.playerCard,...(candidateSettings.playerCard||{})},visibleColumns:Array.isArray(candidateSettings.visibleColumns)&&candidateSettings.visibleColumns.length?[...new Set(['player',...candidateSettings.visibleColumns])]:[...DEFAULT_VISIBLE_COLUMNS],filters:{...base.candidates.filters,...(candidateSettings.filters||{})}},
      match:{...base.match,...(raw.match||{})}, global:{...base.global,...(raw.global||{})}
    };
  }

  async function getMeta(){return await idb.get('meta','global')||{key:'global',settings:defaultSettings(),ui:{windowGeometry:{}}};}
  function updateMeta(mutate){const run=state.metaWrite.then(async()=>{const meta=await getMeta();mutate(meta);await idb.put('meta',meta);return meta;});state.metaWrite=run.catch(()=>{});return run;}
  async function saveSettings(patch){const meta=await updateMeta(meta=>{meta.settings=mergeSettings({...meta.settings,...patch});});state.settings=meta.settings;return state.settings;}
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
  function findPrivateChatButton(userId){const id=text(userId);if(currentProfileUserId()!==id)return null;return document.querySelector(`[id="button2-profile-${id}"]`)||document.querySelector('a.profile-button.profile-button-initiateChat')||document.querySelector('a[aria-label="Start chat"]');}
  function privateChatContainerUserId(container){
    if(!container)return '';
    for(const attr of ['data-user-id','data-user']){const value=text(container.getAttribute?.(attr));if(/^\d+$/.test(value))return value;}
    const link=container.querySelector?.('a[href*="profiles.php"][href*="XID="]');
    const href=text(link?.getAttribute?.('href'));const match=href.match(/[?&]XID=(\d+)/i);
    return match?match[1]:'';
  }
  function privateChatInputs(userId){
    const target=text(userId);if(!/^\d+$/.test(target))return[];
    const selectors=['textarea','div[contenteditable="true"]','input[type="text"]','[role="textbox"]'];
    return [...document.querySelectorAll(selectors.join(','))].filter(visibleElement).map(element=>{
      const container=element.closest('[class*="chat" i],[class*="conversation" i],[class*="message" i],[class*="pm" i],[data-user-id],[data-user]');
      if(privateChatContainerUserId(container)!==target)return null;
      let score=10;
      if(element.matches('textarea,[contenteditable="true"],[role="textbox"]'))score+=2;
      return{element,score};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).map(item=>item.element);
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
    if(['company','faction'].includes(text(plan.domain).toLowerCase())){
      const domain=text(plan.domain).toLowerCase();
      const current=await idb.get(domain==='faction'?'factionRecruitment':'companyRecruitment',userId);
      if(current?.doNotContact===true&&plan.dncOverrideConfirmed!==true)throw new Error('Do Not Contact is currently set for this recruitment domain. The queued private-chat draft was discarded.');
    }
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
  async function recruitCandidate(domain,userId,name='',options={}){
    const targetId=text(userId),kind=text(domain).toLowerCase(),playerName=text(name)||`User ${targetId}`;
    if(!/^\d+$/.test(targetId))throw new Error('A valid Torn player ID is required.');
    if(!['company','faction'].includes(kind))throw new Error('Recruitment domain must be Company or Faction.');
    const latestRecruitment=await idb.get(kind==='faction'?'factionRecruitment':'companyRecruitment',targetId);
    if(latestRecruitment?.doNotContact===true&&!(options?.overrideDnc===true&&options?.dncConfirmed===true))throw new Error('Do Not Contact is currently set for this recruitment domain. Use the explicit confirmed override control if contact is still required.');
    const recruitment=state.settings.recruitment||{};
    if(kind==='company'){if(!text(state.settings.ownCompanyName))throw new Error('Set your Company Name in Recruitment settings first.');if(!text(recruitment.companyType))throw new Error('Set your Company Type in Recruitment settings first.');}
    if(kind==='faction'&&!text(recruitment.factionName))throw new Error('Set your Faction Name in Recruitment settings first.');
    let targetWindow=null;try{targetWindow=globalThis.open?.('about:blank','_blank');if(targetWindow)targetWindow.opener=null;}catch{}
    try{
      const response=await tornRequest(kind==='company'?`user/${targetId}/job`:`user/${targetId}/faction`);
      const eligibility=kind==='company'?Messaging.companyRecruitmentEligibility(response):Messaging.factionRecruitmentEligibility(response);
      if(!eligibility.eligible){try{targetWindow?.close?.();}catch{}const label=kind==='company'?'company':'faction';if(eligibility.known===false)throw new Error(`Could not verify ${playerName}'s ${label} affiliation. Recruitment stopped.`);throw new Error(`${playerName} already belongs to ${eligibility.currentName||('a '+label)}. Recruitment stopped.`);}
      const template=kind==='company'?recruitment.companyRecruitmentMessage:recruitment.factionRecruitmentMessage;
      const values=kind==='company'?{userId:targetId,name:playerName,company_name:state.settings.ownCompanyName,company_type:recruitment.companyType}:{userId:targetId,name:playerName,faction_name:recruitment.factionName};
      const plan={...Messaging.recruitmentChatPlan(kind,template,values),dncOverrideConfirmed:options?.overrideDnc===true&&options?.dncConfirmed===true};
      Messaging.queuePrivateChatDraft(plan);
      if(targetWindow)targetWindow.location.href=plan.profileUrl;else globalThis.open?.(plan.profileUrl,'_blank','noopener');
      toast(`${playerName} is available. Torn private chat is being prepared; you still press Send.`);
      await logEvent('recruit','Private-chat recruitment draft prepared',{playerId:Number(targetId),domain:kind});
      return plan;
    }catch(error){try{if(targetWindow&&!targetWindow.closed&&String(targetWindow.location?.href||'').startsWith('about:blank'))targetWindow.close();}catch{}throw error;}
  }

  function extractStats(data){const p=data?.personalstats||data?.personal_stats||data?.personalStats||{};return p&&typeof p==='object'?p:{};}
  function extractProfile(data,userId){const p=data?.profile?.profile||data?.profile||data?.basic?.basic||data?.basic||data||{};const faction=p.faction||{};const last=p.last_action||p.lastAction||{};const status=p.status||{};return{id:Number(p.id||p.player_id||userId),name:text(p.name||p.username||`User ${userId}`),level:finite(p.level),age:finite(p.age),factionId:finite(faction.id??p.faction_id),factionName:text(faction.name||p.faction_name),status:text(status.state||status.description||p.online_status||last.status||'Unknown'),lastActionTs:finite(last.timestamp??last.time??p.last_action_timestamp)};}
  function scoutFit(snapshot){if(!snapshot)return null;if(snapshot.official&&snapshot.w30)return ScoutCore.scoreFit(snapshot.w30,state.settings.scout.scoring).score;if(snapshot.provisionalSource&&snapshot.provisionalDays)return ScoutCore.provisionalFit(snapshot.provisionalSource,snapshot.provisionalDays,state.settings.scout.scoring).score;return finite(snapshot.currentFit??snapshot.originalFit);}
  async function scoutPlayer(userId,force=false){const id=Number(userId);if(!id)throw new Error('Invalid player ID.');const cached=await idb.get('scoutLatest',id);if(!force&&cached&&Date.now()-Number(cached.capturedAt||0)<12*60*60*1000)return cached;state.scout.currentId=id;state.scout.status=`Scouting ${id}: current totals`;refreshScoutRuntimeUi();const currentData=await tornRequest(`user/${id}`,{selections:'profile,personalstats',stat:SCOUT_STAT_LIST},{scout:true});const current=extractStats(currentData);const profile=extractProfile(currentData,id);const now=Math.floor(Date.now()/1000);let past7=null,past30=null,w7=null,w30=null;if(profile.age>=7){if(state.settings.scout.historyGapMs)await sleep(state.settings.scout.historyGapMs);state.scout.status=`Scouting ${id}: 7-day history`;refreshScoutRuntimeUi();past7=extractStats(await tornRequest(`user/${id}`,{selections:'personalstats',stat:SCOUT_STAT_LIST,timestamp:now-7*86400},{scout:true}));w7=ScoutCore.deltaStats(current,past7);}if(profile.age>=30){if(state.settings.scout.historyGapMs)await sleep(state.settings.scout.historyGapMs);state.scout.status=`Scouting ${id}: 30-day history`;refreshScoutRuntimeUi();past30=extractStats(await tornRequest(`user/${id}`,{selections:'personalstats',stat:SCOUT_STAT_LIST,timestamp:now-30*86400},{scout:true}));w30=ScoutCore.deltaStats(current,past30);}const official=profile.age>=30&&!!w30;let provisionalSource=null,provisionalDays=0;if(!official){if(profile.age>0&&profile.age<30){provisionalSource=ScoutCore.metricsFromTotals(current);provisionalDays=Math.max(1,Math.min(29,profile.age));}else if(w7){provisionalSource=w7;provisionalDays=7;}}const fitObj=official?ScoutCore.scoreFit(w30,state.settings.scout.scoring):null;const provisionalObj=!official&&provisionalSource?ScoutCore.provisionalFit(provisionalSource,provisionalDays,state.settings.scout.scoring):null;const trend=w7&&w30?ScoutCore.computeTrend(w7,w30,state.settings.scout.scoring):{percent:null,components:{}};const capturedAt=Date.now();const snapshot={snapshotId:`${id}:${capturedAt}`,userId:id,capturedAt,source:'scout',profile,currentRaw:current,past7Raw:past7,past30Raw:past30,w7,w30,official,provisionalSource,provisionalDays,provisionalConfidence:provisionalObj?.confidence||null,originalFit:fitObj?.score??provisionalObj?.score??null,currentFit:fitObj?.score??provisionalObj?.score??null,originalFitType:official?'official':(provisionalObj?'provisional':'unmeasured'),trend:trend.percent,trendComponents:trend.components,formula:ScoutCore.normalizeScoring(state.settings.scout.scoring),extra:{networth:finite(current.networth),activeStreak:finite(current.activestreak),bestActiveStreak:finite(current.bestactivestreak),statEnhancers30:w30?.statEnhancers??provisionalSource?.statEnhancers??0}};await idb.put('scoutLatest',snapshot);await idb.put('scoutHistory',snapshot);const scoutShared={name:profile.name,lastScoutAt:capturedAt,lastObservedAt:capturedAt,scoutStatus:ResultsCore.classifyScoutStatus(snapshot)};const measuredFit=finite(snapshot.currentFit??snapshot.originalFit);if(measuredFit!==null){scoutShared.fit=measuredFit;scoutShared.fitType=snapshot.official?'official':(snapshot.provisionalSource?'provisional':'unmeasured');}for(const[key,value]of Object.entries({level:profile.level,age:profile.age,factionId:profile.factionId,factionName:profile.factionName||null,networth:snapshot.extra?.networth,activeStreak:snapshot.extra?.activeStreak,bestActiveStreak:snapshot.extra?.bestActiveStreak,lastActive:profile.lastActionTs?Number(profile.lastActionTs)*1000:null,activity30:(snapshot.w30||snapshot.provisionalSource||{}).activityHours,xanax30:(snapshot.w30||snapshot.provisionalSource||{}).xanax,refills30:(snapshot.w30||snapshot.provisionalSource||{}).refills,attacks30:(snapshot.w30||snapshot.provisionalSource||{}).attacks,rwHits30:(snapshot.w30||snapshot.provisionalSource||{}).rwHits}))if(value!==null&&value!==undefined&&value!=='')scoutShared[key]=value;await repositories.players.ensure(String(id),scoutShared,'scout',capturedAt);await enqueueGlobalObservation(snapshot).catch(()=>{});return snapshot;}
  async function runScout(ids,force=false){if(state.scout.running)throw new Error('Scout is already running.');const unique=[...new Set((ids||[]).map(Number).filter(Boolean))].slice(0,state.settings.scout.maxCandidates);if(!unique.length)throw new Error('No valid player IDs to Scout.');Object.assign(state.scout,{running:true,paused:false,cancelled:false,done:0,total:unique.length,calls:0,currentId:null,status:'Starting'});refreshScoutRuntimeUi();let cursor=0;const workers=Math.max(1,Math.min(state.settings.scout.workers,unique.length));const worker=async()=>{while(!state.scout.cancelled){const i=cursor++;if(i>=unique.length)break;const id=unique[i];try{await scoutPlayer(id,force);await logEvent('scout','Scout player completed',{playerId:id});}catch(error){if(!error.cancelled)await logEvent('error','Scout player failed',{playerId:id,error:text(error.message)});}finally{state.scout.done++;refreshScoutRuntimeUi();}}};try{await Promise.all(Array.from({length:workers},worker));}finally{state.scout.running=false;state.scout.paused=false;state.scout.currentId=null;state.scout.status=state.scout.cancelled?'Stopped':'Complete';refreshScoutRuntimeUi();if(state.page==='scout'||state.page==='company-candidates'||state.page==='company-pipeline')await route(state.page,false);}return true;}
  function pauseScout(){if(state.scout.running){state.scout.paused=!state.scout.paused;state.scout.status=state.scout.paused?'Paused':'Running';refreshScoutRuntimeUi();}}
  function cancelScout(){if(state.scout.running){state.scout.cancelled=true;state.scout.paused=false;state.scout.status='Cancelling';refreshScoutRuntimeUi();}}

  function globalEndpoint(){return text(state.settings.global.endpoint).replace(/\/+$/,'');}
  async function globalJson(url,options={}){const method=text(options.method||'GET').toUpperCase();const body=options.body==null?null:String(options.body);const headers={...(options.headers||{})};if(typeof globalThis.GM_xmlhttpRequest==='function')return new Promise((resolve,reject)=>globalThis.GM_xmlhttpRequest({method,url,headers,data:body,anonymous:true,timeout:15000,onload:r=>{if(Number(r.status)<200||Number(r.status)>=300)return reject(new Error(`Global service HTTP ${r.status}`));try{resolve(JSON.parse(String(r.responseText||'')));}catch{reject(new Error('Global service returned invalid JSON.'));}},ontimeout:()=>reject(new Error('Global service timed out.')),onerror:()=>reject(new Error('Global service request failed.'))}));const response=await fetch(url,{method,headers,body,redirect:'follow',cache:'no-store'});if(!response.ok)throw new Error(`Global service HTTP ${response.status}`);return response.json();}
  function globalObservation(snapshot){const profile=snapshot.profile||{};const w=snapshot.w30||snapshot.provisionalSource||{};return Promise.all([idb.get('playerIntelligence',String(snapshot.userId)),idb.get('candidateLocal',String(snapshot.userId))]).then(([player,candidate])=>GlobalCore.sanitizeObservation({playerId:Number(snapshot.userId),name:player?.name||candidate?.name||profile.name||`User ${snapshot.userId}`,observedAt:Number(snapshot.capturedAt||Date.now()),level:player?.level??profile.level,ee:player?.ee??candidate?.ee,activity30:w.activityHours,xanax30:w.xanax,refills30:w.refills,attacks30:w.attacks,rwHits30:w.rwHits,networth:snapshot.extra?.networth,fit:scoutFit(snapshot),fitType:snapshot.official?'official':(snapshot.provisionalSource?'provisional':'unmeasured'),lastActive:profile.lastActionTs?Number(profile.lastActionTs)*1000:null,scoutStatus:ResultsCore.classifyScoutStatus(snapshot)},SCRIPT_VERSION));}
  async function enqueueGlobalObservation(snapshot){const observation=await globalObservation(snapshot);const queueId=GlobalCore.makeQueueId(observation);await idb.put('globalSyncQueue',{queueId,userId:observation.playerId,observation,attempts:0,createdAt:Date.now(),nextRetryAt:0,lastError:''});if(state.settings.global.enabled&&globalEndpoint())void flushGlobalQueue(false);}
  async function testGlobalService(){const endpoint=globalEndpoint();if(!endpoint)throw new Error('Set the Global Intelligence endpoint first.');const join=endpoint.includes('?')?'&':'?';const raw=await globalJson(`${endpoint}${join}action=meta`);const response=GlobalCore.normalizeServiceResponse(raw);if(!response.ok)throw new Error(`Global service error: ${response.code||'unknown'}`);if(Number(response.schemaVersion)!==Number(GlobalCore.GLOBAL_SCHEMA_VERSION))throw new Error(`Global schema mismatch: ${response.schemaVersion} != ${GlobalCore.GLOBAL_SCHEMA_VERSION}`);await logEvent('global','Global service connected',{schemaVersion:response.schemaVersion,serviceVersion:response.serviceVersion});return response;}
  async function flushGlobalQueue(manual=false){if(!state.settings.global.enabled||!globalEndpoint())return{processed:0,pending:(await idb.getAll('globalSyncQueue')).length};const endpoint=globalEndpoint();let processed=0;const rows=(await idb.getAll('globalSyncQueue')).sort((a,b)=>a.createdAt-b.createdAt);for(const item of rows){if(!manual&&Number(item.nextRetryAt||0)>Date.now())continue;try{const raw=await globalJson(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(GlobalCore.buildObservePayload(item.observation,SCRIPT_VERSION))});const normalized=GlobalCore.normalizeServiceResponse(raw);if(GlobalCore.classifyRetry(normalized)==='done'||GlobalCore.classifyRetry(normalized)==='permanent')await idb.delete('globalSyncQueue',item.queueId);else throw new Error(normalized.code||'Global observation rejected');}catch(error){item.attempts=Number(item.attempts||0)+1;item.lastError=text(error.message).slice(0,160);item.nextRetryAt=Date.now()+Math.min(6*60*60*1000,60000*(2**Math.min(item.attempts,8)));await idb.put('globalSyncQueue',item);}processed++;}await logEvent('global','Global sync processed',{processed,pending:(await idb.getAll('globalSyncQueue')).length});return{processed,pending:(await idb.getAll('globalSyncQueue')).length};}

  async function ensureDefaultMatchProfile(){const profiles=await idb.getAll('matchProfiles');if(!profiles.length){const p=MatchCore.createDefaultProfile('Default Recruit');p.createdAt=new Date().toISOString();p.updatedAt=p.createdAt;await idb.put('matchProfiles',p);await saveSettings({match:{...state.settings.match,activeProfileId:p.profileId}});return p;}const active=profiles.find(p=>p.profileId===state.settings.match.activeProfileId);return active?MatchCore.normalizeProfile(active):null;}
  async function getActiveMatchProfile(fallback=false){const id=text(state.settings.match.activeProfileId);if(id){const row=await idb.get('matchProfiles',id);if(row)return MatchCore.normalizeProfile(row);}if(!fallback)return null;const ensured=await ensureDefaultMatchProfile();if(ensured)return ensured;const profiles=await idb.getAll('matchProfiles');return profiles.length?MatchCore.normalizeProfile(profiles[0]):null;}
  async function saveMatchProfile(profile){const normalized=MatchCore.normalizeProfile(profile);const existing=normalized.profileId?await idb.get('matchProfiles',normalized.profileId):null;const now=new Date().toISOString();if(existing&&!Object.prototype.hasOwnProperty.call(profile,'searchFilters'))normalized.searchFilters=MatchCore.normalizeProfile(existing).searchFilters;normalized.createdAt=existing?.createdAt||normalized.createdAt||now;normalized.updatedAt=now;await idb.put('matchProfiles',normalized);return normalized;}

  function latestSourceFor(candidate,sources){const id=text(candidate.latestForumSourceId);if(id)return sources.find(s=>s.sourceId===id)||null;return sources.filter(s=>String(s.userId)===String(candidate.userId)).sort((a,b)=>Number(b.postedAt||0)-Number(a.postedAt||0))[0]||null;}
  function matchAvailability(value){return value==='Available'?'immediate':value==='Unavailable'?'not_available':'';}
  async function candidateViews(){const candidates=await idb.getAll('candidateLocal');const sources=await idb.getAll('forumSources');const scouts=await idb.getAll('scoutLatest');const scoutMap=new Map(scouts.map(s=>[String(s.userId),s]));const profile=await getActiveMatchProfile();const out=[];for(const raw of candidates){let candidate;try{candidate=Runtime.normalizeCandidateRecord(raw);}catch{continue;}if(!state.settings.includeInactive&&String(candidate.status||'active').toLowerCase()==='inactive')continue;const source=latestSourceFor(candidate,sources)||{};const scout=scoutMap.get(String(candidate.userId))||null;const base={userId:candidate.userId,name:candidate.name||source.authorName||`User ${candidate.userId}`,stats:candidate.stats||{},ee:candidate.ee??null,currentCompany:candidate.currentCompany||'',sourceType:source.sourceType||candidate.discoverySources?.[0]||'MANUAL',lastSeenPost:source.postedAt||candidate.lastSeenPost||null,scout,matchInputs:{fit:scoutFit(scout),activity30:(scout?.w30||scout?.provisionalSource||{}).activityHours,xanax30:(scout?.w30||scout?.provisionalSource||{}).xanax,refills30:(scout?.w30||scout?.provisionalSource||{}).refills,attacks30:(scout?.w30||scout?.provisionalSource||{}).attacks,rwHits30:(scout?.w30||scout?.provisionalSource||{}).rwHits}};const matchCandidate={...candidate,availability:matchAvailability(candidate.availability)};const match=MatchCore.evaluateMatch({row:base,candidate:matchCandidate,profile});const view=Candidates.composeCandidateView({candidate,source,result:{...base,matchScore:match.score,fit:scoutFit(scout),currentCompany:candidate.currentCompany||''},scout,match});view.candidate=candidate;view.source=source;view.scout=scout;view.match=match;view.postedAt=source.postedAt||null;view.activity30=(scout?.w30||scout?.provisionalSource||{}).activityHours??null;view.scoutStatus=ResultsCore.classifyScoutStatus(base);const workStats=[view.man,view.int,view.end].map(finite);view.total=workStats.every(value=>value!==null)?workStats.reduce((sum,value)=>sum+value,0):null;out.push(view);}return out;}
  ;


  function recruitmentDomainForFeed(feed={}){const feedId=text(feed.feedId).toLowerCase();const sourceType=text(feed.sourceType).toUpperCase();return feedId==='faction'||sourceType==='FACTION FORUM'?'faction':'company';}
  async function persistDiscoveredCandidate(feed,candidate,source){const userId=V46Domain.normalizeUserId(candidate?.userId);const observedAt=Number(source?.observedAt||source?.postedAt||Date.now());const domain=recruitmentDomainForFeed(feed);if(domain==='company'){const row={...candidate,userId};await idb.put('candidateLocal',row);await repositories.company.ensure(userId,row,{sharedPatch:{name:row.name,lastObservedAt:observedAt},source:'company-discovery',observedAt});return row;}const existing=await idb.get('factionRecruitment',userId);const discoverySources=[...new Set([...(Array.isArray(existing?.discoverySources)?existing.discoverySources:[]),...(Array.isArray(candidate?.discoverySources)?candidate.discoverySources:[]),text(source?.sourceType)].filter(Boolean))];let availability=existing?.availability||'Unknown';if((!existing||availability==='Unknown')&&candidate?.availability)availability=candidate.availability;const patch={availability,recruiterNote:existing?.recruiterNote??candidate?.recruiterNote??'',discoverySources,latestForumSourceId:text(source?.sourceId||candidate?.latestForumSourceId||existing?.latestForumSourceId),updatedAt:candidate?.updatedAt||new Date(observedAt).toISOString()};if(existing?.pipelineStage)patch.pipelineStage=existing.pipelineStage;await repositories.faction.ensure(userId,patch,{sharedPatch:{name:candidate?.name,ee:candidate?.ee,man:candidate?.stats?.man??candidate?.man,int:candidate?.stats?.int??candidate?.int,end:candidate?.stats?.end??candidate?.end,total:candidate?.stats?.total??candidate?.total,lastActive:candidate?.lastActive,lastObservedAt:observedAt},source:'faction-discovery',observedAt});return idb.get('factionRecruitment',userId);}
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
      id:Number(userId),userId,name:text(value.name)||`User ${userId}`,level:finite(value.level),age:finite(value.age),
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
    const sharedPatch={name:candidate.name,lastObservedAt:observedAt};
    if(candidate.level!==null)sharedPatch.level=candidate.level;
    if(candidate.age!==null)sharedPatch.age=candidate.age;
    if(candidate.factionId!==null)sharedPatch.factionId=candidate.factionId;
    if(candidate.onlineStatus)sharedPatch.onlineStatus=candidate.onlineStatus;
    if(candidate.lastActive!==null)sharedPatch.lastActive=candidate.lastActive;
    sharedPatch.lastObservedAt=observedAt;
    const patch={
      pipelineStage:existing?.pipelineStage||(normalizedDomain==='faction'?'Prospect':'Not Contacted'),
      availability:existing?.availability||'Unknown',
      recruiterNote:existing?.recruiterNote||'',
      discoverySources,
      updatedAt:observedAt
    };
    return repositories[normalizedDomain].ensure(candidate.userId,patch,{sharedPatch,source:'api-search',observedAt});
  }

  function normalizeWorkstatHofCandidate(raw={}){
    const value=raw?.user||raw?.player||raw||{};
    const userId=V46Domain.normalizeUserId(value.id??value.user_id??value.userId);
    const level=finite(value.level);
    const age=finite(value.age_in_days??value.age);
    const total=finite(value.value??value.workstats??value.work_stats??value.total);
    const factionRaw=value.faction_id??value.factionId;
    const factionId=factionRaw===null||factionRaw===undefined||factionRaw===''?null:Number(factionRaw);
    const lastRaw=finite(value.last_action??value.lastAction??value.last_action_timestamp);
    const lastActive=lastRaw===null?null:(lastRaw>1e12?lastRaw:lastRaw*1000);
    return{
      id:Number(userId),userId,name:text(value.username??value.name)||`User ${userId}`,
      level,age,total,
      factionId:Number.isFinite(factionId)?factionId:null,
      lastActive,
      hofPosition:finite(value.position??value.rank),
      hofRank:text(value.rank_name??value.rankName)
    };
  }

  async function persistWorkstatHofCandidate(raw,observedAt=Date.now()){
    const candidate=normalizeWorkstatHofCandidate(raw);
    const existing=await idb.get('companyRecruitment',candidate.userId);
    const discoverySources=[...new Set([...(Array.isArray(existing?.discoverySources)?existing.discoverySources:[]),'WORKSTAT LEADERBOARD'])];
    const sharedPatch={name:candidate.name,lastObservedAt:observedAt};
    if(candidate.level!==null)sharedPatch.level=candidate.level;
    if(candidate.age!==null)sharedPatch.age=candidate.age;
    if(candidate.total!==null)sharedPatch.total=candidate.total;
    if(candidate.factionId!==null)sharedPatch.factionId=candidate.factionId;
    if(candidate.lastActive!==null)sharedPatch.lastActive=candidate.lastActive;
    const patch={
      pipelineStage:existing?.pipelineStage||'Not Contacted',
      availability:existing?.availability||'Unknown',
      recruiterNote:existing?.recruiterNote||'',
      discoverySources,
      updatedAt:observedAt
    };
    return repositories.company.ensure(candidate.userId,patch,{sharedPatch,source:'workstat-leaderboard',observedAt});
  }

  async function discoverWorkstatProspects(options={},deps={}){
    const request=deps.tornRequest||tornRequest;
    const persist=deps.persistCandidate||persistWorkstatHofCandidate;
    const injected=Object.keys(deps).length>0;
    const limit=Math.max(1,Math.min(100,Math.floor(number(options.limit,100))));
    const offset=Math.max(0,Math.floor(number(options.offset,0)));
    const minTotal=Math.max(0,finite(options.minTotal)??0);
    const minLevel=Math.max(0,finite(options.minLevel)??0);
    const maxAgeDays=Math.max(0,finite(options.maxAgeDays)??0);
    const maxLastActionDays=Math.max(0,finite(options.maxLastActionDays)??0);
    const observedAt=Date.now();
    const response=await request('torn/hof',{cat:'workstats',limit,offset});
    const rows=Array.isArray(response?.hof)?response.hof:Array.isArray(response?.rankings)?response.rankings:Array.isArray(response?.entries)?response.entries:Array.isArray(response)?response:[];
    let imported=0,skipped=0;
    for(const raw of rows){
      let candidate;
      try{candidate=normalizeWorkstatHofCandidate(raw);}catch{skipped++;continue;}
      if(minTotal>0&&(candidate.total===null||candidate.total<minTotal)){skipped++;continue;}
      if(minLevel>0&&(candidate.level===null||candidate.level<minLevel)){skipped++;continue;}
      if(maxAgeDays>0&&(candidate.age===null||candidate.age>maxAgeDays)){skipped++;continue;}
      if(maxLastActionDays>0){
        if(candidate.lastActive===null||observedAt-candidate.lastActive>maxLastActionDays*86400000){skipped++;continue;}
      }
      await persist(raw,observedAt);
      imported++;
    }
    const result={source:'WORKSTAT LEADERBOARD',requested:rows.length,imported,skipped,limit,offset,nextOffset:offset+rows.length};
    if(!injected){
      await logEvent('discovery','Work-stat HOF prospect discovery completed',result);
      toast(`HOF discovery: ${imported} prospect(s) imported from ${rows.length} result(s).`);
    }
    return result;
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

  async function fillCompanies(){if(state.fill.running)throw new Error('Company fill is already running.');const views=await candidateViews();const plan=Discovery.fillCompaniesPlan(views.map(v=>({...v.candidate,currentCompany:v.currentCompany})));state.fill={running:true,cancelled:false,done:0,total:plan.length,errors:[]};refreshDiscoverRuntimeUi();try{for(const item of plan){if(state.fill.cancelled)break;try{const data=await tornRequest(`user/${item.userId}/job`);const eligibility=Messaging.companyRecruitmentEligibility(data);if(eligibility.known===false)throw new Error('Company affiliation data was missing from the Torn response.');const job=Object.prototype.hasOwnProperty.call(data||{},'job')?data.job:data?.user?.job;const candidate=await idb.get('candidateLocal',String(item.userId))||await idb.get('candidateLocal',Number(item.userId));if(candidate){const company=!eligibility.eligible&&job&&String(job.type||'').toLowerCase()==='company'?job:null;candidate.currentCompany=company?.name||'';candidate.currentCompanyId=company?.id??null;candidate.currentCompanyRating=company?.rating??null;candidate.currentCompanyPosition=company?.position||'';candidate.companyCheckedAt=Date.now();candidate.updatedAt=new Date().toISOString();await idb.put('candidateLocal',candidate);await repositories.players.ensure(String(item.userId),{name:candidate.name,ee:candidate.ee,currentCompany:candidate.currentCompany,currentCompanyId:candidate.currentCompanyId,currentCompanyRating:candidate.currentCompanyRating,currentCompanyPosition:candidate.currentCompanyPosition,companyCheckedAt:candidate.companyCheckedAt,lastObservedAt:candidate.companyCheckedAt},'company-enrichment',candidate.companyCheckedAt);}}catch(error){state.fill.errors.push({userId:item.userId,error:text(error.message)});}finally{state.fill.done++;refreshDiscoverRuntimeUi();}}await logEvent('company-fill','Fill Companies completed',{checked:state.fill.done,errors:state.fill.errors.length});toast(state.fill.cancelled?'Company fill stopped.':`Company fill complete: ${state.fill.done}/${state.fill.total}.`,state.fill.errors.length>0);}finally{state.fill.running=false;if(state.page==='company-discover'||state.page==='company-candidates')await route(state.page,false);}}
  function cancelFill(){if(state.fill.running){state.fill.cancelled=true;toast('Cancelling company lookup after current request.');}}

  function stageColor(stage){return state.settings.recruitment.stageColors?.[stage]||Runtime.STAGE_COLORS[stage]||'#64748b';}
  function availabilityColor(value){return state.settings.recruitment.availabilityColors?.[value]||Runtime.AVAILABILITY_COLORS[value]||'#64748b';}
  function lastActiveText(view){const raw=finite(view.lastActive);if(raw===null)return '—';const ts=raw>1e12?raw/1000:raw;const seconds=Math.max(0,Math.floor(Date.now()/1000-ts));if(seconds<60)return `${seconds}s`;if(seconds<3600)return `${Math.floor(seconds/60)}m`;if(seconds<86400)return `${Math.floor(seconds/3600)}h`;return `${Math.floor(seconds/86400)}d`;}
  function scoreText(value){return finite(value)===null?'—':Number(value).toFixed(1);}
  function pill(label,color){return `<span class="ra-pill" style="--pill:${esc(color)}">${esc(label||'Unknown')}</span>`;}
  function helpButton(key){const item=Runtime.HELP_REGISTRY[key];return item?`<button type="button" class="ra-help" data-help-key="${esc(key)}" aria-label="About ${esc(item.title)}">i</button>`:'';}
  function panel(title,description,body,helpKey=''){return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${helpKey?helpButton(helpKey):''}</div>${body}</section>`;}
  function biohazardSvg(){return '<svg class="ra-biohazard" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="31" r="5" fill="currentColor"/><circle cx="32" cy="17" r="11" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="20" cy="39" r="11" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="44" cy="39" r="11" fill="none" stroke="currentColor" stroke-width="5"/><path d="M29 23 23 34M35 23l6 11M27 43h10" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';}
  function icon(id){return({overview:'⌂',discover:'⌕',candidates:'◎',pipeline:'▦',scout:'◈','smart-match':'◇','global-intelligence':'◉',settings:'⚙',data:'▤',logs:'≡'})[id]||'•';}

  function injectStyles(){if(document.getElementById('ra-v45-css'))return;const style=document.createElement('style');style.id='ra-v45-css';style.textContent=`
:root{--ra-bg:#08070b;--ra-panel:#100d16;--ra-panel2:#181320;--ra-line:#312440;--ra-line-strong:#5a3b73;--ra-text:#f6f1fb;--ra-muted:#aaa0b8;--ra-accent:#9b4dff;--ra-accent2:#d06cff;--ra-brand-deep:#5b21b6;--ra-danger:#e25d63;--ra-warn:#d6a64d;--ra-pad:14px;--ra-font:12px}
:root[data-ra-theme="light"]{--ra-bg:#f6f3fa;--ra-panel:#fff;--ra-panel2:#f7f3fb;--ra-line:#d8cce4;--ra-line-strong:#b49acb;--ra-text:#1d1722;--ra-muted:#6f6479;--ra-accent:#7c3aed;--ra-accent2:#9333ea;--ra-danger:#b4232a;--ra-warn:#8c5b13}
:root[data-ra-density="compact"]{--ra-pad:8px}:root[data-ra-text="small"]{--ra-font:11px}:root[data-ra-text="large"]{--ra-font:14px}
#ra-app,#ra-launch,#ra-help-popover,#ra-toastbox{font:var(--ra-font)/1.4 Arial,sans-serif;color:var(--ra-text);box-sizing:border-box}#ra-app *{box-sizing:border-box}
#ra-app{position:fixed;left:6vw;top:5vh;width:88vw;height:86vh;z-index:2147483401;background:var(--ra-bg);border:1px solid var(--ra-line-strong);border-radius:14px;box-shadow:0 24px 72px #000c,0 0 0 1px #ffffff05;display:none;resize:both;overflow:hidden;min-width:560px;min-height:420px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px)}
.ra-titlebar{height:50px;padding:0 12px 0 16px;display:grid;grid-template-columns:minmax(210px,auto) minmax(150px,220px) 1fr auto;gap:12px;align-items:center;background:radial-gradient(circle at 22% 0%,#7c3aed24,transparent 36%),linear-gradient(180deg,#17121f,#0e0b13);border-bottom:1px solid var(--ra-line);cursor:move}.ra-title-brand{display:flex;align-items:center;gap:10px;min-width:0}.ra-title-mark{width:24px;height:24px;display:grid;place-items:center;border:1px solid #7c3aed;border-radius:7px;color:var(--ra-accent2);font-size:13px;box-shadow:inset 0 0 12px #9b4dff24,0 0 16px #9b4dff20}.ra-title-copy{display:grid;line-height:1.05}.ra-title-copy small{font-size:8px;letter-spacing:.16em;color:var(--ra-muted);font-weight:800}.ra-title-copy strong{font-size:12px;letter-spacing:.05em;color:var(--ra-text)}.ra-version{font-size:9px;color:var(--ra-muted);font-weight:600;margin-left:4px}.ra-title-actions,.ra-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ra-title-spacer{min-width:0}.ra-workspace-select{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:center;cursor:default}.ra-workspace-select>span{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--ra-muted);font-weight:900}.ra-workspace-toggle{width:100%;min-width:118px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--ra-line-strong);background:linear-gradient(180deg,#1d1527,#120e19);color:var(--ra-text);font-weight:800;outline:none;cursor:pointer;box-shadow:inset 0 1px 0 #ffffff0a}.ra-workspace-toggle:focus-visible{border-color:var(--ra-accent);box-shadow:0 0 0 2px #9b4dff25}.ra-workspace-menu{position:absolute;left:34px;top:calc(100% + 6px);z-index:30;min-width:150px;padding:5px;border:1px solid var(--ra-line-strong);border-radius:9px;background:linear-gradient(180deg,#1a1323,#0d0a12);box-shadow:0 14px 36px #000b,0 0 22px #9b4dff18}.ra-workspace-menu[hidden]{display:none}.ra-workspace-menu button{width:100%;display:flex;align-items:center;gap:8px;padding:8px 9px;border:0;border-radius:6px;background:transparent;color:var(--ra-text);text-align:left;font-weight:800;cursor:pointer}.ra-workspace-menu button:hover,.ra-workspace-menu button:focus-visible,.ra-workspace-menu button.active{background:#9b4dff22;color:#f4dcff;outline:none}.ra-workspace-caret{color:var(--ra-accent2);font-size:10px}.ra-shell{display:grid;grid-template-columns:196px minmax(0,1fr);height:calc(100% - 50px);position:relative}.ra-shell.is-collapsed{grid-template-columns:58px minmax(0,1fr)}
.ra-sidebar{background:radial-gradient(circle at 0 0,#7c3aed17,transparent 32%),linear-gradient(180deg,#130f19,#0c0a0f);border-right:1px solid var(--ra-line);overflow:auto;padding:10px}.ra-sidebar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.ra-brand{font-weight:900;font-size:10px;letter-spacing:.08em;color:var(--ra-muted)}.is-collapsed .ra-brand,.is-collapsed .ra-group-label,.is-collapsed .ra-nav-text{display:none}.ra-group-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;border:0;border-radius:6px;padding:7px 8px;background:transparent;color:var(--ra-muted);cursor:pointer;text-align:left}.ra-group-toggle:hover,.ra-group-toggle:focus-visible{background:var(--ra-panel2);outline:none}.ra-group-toggle.has-active{color:var(--ra-accent2)}.ra-group-label{font-size:9px;font-weight:900;letter-spacing:.08em;color:inherit;margin:0}.ra-group-chevron{font-size:11px;font-weight:900;line-height:1}.ra-nav{display:grid;gap:3px}.ra-nav[hidden]{display:none}.ra-nav button{display:flex;align-items:center;gap:8px;border:0;border-radius:7px;padding:9px 8px;background:transparent;color:var(--ra-text);cursor:pointer;text-align:left}.ra-nav button:hover,.ra-nav button.active{background:#ffffff08}.ra-nav button.active{box-shadow:inset 3px 0 0 var(--ra-accent);color:#fff}.ra-nav-icon{width:18px;color:var(--ra-accent2);font-weight:900;text-align:center}
.ra-main{min-width:0;display:flex;flex-direction:column}.ra-pagehead{padding:12px 15px;background:var(--ra-panel);border-bottom:1px solid var(--ra-line);display:flex;justify-content:space-between;align-items:center;gap:8px}.ra-pagehead h2{margin:0;font-size:17px}.ra-pagehead p{margin:2px 0 0;color:var(--ra-muted)}.ra-content{overflow:auto;flex:1;padding:var(--ra-pad)}
.ra-panel{border:1px solid var(--ra-line);border-radius:10px;background:linear-gradient(180deg,#15111d,#0f0c14);padding:14px;box-shadow:inset 0 1px 0 #ffffff05;margin-bottom:12px}.ra-search-panel{border-color:#49345f}.ra-results-panel{padding:0;overflow:hidden}.ra-results-panel>.ra-panel-head{padding:14px 14px 0}.ra-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}.ra-panel-head h3{margin:0;font-size:14px;letter-spacing:.02em}.ra-panel-head p{margin:3px 0 0;color:var(--ra-muted);font-size:10px}.ra-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ra-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ra-core-search-grid{grid-template-columns:repeat(4,minmax(120px,1fr));margin-bottom:10px}.ra-field label{display:block;color:var(--ra-muted);font-size:9px;text-transform:uppercase;font-weight:900;margin-bottom:4px;letter-spacing:.06em}.ra-field input,.ra-field select,.ra-field textarea{width:100%;padding:8px 9px;border-radius:7px;border:1px solid var(--ra-line);background:#0d0d11;color:var(--ra-text);outline:none}.ra-field input:focus,.ra-field select:focus,.ra-field textarea:focus{border-color:var(--ra-accent);box-shadow:0 0 0 2px #9b4dff22}.ra-field textarea{min-height:76px;resize:vertical}.ra-optional-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}.ra-optional-toggle{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid var(--ra-line);border-radius:7px;background:var(--ra-panel2);color:var(--ra-text)}
.ra-btn{border:1px solid var(--ra-line);border-radius:7px;background:var(--ra-panel2);color:var(--ra-text);padding:6px 9px;cursor:pointer;font-weight:700;text-decoration:none}.ra-btn:hover{border-color:var(--ra-accent)}.ra-primary{border-color:var(--ra-accent);background:color-mix(in srgb,var(--ra-accent) 20%,var(--ra-panel2))}.ra-danger{border-color:var(--ra-danger);color:var(--ra-danger)}.ra-help{display:inline-grid;place-items:center;width:20px;height:20px;padding:0;border:1px solid var(--ra-line);border-radius:50%;background:var(--ra-panel2);color:var(--ra-muted);cursor:pointer;flex:0 0 auto}.ra-muted{color:var(--ra-muted)}.ra-note{font-size:10px;color:var(--ra-muted)}
.ra-pill{display:inline-block;border:1px solid color-mix(in srgb,var(--pill) 70%,var(--ra-line));background:color-mix(in srgb,var(--pill) 16%,transparent);border-radius:999px;padding:2px 6px;white-space:nowrap}.ra-table-wrap{overflow:auto;border:1px solid var(--ra-line);border-radius:8px}.ra-table{border-collapse:collapse;width:100%;min-width:900px}.ra-table th,.ra-table td{padding:7px;border-bottom:1px solid var(--ra-line);white-space:nowrap;text-align:left}.ra-table th{position:sticky;top:0;background:var(--ra-panel2);z-index:2}.ra-sort-button{all:unset;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:inherit;font:inherit;font-weight:800}.ra-sort-button:hover,.ra-sort-button:focus-visible{color:var(--ra-accent2)}.ra-sort-button:focus-visible{outline:2px solid var(--ra-accent);outline-offset:2px;border-radius:3px}.ra-online-live,.ra-online-idle,.ra-online-offline{display:inline-flex;align-items:center;gap:5px;font-weight:800}.ra-online-live:before,.ra-online-idle:before,.ra-online-offline:before{content:"";width:7px;height:7px;border-radius:50%}.ra-online-live:before{background:#45c486;box-shadow:0 0 0 3px #45c4861f}.ra-online-idle:before{background:#d7a84b}.ra-online-offline:before{background:#777781}.ra-table tr{background:color-mix(in srgb,var(--row-tint,transparent) 7%,transparent)}.ra-link{color:var(--ra-accent2);text-decoration:none}.ra-drawer{position:absolute;right:0;top:0;bottom:0;width:min(460px,94%);z-index:12;background:linear-gradient(180deg,#15101d,#0e0b13);border-left:1px solid var(--ra-line-strong);box-shadow:-12px 0 30px #0009,0 0 24px #9b4dff12;overflow:auto;padding:12px}.ra-drawer.is-popout{position:fixed;right:18px;top:72px;bottom:auto;height:min(76vh,720px);width:min(430px,calc(100vw - 24px));border:1px solid var(--ra-line-strong);border-radius:12px;box-shadow:0 24px 80px #000c,0 0 34px #9b4dff20}.ra-player-card-title{display:flex;align-items:center;gap:8px}.ra-player-card-score{margin-left:auto;border:1px solid #6d43a2;border-radius:999px;padding:3px 8px;color:#e5c4ff;background:#9b4dff16;font-weight:900}.ra-player-card-domain{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ra-accent2)}.ra-player-card-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:12px}.ra-drawer[hidden]{display:none}.ra-drawer-head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:-12px;background:var(--ra-panel);padding:10px 0;z-index:2}.ra-detail-section{border-top:1px solid var(--ra-line);padding-top:8px;margin-top:8px}.ra-detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}.ra-detail-grid span{color:var(--ra-muted)}.ra-detail-grid b{display:block;color:var(--ra-text)}
.ra-modal{position:absolute;inset:0;z-index:15;background:#0009;display:grid;place-items:center;padding:18px}.ra-modal[hidden]{display:none}.ra-modal-card{width:min(620px,96%);max-height:92%;overflow:auto;background:var(--ra-panel);border:1px solid var(--ra-line);border-radius:10px;padding:12px}.ra-modal-card h3{margin-top:0}.ra-log{font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;max-height:280px;overflow:auto;background:#050806;border:1px solid var(--ra-line);border-radius:7px;padding:8px}.ra-progress{height:8px;background:var(--ra-line);border-radius:99px;overflow:hidden}.ra-progress>div{height:100%;background:var(--ra-accent);width:0}.ra-source-card{border:1px solid var(--ra-line);border-radius:8px;padding:9px;background:var(--ra-panel2)}.ra-source-card b{display:block}.ra-source-card small{color:var(--ra-muted)}
.ra-settings details{border:1px solid var(--ra-line);border-radius:8px;background:var(--ra-panel);margin:7px 0;padding:8px}.ra-settings summary{font-weight:900;cursor:pointer}.ra-settings-body{padding-top:8px}.ra-color-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.ra-color-row{display:flex;align-items:center;gap:6px}.ra-color-row input[type=color]{width:38px;height:28px;padding:1px}.ra-danger-zone{border-color:var(--ra-danger)!important}.ra-nuke{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ra-danger);background:color-mix(in srgb,var(--ra-danger) 16%,var(--ra-panel2));color:var(--ra-danger);font-weight:900;border-radius:8px;padding:9px 12px;cursor:pointer}.ra-biohazard{width:24px;height:24px}.ra-help-popover{position:fixed;z-index:2147483647;max-width:min(340px,calc(100vw - 16px));padding:10px;border:1px solid var(--ra-accent);border-radius:8px;background:var(--ra-panel);box-shadow:0 10px 30px #0009}.ra-help-popover[hidden]{display:none}.ra-toastbox{position:fixed;right:12px;top:12px;z-index:2147483647;display:grid;gap:6px}.ra-toast{max-width:360px;border:1px solid var(--ra-line);border-left:3px solid var(--ra-accent);background:var(--ra-panel);padding:9px;border-radius:7px;box-shadow:0 8px 24px #0008}.ra-toast.bad{border-left-color:var(--ra-danger)}
#ra-mobile-menu{display:none}@media(max-width:640px){#ra-mobile-menu{display:inline-block}}.ra-profile-more{display:inline-block;position:relative}.ra-profile-more>summary{list-style:none;display:inline-block}.ra-profile-more>summary::-webkit-details-marker{display:none}.ra-profile-more[open]>.ra-actions{margin-top:6px}.ra-settings-advanced{margin-top:16px;padding-top:6px;border-top:1px dashed var(--ra-line)}.ra-settings-group-title{margin:6px 0 2px;font-size:13px}@media(max-width:900px){#ra-app{left:3vw;top:4vh;width:94vw;height:90vh}.ra-shell{grid-template-columns:58px minmax(0,1fr)}.ra-brand,.ra-group-label,.ra-nav-text{display:none}.ra-color-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){#ra-app{left:4px;top:44px;width:calc(100vw - 8px);height:calc(100vh - 52px);min-width:0;min-height:0}.ra-titlebar{grid-template-columns:minmax(0,1fr) minmax(104px,128px) auto;gap:6px;padding:0 7px;height:50px}.ra-title-spacer,.ra-title-mark,.ra-title-copy small,.ra-workspace-select>span{display:none}.ra-title-copy strong{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ra-workspace-select{display:block;min-width:0}.ra-workspace-toggle{min-width:0;width:100%;padding:6px 7px;font-size:10px}.ra-workspace-menu{left:0;right:0;min-width:0}.ra-title-actions{flex-wrap:nowrap;gap:3px}.ra-title-actions .ra-btn{padding:5px 7px}.ra-shell{grid-template-columns:minmax(0,1fr)}.ra-sidebar{position:absolute;left:0;top:0;bottom:0;width:230px;z-index:10;transform:translateX(-105%);transition:transform .15s}.ra-shell.sidebar-open .ra-sidebar{transform:translateX(0)}.ra-brand,.ra-group-label,.ra-nav-text{display:initial}.ra-grid,.ra-formgrid,.ra-detail-grid,.ra-color-grid{grid-template-columns:1fr}.ra-drawer{width:100%}.ra-pagehead{align-items:flex-start}}
`;document.head.appendChild(style);}

  function applyTheme(){const root=document.documentElement;root.dataset.raTheme=state.settings.theme;root.dataset.raDensity=state.settings.density;root.dataset.raText=state.settings.textSize;}
  function toast(message,bad=false){let box=document.getElementById('ra-toastbox');if(!box){if(!document.body)return;injectStyles();box=document.createElement('div');box.id='ra-toastbox';box.className='ra-toastbox';document.body.appendChild(box);}const item=document.createElement('div');item.className=`ra-toast${bad?' bad':''}`;item.textContent=message;box.appendChild(item);setTimeout(()=>item.remove(),3800);}
  function activeDomain(){if(String(state.page||'').startsWith('faction-'))return 'faction';if(String(state.page||'').startsWith('company-')&&state.page!=='company-discover')return 'company';return state.settings.activeDomain==='faction'?'faction':'company';}
  function workspaceSelectHtml(domain=activeDomain()){const selected=domain==='faction'?'faction':'company',label=selected==='faction'?'Faction':'Company';return `<div class="ra-workspace-select"><span>Mode</span><button type="button" class="ra-workspace-toggle" id="ra-workspace-toggle" aria-haspopup="menu" aria-expanded="false"><span id="ra-workspace-label">${label}</span><span class="ra-workspace-caret" aria-hidden="true">▾</span></button><div class="ra-workspace-menu" id="ra-workspace-menu" role="menu" hidden><button type="button" role="menuitem" data-workspace-domain="company" class="${selected==='company'?'active':''}">Company</button><button type="button" role="menuitem" data-workspace-domain="faction" class="${selected==='faction'?'active':''}">Faction</button></div></div>`;}
  function navHtml(){const domain=activeDomain();const expanded=new Set(state.settings.navigation?.expandedGroups||[]);const groups=V46Navigation.visibleGroups(state.settings);const domainId=`${domain}-recruitment`;const visible=groups.filter(group=>group.id===domainId||group.id==='intelligence'||group.id==='application');const sections=visible.map(group=>{const core=group.id===domainId;if(core)return `<div class="ra-nav-section"><div class="ra-group-label" style="padding:6px 8px">${esc(group.label)}</div><div class="ra-nav">${group.pages.map(page=>`<button type="button" data-page="${esc(page.id)}"><span class="ra-nav-icon">${esc(icon(page.id))}</span><span class="ra-nav-text">${esc(page.label)}</span></button>`).join('')}</div></div>`;const open=expanded.has(group.id);const hasActive=group.pages.some(page=>page.id===state.page);return `<div class="ra-nav-section"><button type="button" class="ra-group-toggle${hasActive?' has-active':''}" data-nav-toggle="${esc(group.id)}" aria-expanded="${open?'true':'false'}"><span class="ra-group-label">${esc(group.label)}</span><span class="ra-group-chevron" aria-hidden="true">${open?'▾':'▸'}</span></button><div class="ra-nav" data-nav-group="${esc(group.id)}" ${open?'':'hidden'}>${group.pages.map(page=>`<button type="button" data-page="${esc(page.id)}"><span class="ra-nav-icon">${esc(icon(page.id))}</span><span class="ra-nav-text">${esc(page.label)}</span></button>`).join('')}</div></div>`;}).join('');return sections;}
  function rebuildNav(){const target=document.getElementById('ra-nav');if(target)target.innerHTML=navHtml();document.querySelector('.ra-shell')?.classList.toggle('is-collapsed',!!state.settings.sidebarCollapsed);const workspaceLabel=document.getElementById('ra-workspace-label');if(workspaceLabel)workspaceLabel.textContent=activeDomain()==='faction'?'Faction':'Company';document.querySelectorAll('[data-workspace-domain]').forEach(button=>button.classList.toggle('active',button.dataset.workspaceDomain===activeDomain()));target?.querySelectorAll('[data-nav-toggle]').forEach(button=>button.onclick=async()=>{const expanded=V46Navigation.toggleExpandedGroup(state.settings.navigation.expandedGroups,button.dataset.navToggle);await saveSettings({navigation:{...state.settings.navigation,expandedGroups:expanded}});rebuildNav();});target?.querySelectorAll('[data-page]').forEach(btn=>btn.onclick=()=>route(btn.dataset.page).catch(e=>toast(e.message,true)));V46CompanyPlatform.syncNavigation?.();V47FactionPlatform.syncNavigation?.();target?.querySelector(`[data-page="${state.page}"]`)?.classList.add('active');}

  function pageMeta(page){return({'company-discover':['Forum Discovery','Sync official Torn forum recruitment sources and enrich candidates.'],scout:['Scout','Collect official Torn player intelligence through the shared scheduler.'],'smart-match':['Smart Match','Build local vacancy profiles and explain candidate Match scores.'],'global-intelligence':['Global Intelligence','Review the sanitized shared intelligence service.'],settings:['Settings','Only Getting started is needed to search, filter and message. Everything under Advanced is optional.'],data:['Data','Local IndexedDB counts, export and reset controls.']})[page]||['Search & Results','Recruitment Agency'];}


  function sourceStatusCard(feed,cp){const resume=!!cp?.resumeAvailable;return `<div class="ra-source-card"><b>${esc(feed.label)}</b><small>${feed.enabled?`Thread ${esc(feed.threadId)}`:'Not configured'}</small><div>${cp?.updatedAt?`Last sync ${new Date(cp.updatedAt).toLocaleString()}`:'Never synced'}</div><div>${resume?pill('Resume available',Runtime.AVAILABILITY_COLORS.Available):pill(feed.enabled?'Ready':'Disabled','#64748b')}</div></div>`;}
  async function renderDiscover(){const feeds=Discovery.feedDefinitions(state.settings.recruitment);const checkpoints=new Map((await idb.getAll('forumSyncState')).map(x=>[x.feedId,x]));const sources=(await idb.getAll('forumSources')).sort((a,b)=>Number(b.postedAt||0)-Number(a.postedAt||0)).slice(0,12);const views=await candidateViews();const viewMap=new Map(views.map(v=>[String(v.userId),v]));const c=state.sync.running?(checkpoints.get(state.sync.feed)?.counters||{}):{};return `${panel('Forum Discovery','Official Torn v2 forum sources',`<div class="ra-actions"><button class="ra-btn ra-primary" id="ra-sync">Sync Forum Posts</button><button class="ra-btn" id="ra-add-candidate">Add Candidate</button><button class="ra-btn" id="ra-fill-companies">Fill Companies</button><button class="ra-btn ra-danger" id="ra-cancel-work" ${(state.sync.running||state.fill.running)?'':'hidden'}>Cancel</button><button class="ra-btn" id="ra-discover-menu">More ▾</button></div><div id="ra-discover-more" hidden class="ra-actions" style="margin-top:6px"><button class="ra-btn" data-open-thread="company">Open Company Thread</button><button class="ra-btn" data-open-thread="faction">Open Faction Thread</button><button class="ra-btn" data-open-thread="training">Open Training Thread</button><button class="ra-btn" id="ra-reset-forum">Reset Forum Import</button><button class="ra-btn" id="ra-refresh-discover">Refresh View</button></div><div style="margin-top:9px" class="ra-progress"><div id="ra-discover-progress"></div></div><div id="ra-discover-progress-text" class="ra-note">${state.fill.running?`Company lookups ${state.fill.done}/${state.fill.total}`:state.sync.running?`Syncing ${esc(state.sync.feed)} page ${state.sync.pages}`:'Idle'}</div>`,'sync')}<div class="ra-grid">${feeds.map(feed=>sourceStatusCard(feed,checkpoints.get(feed.feedId))).join('')}</div>${panel('Activity','Timestamped discovery activity',`<div class="ra-log" id="ra-discovery-log">${state.sync.running?`[${new Date().toLocaleTimeString()}] Sync active: ${esc(state.sync.feed)}\nPages: ${number(c.pagesChecked)} · Posts: ${number(c.postsExamined)} · Created: ${number(c.candidatesCreated)} · Updated: ${number(c.candidatesUpdated)}`:`[${new Date().toLocaleTimeString()}] Ready.${state.fill.errors.length?`\nLast company fill errors: ${state.fill.errors.map(x=>`${x.userId}: ${x.error}`).join(' | ')}`:''}`}</div>`)}${panel('Recent Discoveries','Latest imported candidates',`<div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Source</th><th>Looking For</th><th>Match</th><th>Stage</th><th>Discovered / Updated</th></tr></thead><tbody>${sources.map(s=>{const v=viewMap.get(String(s.userId));return `<tr><td><a href="#" data-detail="${esc(s.userId)}" data-detail-domain="${recruitmentDomainForFeed(s)}" class="ra-link">${esc(v?.name||s.authorName||`User ${s.userId}`)}</a></td><td>${esc(s.sourceType)}</td><td>${esc(v?.lookingFor||'Unknown')}</td><td>${scoreText(v?.matchScore)}</td><td>${v?pill(v.pipelineStage,stageColor(v.pipelineStage)):'—'}</td><td>${s.postedAt?new Date(s.postedAt).toLocaleString():'—'}</td></tr>`;}).join('')||'<tr><td colspan="6">No discoveries yet.</td></tr>'}</tbody></table></div>`,'discovery')}`;}



  async function renderScout(){const history=(await idb.getAll('scoutHistory')).sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,20);return `${panel('Scout','Official Torn player intelligence',`<div class="ra-formgrid"><div class="ra-field"><label>Player IDs / profile URLs</label><textarea id="ra-scout-ids" placeholder="3877028, profile URLs, etc."></textarea></div><div><div class="ra-detail-grid"><span>Queue<b>${state.scout.done}/${state.scout.total}</b></span><span>API calls<b>${state.scout.calls}</b></span><span>Current candidate<b>${state.scout.currentId||'—'}</b></span><span>Status<b id="ra-scout-status">${esc(state.scout.status)}</b></span></div><div class="ra-progress" style="margin-top:8px"><div id="ra-scout-progress" style="width:${state.scout.total?Math.min(100,state.scout.done/state.scout.total*100):0}%"></div></div></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-run-scout">Scout</button><button class="ra-btn" id="ra-pause-scout" ${state.scout.running?'':'disabled'}>${state.scout.paused?'Resume':'Pause'}</button><button class="ra-btn ra-danger" id="ra-cancel-scout" ${state.scout.running?'':'disabled'}>Cancel</button></div>`) }${panel('Scout History','Most recent local snapshots',`<div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Captured</th><th>Fit</th><th>Type</th><th>Trend</th></tr></thead><tbody>${history.map(s=>`<tr><td>${esc(s.profile?.name||s.userId)}</td><td>${new Date(s.capturedAt).toLocaleString()}</td><td>${scoreText(scoutFit(s))}</td><td>${esc(s.originalFitType||'—')}</td><td>${finite(s.trend)===null?'—':`${Number(s.trend)>=0?'+':''}${Number(s.trend).toFixed(1)}%`}</td></tr>`).join('')||'<tr><td colspan="5">No Scout history.</td></tr>'}</tbody></table></div>`)}`;}

  function criterionControl(key,c){const label={man:'MAN',int:'INT',end:'END',ee:'EE',fit:'Fit',activity30:'Activity 30d',xanax30:'Xanax 30d',refills30:'Refills 30d',attacks30:'Attacks 30d',rwHits30:'RW Hits 30d',company:'Company',role:'Role',salary:'Salary',availability:'Availability'}[key]||key;let value='';if(['company','role'].includes(key))value=`<input data-match-value="${key}" value="${esc(c.value||'')}">`;else if(key==='availability')value=`<select data-match-value="availability"><option value="">Any</option>${MatchCore.AVAILABILITY_VALUES.map(v=>`<option value="${esc(v)}" ${c.value===v?'selected':''}>${esc(v.replaceAll('_',' '))}</option>`).join('')}</select>`;else if(key==='salary')value=`<input data-match-max="salary" type="number" value="${esc(c.max||0)}">`;else value=`<input data-match-target="${key}" type="number" value="${esc(c.target||0)}">`;return `<div class="ra-formgrid" style="grid-template-columns:1.2fr 1fr 80px;align-items:end;margin:5px 0"><label><input type="checkbox" data-match-enabled="${esc(key)}" ${c.enabled?'checked':''}> ${esc(label)}</label><div class="ra-field"><label>Target / Value</label>${value}</div><div class="ra-field"><label>Weight</label><input data-match-weight="${esc(key)}" type="number" value="${esc(c.weight||0)}"></div></div>`;}
  async function renderSmartMatch(){const profiles=(await idb.getAll('matchProfiles')).map(MatchCore.normalizeProfile);const active=await getActiveMatchProfile(true);const criteria=MatchCore.CRITERIA_KEYS.map(key=>criterionControl(key,active.criteria[key])).join('');return `${panel('Smart Match','Local-only matching · zero Torn API calls',`<div class="ra-actions"><select id="ra-match-profile-select" class="ra-btn">${profiles.map(p=>`<option value="${esc(p.profileId)}" ${p.profileId===active.profileId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="ra-btn" id="ra-match-new">Create</button><button class="ra-btn" id="ra-match-duplicate">Duplicate</button><button class="ra-btn ra-danger" id="ra-match-delete">Delete</button></div><div class="ra-field" style="margin-top:8px"><label>Profile name</label><input id="ra-match-name" value="${esc(active.name)}"></div><div style="margin-top:8px">${criteria}</div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-match-save">Save Profile</button></div>`) }${panel('Known / Unknown','How Match handles incomplete candidate data',`<div class="ra-muted">Enabled criteria with unknown candidate values are excluded from the denominator. Smart Match recalculation is local and never calls Torn.</div>`)}`;}

  async function renderGlobal(){const pending=(await idb.getAll('globalSyncQueue')).length;return `${panel('Global Intelligence','Sanitized shared public-player observations',`<div class="ra-detail-grid"><span>Enabled<b>${state.settings.global.enabled?'Yes':'No'}</b></span><span>Endpoint<b>${globalEndpoint()?'Configured':'Not configured'}</b></span><span>Pending queue<b>${pending}</b></span><span>Schema<b>${GlobalCore.GLOBAL_SCHEMA_VERSION}</b></span></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" id="ra-global-test">Test Service</button><button class="ra-btn" id="ra-global-retry">Retry Sync</button></div>`) }${panel('Privacy','Exactly what can leave the browser',`<div class="ra-muted">Shared fields: ${esc(GlobalCore.GLOBAL_FIELDS.join(', '))}.</div><p class="ra-muted">Forum text, source URLs/history, pipeline stage, notes, salary, availability overrides, Match/Profile data, recruitment messages and workflow state remain local.</p>`)}`;}

  function settingsSection(title,id,body,help='',open=false){return `<details data-settings-section="${esc(id)}"${open?' open':''}><summary>${esc(title)} ${help?helpButton(help):''}</summary><div class="ra-settings-body">${body}</div></details>`;}
  function colorSettings(){const availability=Runtime.AVAILABILITY_VALUES.map(v=>`<label class="ra-color-row"><input type="color" data-availability-color="${esc(v)}" value="${esc(availabilityColor(v))}"> ${esc(v)}</label>`).join('');return `<div class="ra-color-grid">${availability}</div><div class="ra-actions"><button class="ra-btn" id="ra-reset-colors">Reset Colours</button></div>`;}
  function optionalModuleSettingsHtml(){return `<div class="ra-note" style="margin-bottom:8px">Search & Results stays available. Enable only the extra tools you actually use.</div><div data-optional-group="tools"><div class="ra-optional-grid">${OPTIONAL_MODULES.map(([key,label])=>`<label class="ra-optional-toggle"><input type="checkbox" data-optional-module="${esc(key)}" ${state.settings.optionalModules?.[key]===true?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div></div>`;}
  async function renderSettings(){const r=state.settings.recruitment;return `<div class="ra-settings">${settingsSection('Getting started','essentials',`<div class="ra-formgrid"><div class="ra-field" style="grid-column:1/-1"><label>Torn API key</label><div class="ra-actions"><span class="ra-muted" id="ra-api-key-status">${state.settings.apiKey?'Saved on this device.':'Not set yet. You will be asked for it the first time the app contacts Torn.'}</span><button class="ra-btn" id="ra-set-key">Set / Change API Key</button></div></div><div class="ra-field" style="grid-column:1/-1"><b>Company recruitment</b><div class="ra-note">Recruit performs a fresh Torn check before preparing private chat.</div></div><div class="ra-field"><label>Company name</label><input id="ra-setting-own-company" value="${esc(state.settings.ownCompanyName)}" placeholder="Bad Decisions"></div><div class="ra-field"><label>Company type</label><input id="ra-setting-company-type" value="${esc(r.companyType)}" placeholder="Adult Novelties"></div><div class="ra-field" style="grid-column:1/-1"><label>Company recruitment private-chat message</label><textarea id="ra-setting-company-message" style="min-height:150px">${esc(r.companyRecruitmentMessage)}</textarea><div class="ra-note">Placeholders: {name} {company_name} {company_type}</div></div><div class="ra-field" style="grid-column:1/-1"><b>Faction recruitment</b></div><div class="ra-field"><label>Faction name</label><input id="ra-setting-faction-name" value="${esc(r.factionName)}" placeholder="Silent Ledger"></div><div class="ra-field" style="grid-column:1/-1"><label>Faction recruitment private-chat message</label><textarea id="ra-setting-faction-message" style="min-height:150px">${esc(r.factionRecruitmentMessage)}</textarea><div class="ra-note">Placeholders: {name} {faction_name}</div></div><input type="hidden" id="ra-setting-default-message" value="${esc(r.defaultMessage)}"></div>`,'defaultMessage',true)}${settingsSection('General','general',`<div class="ra-formgrid"><div class="ra-field"><label>Theme</label><select id="ra-setting-theme"><option value="dark">Dark</option><option value="light">Light</option></select></div><div class="ra-field"><label>Density</label><select id="ra-setting-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div><div class="ra-field"><label>Interface text size</label><select id="ra-setting-text"><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option></select></div><div class="ra-field"><label>Launcher</label><select id="ra-setting-launcher"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="ra-field"><label>Sidebar</label><select id="ra-setting-sidebar"><option value="false">Expanded</option><option value="true">Collapsed</option></select></div><div class="ra-field"><label>Include inactive candidates</label><select id="ra-setting-inactive"><option value="false">No</option><option value="true">Yes</option></select></div></div>`)}<div class="ra-settings-advanced" data-settings-group="advanced"><h3 class="ra-settings-group-title">Advanced (optional)</h3><p class="ra-muted">Extra tools and tuning. Not needed for searching, filtering or messaging.</p>${settingsSection('Optional Features','optional-features',optionalModuleSettingsHtml())}${settingsSection('Recruitment sources & colours','recruitment',`<div class="ra-formgrid"><div class="ra-field"><label>Company thread</label><input id="ra-setting-company-thread" value="${esc(r.companyThreadId)}"></div><div class="ra-field"><label>Faction thread</label><input id="ra-setting-faction-thread" value="${esc(r.factionThreadId)}"></div><div class="ra-field"><label>Training thread</label><input id="ra-setting-training-thread" value="${esc(r.trainingThreadId)}"></div><div class="ra-field"><label>Recent import window (days)</label><input id="ra-setting-import-days" type="number" min="1" value="${r.recentImportDays}"></div><div class="ra-field"><label>Max pages / feed</label><input id="ra-setting-max-pages" type="number" min="1" value="${r.maxPagesPerFeed}"></div><div class="ra-field"><label>Candidate active age (days)</label><input id="ra-setting-active-age" type="number" min="1" value="${r.candidateActiveAgeDays}"></div><div class="ra-field"><label>Train buyers</label><select id="ra-setting-train-explicit"><option value="true">Explicit only</option><option value="false">All parsed train interest</option></select></div></div>${colorSettings()}`)}${settingsSection('Scout','scout',`<div class="ra-formgrid"><div class="ra-field"><label>API calls/min (max 75)</label><input id="ra-setting-rate" type="number" min="10" max="75" value="${state.settings.scout.rate}"></div><div class="ra-field"><label>Workers</label><input id="ra-setting-workers" type="number" min="1" max="8" value="${state.settings.scout.workers}"></div><div class="ra-field"><label>Request budget</label><input id="ra-setting-budget" type="number" min="1" value="${state.settings.scout.budget}"></div><div class="ra-field"><label>History gap ms</label><input id="ra-setting-history-gap" type="number" min="0" value="${state.settings.scout.historyGapMs}"></div></div><div class="ra-actions"><button class="ra-btn" id="ra-cache-diagnostic">Diagnostics</button></div>`)}${settingsSection('Candidates','candidates',`<div class="ra-formgrid"><div class="ra-field"><label>Results layout</label><select id="ra-setting-results-layout"><option value="expanded">Expanded table</option><option value="compact">Compact table · details in Player Card</option></select></div><div class="ra-field"><label>Compactness</label><select id="ra-setting-candidate-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div><div class="ra-field"><label>Player name click</label><select id="ra-setting-player-card-name"><option value="true">Open Player Card</option><option value="false">Do nothing</option></select></div><div class="ra-field"><label>Player Card pop-out</label><select id="ra-setting-player-card-popout"><option value="true">Allowed</option><option value="false">Disabled</option></select></div><div class="ra-field"><label>Remember open Player Card</label><select id="ra-setting-player-card-remember"><option value="true">Yes</option><option value="false">No</option></select></div></div><div class="ra-note" style="margin:8px 0">Compact results keep the table minimal; the hidden intelligence remains available in the context-sensitive Player Card. Company and Faction never share private workflow state.</div><div class="ra-actions"><button class="ra-btn" id="ra-reset-layout">Reset Layout</button></div>`)}${settingsSection('Smart Match','smart-match',`<div class="ra-muted">Smart Match profiles are edited on the Smart Match page.</div><div class="ra-actions"><button class="ra-btn" data-go-page="smart-match">Open Smart Match</button></div>`)}${settingsSection('Global Intelligence','global',`<div class="ra-formgrid"><div class="ra-field"><label>Enabled</label><select id="ra-setting-global-enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="ra-field"><label>Endpoint</label><input id="ra-setting-global-endpoint" value="${esc(state.settings.global.endpoint)}"></div></div><div class="ra-actions"><button class="ra-btn" id="ra-setting-global-test">Test</button><button class="ra-btn" id="ra-setting-global-retry">Retry</button></div>`)}${settingsSection('Data & Reset','data',`<div class="ra-actions"><button class="ra-btn" id="ra-reset-layout-2">Reset Layout</button><button class="ra-btn" id="ra-clear-scout">Clear Scout Cache</button><button class="ra-btn" id="ra-clear-recruitment">Clear Local Candidate / Forum Data</button></div>`,'data')}<details class="ra-danger-zone" data-settings-section="danger"><summary>Danger Zone</summary><div class="ra-settings-body"><p class="ra-muted">Hard local reset deletes Recruitment Agency browser-local data only. Torn account data and unrelated userscripts are untouched.</p><button type="button" id="ra-nuke" class="ra-nuke">${biohazardSvg()}<span>NUKE IT ALL!</span></button></div></details></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-save-settings">Save Settings</button></div></div>`;}

  async function renderData(){const candidates=await idb.getAll('candidateLocal'),sources=await idb.getAll('forumSources'),logs=await idb.getAll('appLogs');return `${panel('Local Data','IndexedDB store summary',`<div class="ra-detail-grid"><span>DB version<b>${DB_VERSION}</b></span><span>Candidates<b>${candidates.length}</b></span><span>Forum sources<b>${sources.length}</b></span><span>Logs<b>${logs.length}</b></span></div><div class="ra-actions" style="margin-top:8px"><button class="ra-btn" id="ra-export-csv">Export Candidate CSV</button><button class="ra-btn" id="ra-data-clear-candidates">Clear Candidate / Forum Data</button></div>`,'data')}`;}

  const renderers={'company-discover':renderDiscover,scout:renderScout,'smart-match':renderSmartMatch,'global-intelligence':renderGlobal,settings:renderSettings,data:renderData};
  function visibleRouteSet(){return new Set(V46Navigation.visibleGroups(state.settings).flatMap(group=>group.pages.map(page=>page.id)));}
  function defaultDomainRoute(){return `${state.settings.activeDomain==='faction'?'faction':'company'}-candidates`;}
  // Re-render a page after async work only if the user is still on it; never navigate back to it.
  function refreshRoute(page){return state.page===page?route(page,false):Promise.resolve(false);}
  async function route(page,persist=true){
    ensureAppMounted();
    const requested=String(page||'').trim().toLowerCase();
    const previousPage=state.page;
    if(!V46Navigation.ROUTES.includes(requested)||(requested!=='settings'&&!visibleRouteSet().has(requested)))return false;
    if(requested===state.page&&persist){document.querySelector('.ra-shell')?.classList.remove('sidebar-open');return true;}
    state.page=requested;
    const seq=++state.routeSeq,stale=()=>seq!==state.routeSeq;
    if(requested!==previousPage&&state.settings.candidates?.playerCard?.rememberPanel===false){const drawer=document.getElementById('ra-drawer');if(drawer)drawer.hidden=true;state.drawerCandidateId='';state.playerCard={...state.playerCard,userId:'',pinned:false};}
    if(persist)await saveSettings({activePage:state.page});
    if(stale())return false;
    if(V46CompanyPlatform._test.IMPLEMENTED_ROUTES.has(state.page)){
      rebuildNav();
      await V46CompanyPlatform.renderPage(state.page,{persist:false});
      if(stale())return false;
      bindHelp();
      document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
      return;
    }
    if(V47FactionPlatform._test.IMPLEMENTED_ROUTES.has(state.page)){
      rebuildNav();
      await V47FactionPlatform.renderPage(state.page,{persist:false});
      if(stale())return false;
      bindHelp();
      document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
      return;
    }
    const renderer=renderers[state.page];if(!renderer)return false;const html=await renderer();
    if(stale())return false;
    const [title,description]=pageMeta(state.page);
    document.getElementById('ra-page-title').textContent=title;
    document.getElementById('ra-page-desc').textContent=description;
    const content=document.getElementById('ra-content');
    content.innerHTML=html;
    rebuildNav();bindPageControls();bindHelp();bindCandidateInteractions();
    document.querySelector('.ra-shell')?.classList.remove('sidebar-open');
  }

  async function saveCandidate(candidate){candidate.userId=String(candidate.userId);candidate.updatedAt=new Date().toISOString();await idb.put('candidateLocal',candidate);await repositories.company.ensure(candidate.userId,candidate,{source:'company-workflow',observedAt:Date.now(),skipShared:true});return candidate;}


  function contactStateFromStage(stage,outcomes=[]){if(Array.isArray(outcomes)&&outcomes.length)return 'Contacted';const value=text(stage).toLowerCase();return ['contacted','replied','hired','joined','invite ready','evaluating'].includes(value)?'Contacted':'Not yet';}
  function matchProfileRequirements(profile={}){
    const criteria=profile?.criteria||{},requirements={};
    for(const [key,target] of [['man','minMan'],['int','minInt'],['end','minEnd']]){
      const criterion=criteria[key];
      const value=criterion?.enabled===true?finite(criterion.target):null;
      if(value!==null&&value>0)requirements[target]=value;
    }
    return requirements;
  }
  async function openPlayerCard(domain,id,options={}){
    if(state.settings.candidates?.playerCard?.openOnName===false&&!options.force)return false;
    const normalizedDomain=text(domain).toLowerCase()==='faction'?'faction':'company';
    const userId=V46Domain.normalizeUserId(id);
    if(state.playerCard.pinned&&state.playerCard.userId&&state.playerCard.userId!==userId&&!options.force)return false;
    const [player,domainRecord,candidate,activeMatchProfile,factionConfig,factionProfiles]=await Promise.all([
      idb.get('playerIntelligence',userId),
      idb.get(normalizedDomain==='faction'?'factionRecruitment':'companyRecruitment',userId),
      idb.get('candidateLocal',userId),
      normalizedDomain==='company'?getActiveMatchProfile():Promise.resolve(null),
      normalizedDomain==='faction'?factionRepositories.config.get():Promise.resolve(null),
      normalizedDomain==='faction'?factionRepositories.profiles.list():Promise.resolve([])
    ]);
    const shared=player||{};
    const local=candidate||{};
    const record=domainRecord||{};
    const drawer=document.getElementById('ra-drawer');
    if(!drawer)return false;
    const name=text(shared.name)||text(local.name)||`User ${userId}`;
    const level=finite(shared.level);
    const age=finite(shared.age);
    const networth=finite(shared.networth);
    const xanax30=finite(shared.xanax30);
    const attacks30=finite(shared.attacks30);
    const rwHits30=finite(shared.rwHits30);
    const man=shared.man??local.stats?.man??local.man??null;
    const intStat=shared.int??local.stats?.int??local.int??null;
    const end=shared.end??local.stats?.end??local.end??null;
    const activity30=shared.activity30??null;
    const streak=shared.activestreak??shared.activeStreak??null;
    const scoutFit=shared.fit??null;
    const lastActive=shared.lastActive??null;
    const sources=[...new Set([...(Array.isArray(record.discoverySources)?record.discoverySources:[]),...(Array.isArray(local.discoverySources)?local.discoverySources:[]),text(local.sourceType)].filter(Boolean))];
    const stage=text(record.pipelineStage)||(normalizedDomain==='faction'?'Prospect':'Not Contacted');
    const company=text(shared.currentCompany)||'—';
    const faction=text(shared.currentFaction||shared.factionName)||((shared.factionId??null)!==null?`Faction #${shared.factionId}`:'—');
    const orgLabel=normalizedDomain==='company'?'Current Company':'Current Faction';
    const orgValue=normalizedDomain==='company'?company:faction;
    const statusLabel=normalizedDomain==='company'?'Company Status':'Faction Status';
    const fitLabel='Scout Fit';
    const lastText=finite(lastActive)===null?'—':lastActiveText({lastActive});
    const intelligenceRow={
      userId,name,level,age,man,int:intStat,end,networth,xanax30,attacks30,rwHits30,activity30,activeStreak:streak,fit:scoutFit,lastActive,
      currentCompany:shared.currentCompany,currentFaction:shared.currentFaction||shared.factionName,
      pipelineStage:stage,candidateLocal:local,playerRecord:shared,player:shared,
      companyRecord:normalizedDomain==='company'?record:undefined,
      factionRecord:normalizedDomain==='faction'?record:undefined
    };
    const activeFactionProfileId=normalizedDomain==='faction'?text(factionConfig?.activeResultsProfileId):'';
    const activeFactionProfile=activeFactionProfileId?(factionProfiles||[]).find(profile=>text(profile.profileId)===activeFactionProfileId):null;
    if(activeFactionProfile){
      const profileEvaluation=V47FactionCore.evaluateSpecialistProfile(activeFactionProfile,shared,Array.isArray(record.waivers)?record.waivers:[]);
      intelligenceRow.eligibilityScore=profileEvaluation.matchScore;intelligenceRow.eligibility=profileEvaluation.eligibility;
    }
    const recruitmentIntelligence=ResultsCore.recruitmentFit(intelligenceRow,{domain:normalizedDomain,useEligibility:normalizedDomain==='faction'?Boolean(activeFactionProfile):false,requirements:normalizedDomain==='company'?matchProfileRequirements(activeMatchProfile||{}):{}});
    const recruitmentFit=recruitmentIntelligence.score;
    const recruitmentConfidence=recruitmentIntelligence.confidence;
    const provenance=recruitmentIntelligence.provenance;
    const displayedObservedAt=shared.lastObservedAt??null;
    const factionIntelHtml=normalizedDomain==='faction'?`<div class="ra-detail-section"><b>Faction Intelligence</b><div class="ra-detail-grid"><span>Net Worth<b>${formatNumber(networth)}</b></span><span>Xanax 30d<b>${formatNumber(xanax30)}</b></span><span>Attacks 30d<b>${formatNumber(attacks30)}</b></span><span>RW Hits 30d<b>${formatNumber(rwHits30)}</b></span></div></div>`:'';
    const fitBreakdownHtml=recruitmentIntelligence.components.map(component=>`<div class="ra-detail-grid"><span>${esc(component.label)}<b>${component.known?`${Math.round(component.factor*100)}% · ${component.points.toFixed(1)} pts`:'Unknown'}</b></span><span>Why<b>${esc(component.reason||'—')}</b></span></div>`).join('');
    state.playerCard={domain:normalizedDomain,userId,pinned:state.playerCard.pinned,popout:state.playerCard.popout};
    state.drawerCandidateId=userId;
    drawer.classList.toggle('is-popout',state.playerCard.popout);
    drawer.innerHTML=`<div class="ra-drawer-head"><div class="ra-player-card-title"><div><div class="ra-player-card-domain">${esc(normalizedDomain)} player card</div><b>${esc(name)}</b><div class="ra-muted">Player ID ${esc(userId)} · ${esc(provenance.state)}</div></div>${finite(recruitmentFit)!==null?`<span class="ra-player-card-score" title="Explainable Recruitment Fit · ${esc(recruitmentConfidence)} confidence">${Number(recruitmentFit).toFixed(1)} · ${esc(recruitmentConfidence)}</span>`:''}</div><button class="ra-btn" id="ra-close-drawer">×</button></div><div class="ra-detail-section"><b>Player</b><div class="ra-detail-grid"><span>Level<b>${level===null?'—':formatNumber(level)}</b></span><span>Age<b>${formatNumber(age)}</b></span><span>Last Action<b>${esc(lastText)}</b></span><span>MAN<b>${formatNumber(man)}</b></span><span>INT<b>${formatNumber(intStat)}</b></span><span>END<b>${formatNumber(end)}</b></span><span>30d Activity<b>${formatNumber(activity30,1)}</b></span><span>Activity Streak<b>${formatNumber(streak)}</b></span><span>${fitLabel}<b>${scoreText(scoutFit)}</b></span></div></div><div class="ra-detail-section"><b>${statusLabel}</b><div class="ra-detail-grid"><span>${orgLabel}<b>${esc(orgValue)}</b></span><span>Recruitment Stage<b>${esc(stage)}</b></span><span>Contacted<b>${esc(contactStateFromStage(stage,record.outcomes))}</b></span><span>Availability<b>${esc(record.availability||'Unknown')}</b></span></div></div>${factionIntelHtml}<div class="ra-detail-section"><b>Recruitment Fit</b><div class="ra-detail-grid"><span>Score<b>${finite(recruitmentFit)===null?'—':Number(recruitmentFit).toFixed(1)}</b></span><span>Confidence<b>${esc(recruitmentConfidence)}</b></span><span>Profile<b>${normalizedDomain==='company'?esc(activeMatchProfile?.name||'No profile'):esc(activeFactionProfile?.name||'Faction default')}</b></span><span>Prospect State<b>${esc(provenance.state)}</b></span><span>Freshness<b>${esc(provenance.freshness)}</b></span></div>${fitBreakdownHtml}</div><div class="ra-detail-section"><b>Provenance</b><div class="ra-detail-grid"><span>Sources<b>${esc((provenance.sources||[]).join(' · ')||(normalizedDomain==='company'?sources.join(' · '):'')||'Unknown')}</b></span><span>First Discovered<b>${provenance.firstDiscoveredAt?esc(dateOrDash(provenance.firstDiscoveredAt)):'—'}</b></span><span>Last Observed<b>${displayedObservedAt?esc(dateOrDash(displayedObservedAt)):'—'}</b></span><span>Last Enriched<b>${provenance.lastEnrichedAt?esc(dateOrDash(provenance.lastEnrichedAt)):'—'}</b></span></div><div class="ra-note">Player Card reads existing browser-local intelligence. Opening it does not make a Torn API request. Scout Fit remains a separate activity metric.</div></div><div class="ra-player-card-actions"><button class="ra-btn ${record.doNotContact===true?'ra-danger':'ra-primary'}" id="ra-card-recruit" ${record.doNotContact===true?'disabled title="Do Not Contact is set for this recruitment domain"':''}>${record.doNotContact===true?'Do Not Contact':'Recruit'}</button><button class="ra-btn" id="ra-card-refresh">Refresh Intelligence</button><button class="ra-btn" id="ra-card-profile">Open Profile</button><button class="ra-btn" id="ra-card-popout">${state.playerCard.popout?'Dock':'Pop Out'}</button><button class="ra-btn" id="ra-card-pin">${state.playerCard.pinned?'Unpin':'Pin'}</button></div>`;
    drawer.hidden=false;
    const close=()=>{drawer.hidden=true;state.drawerCandidateId='';if(!state.playerCard.pinned)state.playerCard.userId='';};
    document.getElementById('ra-close-drawer').onclick=close;
    const recruitButton=document.getElementById('ra-card-recruit');if(record.doNotContact!==true)recruitButton.onclick=async()=>{try{const latest=await idb.get(normalizedDomain==='faction'?'factionRecruitment':'companyRecruitment',userId);if(latest?.doNotContact===true)throw new Error('Do Not Contact is set for this recruitment domain.');await recruitCandidate(normalizedDomain,userId,name);}catch(error){toast(error.message,true);}};
    const refreshButton=document.getElementById('ra-card-refresh');
    refreshButton.onclick=async()=>{
      try{refreshButton.disabled=true;refreshButton.textContent='Refreshing…';const previous=await idb.get('scoutLatest',Number(userId));await runScout([Number(userId)],true);const current=await idb.get('scoutLatest',Number(userId));if(!current||current.snapshotId===previous?.snapshotId)throw new Error('Intelligence refresh failed; previous intelligence retained.');await openPlayerCard(normalizedDomain,userId,{force:true});}
      catch(error){toast(error.message,true);}
      finally{if(refreshButton?.isConnected){refreshButton.disabled=false;refreshButton.textContent='Refresh Intelligence';}}
    };
    document.getElementById('ra-card-profile').onclick=()=>window.open(profileUrl(userId),'_blank','noopener');
    const popoutButton=document.getElementById('ra-card-popout');if(state.settings.candidates?.playerCard?.allowPopout===false){popoutButton.disabled=true;popoutButton.title='Enable Player Card pop-out in Settings';}else popoutButton.onclick=()=>{state.playerCard.popout=!state.playerCard.popout;openPlayerCard(normalizedDomain,userId,{force:true}).catch(error=>toast(error.message,true));};
    document.getElementById('ra-card-pin').onclick=()=>{state.playerCard.pinned=!state.playerCard.pinned;openPlayerCard(normalizedDomain,userId,{force:true}).catch(error=>toast(error.message,true));};
    return true;
  }
  function dateOrDash(value){const n=Number(value);if(Number.isFinite(n)&&n>0)return new Date(n).toLocaleString();const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toLocaleString():'—';}


  async function openAddCandidateModal(){showModal(`<h3>Add Candidate</h3><div class="ra-formgrid"><div class="ra-field"><label>Torn player ID</label><input id="ra-add-id" inputmode="numeric"></div><div class="ra-field"><label>Name (optional)</label><input id="ra-add-name"></div><div class="ra-field"><label>Desired company</label><input id="ra-add-company"></div><div class="ra-field"><label>Desired role</label><input id="ra-add-role"></div><div class="ra-field"><label>Expected salary</label><input id="ra-add-salary"></div><div class="ra-field"><label>Availability</label><select id="ra-add-availability"><option value="Unknown">Unknown</option><option value="Available">Available</option><option value="Unavailable">Unavailable</option></select></div><div class="ra-field" style="grid-column:1/-1"><label>Recruiter note</label><textarea id="ra-add-note"></textarea></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-add-save">Add Candidate</button><button class="ra-btn" data-modal-close>Cancel</button></div>`);document.getElementById('ra-add-save').onclick=async()=>{try{const id=text(document.getElementById('ra-add-id').value);const existing=await idb.get('candidateLocal',id);const record=Discovery.addCandidateRecord({userId:id,name:text(document.getElementById('ra-add-name').value),desiredCompany:text(document.getElementById('ra-add-company').value),desiredRole:text(document.getElementById('ra-add-role').value),expectedSalary:finite(document.getElementById('ra-add-salary').value),availability:document.getElementById('ra-add-availability').value,recruiterNote:text(document.getElementById('ra-add-note').value)},existing);await saveCandidate(record);closeModal();toast('Candidate added.');await route(state.page,false);}catch(error){toast(error.message,true);}};}

  function showModal(html){const modal=document.getElementById('ra-modal');modal.innerHTML=`<div class="ra-modal-card">${html}</div>`;modal.hidden=false;modal.querySelectorAll('[data-modal-close]').forEach(b=>b.onclick=closeModal);bindHelp();}
  function closeModal(){const modal=document.getElementById('ra-modal');if(modal){modal.hidden=true;modal.innerHTML='';}}

  function candidateCsvRow(v){return[v.userId,v.name,v.pipelineStage,v.matchScore??'',v.fitScore??'',v.lookingFor,v.sourceType,v.currentCompany,v.availability,v.man??'',v.int??'',v.end??'',v.ee??''];}
  function csvCell(value){let safe=String(value??'');if(/^\s*[=+\-@]/u.test(safe))safe=`'${safe}`;return `"${safe.replaceAll('"','""')}"`;}
  async function exportCsv(){const rows=await candidateViews();const header=['Player ID','Name','Stage','Match','Fit','Looking For','Source','Current Company','Availability','MAN','INT','END','EE'];const csv=[header,...rows.map(candidateCsvRow)].map(row=>row.map(csvCell).join(',')).join('\n');try{await navigator.clipboard.writeText(csv);toast(`Copied ${rows.length} candidate(s) as CSV.`);}catch{const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='recruitment-candidates.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}

  async function hardReset(){if(!confirm('NUKE IT ALL will permanently delete Recruitment Agency browser-local candidates, forum imports, Scout cache/history, Global cache/queue, Match Profiles, logs, messages/settings and layout. Torn account data and unrelated userscripts are not touched. Continue?'))return;const typed=text(prompt('Type NUKE to confirm the hard local reset:','')).toUpperCase();if(typed!=='NUKE'){toast('Hard reset cancelled.',true);return;}for(const store of STORE_NAMES)await idb.clear(store);state.settings=mergeSettings({});state.page='company-candidates';applyTheme();rebuildNav();closeModal();document.getElementById('ra-drawer').hidden=true;await route('company-candidates',false);toast('Recruitment Agency local data was reset.');}
  async function clearRecruitmentData(){for(const store of ['users','candidateLocal','companyRecruitment','factionRecruitment','companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions','forumSources','forumSyncState'])await idb.clear(store);return true;}
  async function clearRecruitment(){if(!confirm('Clear local Company/Faction recruitment and forum discovery data? Shared Scout/Player Intelligence will be kept.'))return;await clearRecruitmentData();toast('Recruitment/forum data cleared.');await logEvent('reset','Recruitment and forum data cleared');await route(state.page,false);}
  async function resetLayout(){await updateMeta(meta=>{meta.ui={windowGeometry:{}};});const app=document.getElementById('ra-app');Object.assign(app.style,{left:'6vw',top:'5vh',width:'88vw',height:'86vh'});toast('Layout reset.');}


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

  async function saveSettingsPage(){const optionalModules={...DEFAULT_OPTIONAL_MODULES};document.querySelectorAll('[data-optional-module]').forEach(el=>{optionalModules[el.dataset.optionalModule]=el.checked===true;});const availabilityColors={...state.settings.recruitment.availabilityColors};document.querySelectorAll('[data-availability-color]').forEach(el=>availabilityColors[el.dataset.availabilityColor]=el.value);const recruitment=Runtime.normalizeRecruitmentSettings({...state.settings.recruitment,companyThreadId:text(document.getElementById('ra-setting-company-thread')?.value),factionThreadId:text(document.getElementById('ra-setting-faction-thread')?.value),trainingThreadId:text(document.getElementById('ra-setting-training-thread')?.value),recentImportDays:number(document.getElementById('ra-setting-import-days')?.value,30),maxPagesPerFeed:number(document.getElementById('ra-setting-max-pages')?.value,20),candidateActiveAgeDays:number(document.getElementById('ra-setting-active-age')?.value,30),explicitTrainBuyersOnly:document.getElementById('ra-setting-train-explicit')?.value!=='false',defaultMessage:document.getElementById('ra-setting-default-message')?.value,companyType:text(document.getElementById('ra-setting-company-type')?.value),companyRecruitmentMessage:document.getElementById('ra-setting-company-message')?.value,factionName:text(document.getElementById('ra-setting-faction-name')?.value),factionRecruitmentMessage:document.getElementById('ra-setting-faction-message')?.value,availabilityColors});await saveSettings({theme:document.getElementById('ra-setting-theme')?.value||state.settings.theme,density:document.getElementById('ra-setting-density')?.value||state.settings.density,textSize:document.getElementById('ra-setting-text')?.value||state.settings.textSize,launcherEnabled:document.getElementById('ra-setting-launcher')?.value!=='false',sidebarCollapsed:document.getElementById('ra-setting-sidebar')?.value==='true',includeInactive:document.getElementById('ra-setting-inactive')?.value==='true',ownCompanyName:text(document.getElementById('ra-setting-own-company')?.value),optionalModules,recruitment,scout:{...state.settings.scout,rate:clampRate(document.getElementById('ra-setting-rate')?.value),workers:number(document.getElementById('ra-setting-workers')?.value,3),budget:number(document.getElementById('ra-setting-budget')?.value,900),historyGapMs:number(document.getElementById('ra-setting-history-gap')?.value,0)},candidates:{...state.settings.candidates,resultsLayout:document.getElementById('ra-setting-results-layout')?.value==='compact'?'compact':'expanded',playerCard:{...state.settings.candidates.playerCard,openOnName:document.getElementById('ra-setting-player-card-name')?.value!=='false',allowPopout:document.getElementById('ra-setting-player-card-popout')?.value!=='false',rememberPanel:document.getElementById('ra-setting-player-card-remember')?.value!=='false'}},global:{...state.settings.global,enabled:document.getElementById('ra-setting-global-enabled')?.value!=='false',endpoint:text(document.getElementById('ra-setting-global-endpoint')?.value)}});applyTheme();syncLauncherVisibility();await refreshRoute('settings');toast('Settings saved.');await logEvent('settings','Settings saved',{complexity:state.settings.complexity,theme:state.settings.theme});}

  function bindPageControls(){
    document.getElementById('ra-sync')?.addEventListener('click',()=>syncForums().catch(e=>toast(e.message,true)));document.getElementById('ra-add-candidate')?.addEventListener('click',openAddCandidateModal);document.getElementById('ra-fill-companies')?.addEventListener('click',()=>fillCompanies().catch(e=>toast(e.message,true)));document.getElementById('ra-cancel-work')?.addEventListener('click',()=>{cancelSync();cancelFill();});document.getElementById('ra-discover-menu')?.addEventListener('click',()=>{const x=document.getElementById('ra-discover-more');if(x)x.hidden=!x.hidden;});document.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>{const feed=Discovery.feedDefinitions(state.settings.recruitment).find(f=>f.feedId===b.dataset.openThread);if(feed?.threadId)window.open(forumThreadUrl(feed.threadId),'_blank','noopener');});document.getElementById('ra-reset-forum')?.addEventListener('click',async()=>{if(!confirm('Reset local forum import sources and checkpoints? Candidate recruiter data is preserved.'))return;await idb.clear('forumSources');await idb.clear('forumSyncState');toast('Forum import reset.');await refreshRoute('company-discover');});document.getElementById('ra-refresh-discover')?.addEventListener('click',()=>route('company-discover',false));
    
    
    document.getElementById('ra-run-scout')?.addEventListener('click',()=>{const ids=ScoutCore.parseIds(document.getElementById('ra-scout-ids')?.value||'',state.settings.scout.maxCandidates);runScout(ids,true).catch(e=>toast(e.message,true));});document.getElementById('ra-pause-scout')?.addEventListener('click',pauseScout);document.getElementById('ra-cancel-scout')?.addEventListener('click',cancelScout);
    document.getElementById('ra-match-profile-select')?.addEventListener('change',async e=>{await saveSettings({match:{...state.settings.match,activeProfileId:e.target.value}});await refreshRoute('smart-match');});document.getElementById('ra-match-new')?.addEventListener('click',async()=>{const p=await saveMatchProfile(MatchCore.createDefaultProfile('New Match Profile'));await saveSettings({match:{...state.settings.match,activeProfileId:p.profileId}});await refreshRoute('smart-match');});document.getElementById('ra-match-duplicate')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile(true);const p=MatchCore.normalizeProfile({...active,profileId:'',name:`${active.name} Copy`,createdAt:'',updatedAt:''});const saved=await saveMatchProfile(p);await saveSettings({match:{...state.settings.match,activeProfileId:saved.profileId}});await refreshRoute('smart-match');});document.getElementById('ra-match-delete')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile(true);if(!confirm(`Delete Match Profile "${active.name}"?`))return;await idb.delete('matchProfiles',active.profileId);await saveSettings({match:{...state.settings.match,activeProfileId:''}});await ensureDefaultMatchProfile();await refreshRoute('smart-match');});document.getElementById('ra-match-save')?.addEventListener('click',async()=>{const active=await getActiveMatchProfile(true);const criteria={};for(const key of MatchCore.CRITERIA_KEYS){const old=active.criteria[key];const enabled=!!document.querySelector(`[data-match-enabled="${key}"]`)?.checked;const weight=number(document.querySelector(`[data-match-weight="${key}"]`)?.value,old.weight);if(['company','role','availability'].includes(key))criteria[key]={enabled,weight,value:text(document.querySelector(`[data-match-value="${key}"]`)?.value)};else if(key==='salary')criteria[key]={enabled,weight,max:number(document.querySelector('[data-match-max="salary"]')?.value,old.max)};else criteria[key]={enabled,weight,target:number(document.querySelector(`[data-match-target="${key}"]`)?.value,old.target)};}const saved=await saveMatchProfile({profileId:active.profileId,name:text(document.getElementById('ra-match-name')?.value)||active.name,criteria,createdAt:active.createdAt,searchFilters:active.searchFilters,searchFiltersCustom:active.searchFiltersCustom});await saveSettings({match:{...state.settings.match,activeProfileId:saved.profileId}});toast('Match Profile saved.');await refreshRoute('smart-match');});
    document.getElementById('ra-global-test')?.addEventListener('click',()=>testGlobalService().then(()=>toast('Global service connected.')).catch(e=>toast(e.message,true)));document.getElementById('ra-global-retry')?.addEventListener('click',()=>flushGlobalQueue(true).then(r=>toast(`Global sync processed ${r.processed}; ${r.pending} pending.`)).catch(e=>toast(e.message,true)));
    document.getElementById('ra-save-settings')?.addEventListener('click',()=>saveSettingsPage().catch(e=>toast(e.message,true)));document.getElementById('ra-set-key')?.addEventListener('click',()=>ensureApiKey(true).then(()=>{toast('API key saved.');const status=document.getElementById('ra-api-key-status');if(status)status.textContent='Saved on this device.';}).catch(e=>toast(e.message,true)));document.getElementById('ra-cache-diagnostic')?.addEventListener('click',()=>runCacheDiagnostic().catch(e=>toast(e.message,true)));document.getElementById('ra-reset-colors')?.addEventListener('click',async()=>{await saveSettings({recruitment:{...state.settings.recruitment,stageColors:{...Runtime.STAGE_COLORS},availabilityColors:{...Runtime.AVAILABILITY_COLORS}}});await refreshRoute('settings');});document.getElementById('ra-reset-layout')?.addEventListener('click',resetLayout);document.getElementById('ra-reset-layout-2')?.addEventListener('click',resetLayout);document.getElementById('ra-clear-scout')?.addEventListener('click',async()=>{if(!confirm('Clear local Scout cache and history?'))return;await idb.clear('scoutLatest');await idb.clear('scoutHistory');toast('Scout cache cleared.');});document.getElementById('ra-clear-recruitment')?.addEventListener('click',clearRecruitment);document.getElementById('ra-nuke')?.addEventListener('click',()=>hardReset().catch(e=>toast(e.message,true)));document.querySelectorAll('[data-go-page]').forEach(b=>b.onclick=()=>route(b.dataset.goPage));document.getElementById('ra-setting-global-test')?.addEventListener('click',()=>testGlobalService().then(()=>toast('Global service connected.')).catch(e=>toast(e.message,true)));document.getElementById('ra-setting-global-retry')?.addEventListener('click',()=>flushGlobalQueue(true).then(()=>toast('Global queue retried.')).catch(e=>toast(e.message,true)));
    document.getElementById('ra-export-csv')?.addEventListener('click',exportCsv);document.getElementById('ra-data-clear-candidates')?.addEventListener('click',clearRecruitment);
    const setVal=(id,value)=>{const el=document.getElementById(id);if(el)el.value=String(value);};setVal('ra-setting-theme',state.settings.theme);setVal('ra-setting-density',state.settings.density);setVal('ra-setting-text',state.settings.textSize);setVal('ra-setting-launcher',state.settings.launcherEnabled);setVal('ra-setting-sidebar',state.settings.sidebarCollapsed);setVal('ra-setting-inactive',state.settings.includeInactive);setVal('ra-setting-train-explicit',state.settings.recruitment.explicitTrainBuyersOnly);setVal('ra-setting-results-layout',state.settings.candidates.resultsLayout);setVal('ra-setting-candidate-density',state.settings.density);setVal('ra-setting-player-card-name',state.settings.candidates.playerCard.openOnName);setVal('ra-setting-player-card-popout',state.settings.candidates.playerCard.allowPopout);setVal('ra-setting-player-card-remember',state.settings.candidates.playerCard.rememberPanel);setVal('ra-setting-global-enabled',state.settings.global.enabled);
  }


  function bindCandidateInteractions(){document.querySelectorAll('[data-detail]').forEach(el=>{el.onclick=e=>{e.preventDefault();openPlayerCard(el.dataset.detailDomain==='faction'?'faction':'company',el.dataset.detail);};});}

  function bindHelp(){document.querySelectorAll('.ra-help').forEach(button=>{button.onpointerenter=()=>{if(!state.help.pinned)openHelp(button,false);};button.onpointerleave=()=>{if(!state.help.pinned)closeHelp();};button.onfocus=()=>{if(!state.help.pinned)openHelp(button,false);};button.onblur=()=>{if(!state.help.pinned)closeHelp();};button.onclick=e=>{e.preventDefault();e.stopPropagation();if(state.help.pinned&&state.help.anchor===button)closeHelp(true);else openHelp(button,true);};});}
  function openHelp(button,pinned){const item=Runtime.HELP_REGISTRY[button.dataset.helpKey];const pop=document.getElementById('ra-help-popover');if(!item||!pop)return;state.help={pinned:!!pinned,anchor:button};pop.innerHTML=`<b>${esc(item.title)}</b><p>${esc(item.body)}</p>`;pop.hidden=false;positionHelp(button);}
  function positionHelp(button){const pop=document.getElementById('ra-help-popover');if(!pop||pop.hidden)return;const r=button.getBoundingClientRect(),margin=8,width=Math.min(340,pop.offsetWidth||300),height=Math.max(80,pop.offsetHeight||120);let left=r.right+6,top=r.top;if(left+width>innerWidth-margin)left=r.left-width-6;if(left<margin)left=Math.max(margin,Math.min(r.left,innerWidth-width-margin));if(top+height>innerHeight-margin)top=Math.max(margin,innerHeight-height-margin);pop.style.left=`${left}px`;pop.style.top=`${top}px`;}
  function closeHelp(force=false){if(state.help.pinned&&!force)return;const pop=document.getElementById('ra-help-popover');if(pop)pop.hidden=true;state.help={pinned:false,anchor:null};}

  function refreshScoutRuntimeUi(){const status=document.getElementById('ra-scout-status');if(status)status.textContent=state.scout.status;const p=document.getElementById('ra-scout-progress');if(p)p.style.width=`${state.scout.total?Math.min(100,state.scout.done/state.scout.total*100):0}%`;}
  function refreshDiscoverRuntimeUi(counters={},feed={}){const t=document.getElementById('ra-discover-progress-text');if(t)t.textContent=state.fill.running?`Company lookups ${state.fill.done}/${state.fill.total}${state.fill.errors.length?` · ${state.fill.errors.length} errors`:''}`:state.sync.running?`${feed.label||state.sync.feed} · pages ${number(counters.pagesChecked)} · posts ${number(counters.postsExamined)} · recent ${number(counters.recentPosts)} · created ${number(counters.candidatesCreated)} · updated ${number(counters.candidatesUpdated)} · train buyers ${number(counters.explicitTrainBuyers)}`:'Idle';const p=document.getElementById('ra-discover-progress');if(p)p.style.width=state.fill.running&&state.fill.total?`${state.fill.done/state.fill.total*100}%`:state.sync.running?'65%':'0%';}

  async function saveGeometry(){const app=document.getElementById('ra-app');if(!app)return;const r=app.getBoundingClientRect();await updateMeta(meta=>{meta.ui=meta.ui||{};meta.ui.windowGeometry=meta.ui.windowGeometry||{};meta.ui.windowGeometry.main={x:r.left,y:r.top,width:r.width,height:r.height};});}
  async function restoreGeometry(){const app=document.getElementById('ra-app');const meta=await getMeta();const g=meta.ui?.windowGeometry?.main;if(!app||!g)return;const minW=Math.min(560,innerWidth-8),minH=Math.min(420,innerHeight-8);app.style.left=`${Math.max(4,Math.min(number(g.x,20),innerWidth-48))}px`;app.style.top=`${Math.max(4,Math.min(number(g.y,50),innerHeight-48))}px`;app.style.width=`${Math.max(minW,Math.min(number(g.width,900),innerWidth-8))}px`;app.style.height=`${Math.max(minH,Math.min(number(g.height,650),innerHeight-8))}px`;}
  function bindWindow(){const app=document.getElementById('ra-app'),handle=document.getElementById('ra-titlebar');let dragging=false,dx=0,dy=0;handle.onpointerdown=e=>{if(e.target.closest('button,select,input,label'))return;dragging=true;const r=app.getBoundingClientRect();dx=e.clientX-r.left;dy=e.clientY-r.top;state.topZ++;app.style.zIndex=state.topZ;handle.setPointerCapture?.(e.pointerId);e.preventDefault();};handle.onpointermove=e=>{if(!dragging)return;app.style.left=`${Math.max(4,Math.min(e.clientX-dx,innerWidth-48))}px`;app.style.top=`${Math.max(4,Math.min(e.clientY-dy,innerHeight-48))}px`;};handle.onpointerup=e=>{if(!dragging)return;dragging=false;try{handle.releasePointerCapture(e.pointerId);}catch{}saveGeometry().catch(()=>{});};const ro=new ResizeObserver(()=>{clearTimeout(state.resizeTimer);state.resizeTimer=setTimeout(()=>saveGeometry().catch(()=>{}),250);});ro.observe(app);}
  function appVisible(){const app=document.getElementById('ra-app');return !!app&&app.style.display==='block';}
  // The app shell, overlays and the app stylesheet are built on first open (or first route), never while the panel was only installed.
  function ensureAppMounted(){if(document.getElementById('ra-app')||!state.mounted)return false;window.dispatchEvent(new window.CustomEvent('ra:app-mounting'));mount();V46CompanyPlatform.install(companyPlatformApp,{renderInitial:false});V47FactionPlatform.install(companyPlatformApp,{renderInitial:false});window.dispatchEvent(new window.CustomEvent('ra:app-mounted'));return true;}
  function openApp(){const first=ensureAppMounted();const app=document.getElementById('ra-app');if(!app)return Promise.resolve();app.style.display='block';state.topZ++;app.style.zIndex=state.topZ;syncLauncherVisibility();let ready=Promise.resolve();if(first)ready=route(state.page,false).catch(error=>toast(error.message,true));if(!state.globalFlushStarted){state.globalFlushStarted=true;if(state.settings.global.enabled&&globalEndpoint())void flushGlobalQueue(false);}return ready;}
  // Closing the window also closes every body-level RA layer (help, hover, context menu) so nothing invisible keeps intercepting Torn clicks.
  function closeApp(){closeHelp(true);const menu=document.getElementById('ra-workspace-menu');if(menu)menu.hidden=true;document.querySelector('.ra-shell')?.classList.remove('sidebar-open');const app=document.getElementById('ra-app');if(app)app.style.display='none';syncLauncherVisibility();}
  function toggleApp(){if(appVisible())closeApp();else openApp();}

  // Voidsmith dock contract v1 (docs/voidsmith-dock.md): one row per script as a direct child of Torn's sidebar, ordered by
  // data-voidsmith-dock-priority (ReviveRelay's #reviverelay-lite-root = 10, RA = 20). Idempotent: RA only ever moves itself.
  const DOCK_PRIO=20,DOCK_ID='recruitment-agency';let dockHost=null,dockObserver=null,dockWatched,dockQueued=false;
  function findTornSidebar(){for(const sel of ['#sidebar','#sidebarroot','nav[aria-label="Primary"]','nav[aria-label="Main"]','[role="navigation"][class*="sidebar"]','[class*="sidebar"] nav']){const node=document.querySelector(sel);if(node)return node;}return null;}
  // null = native Torn block; ties order by dock id so two entries can never trade places forever.
  function dockRank(node){if(node.id==='reviverelay-lite-root')return -1;const id=node.getAttribute('data-voidsmith-dock');if(id===null)return null;const p=Number(node.getAttribute('data-voidsmith-dock-priority')),n=Number.isFinite(p)?p:1000;return n<DOCK_PRIO||n===DOCK_PRIO&&id<DOCK_ID?-1:1;}
  function createDockHost(){document.querySelectorAll(`[data-voidsmith-dock="${DOCK_ID}"]`).forEach(node=>node.remove());const host=document.createElement('div');host.id=`voidsmith-dock-${DOCK_ID}`;host.setAttribute('data-voidsmith-dock',DOCK_ID);host.setAttribute('data-voidsmith-dock-priority',String(DOCK_PRIO));host.attachShadow({mode:'open'}).innerHTML=`<style>:host{all:initial;display:block;margin:4px 0;font:700 12px/1 Arial,sans-serif;color:#333;--b:#ccc;--bg:#f2f2f2;--a:#a4161a}:host([data-theme=dark]){color:#ddd;--b:#444;--bg:#2e2e2e;--a:#fa6a6f}button{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;box-sizing:border-box;padding:0 8px;border:1px solid var(--b);border-radius:5px;background:var(--bg);color:inherit;font:inherit;text-align:left;cursor:pointer}button:hover{opacity:.85}button:focus-visible{outline:2px solid var(--a);outline-offset:1px}button[aria-expanded=true]{border-color:var(--a)}i{display:inline-flex;color:var(--a)}span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><button type="button" aria-expanded="false" aria-label="Recruitment Agency" title="Recruitment Agency"><i>${LAUNCHER_ICON(16)}</i><span>Recruitment Agency</span></button>`;host.shadowRoot.querySelector('button').onclick=e=>{e.stopPropagation();toggleApp();};return host;}
  function ensureSidebarLauncher(){const sidebar=findTornSidebar();if(sidebar){const host=dockHost||=createDockHost(),kids=[...sidebar.children].filter(node=>node!==host);let lower=-1,higher=-1;kids.forEach((node,i)=>{const r=dockRank(node);if(r<0)lower=i;else if(r>0&&higher<0)higher=i;});const natives=kids.filter(node=>dockRank(node)===null),ref=lower>=0?kids[lower+1]||null:higher>=0?kids[higher]:natives[1]||natives[0]||null;if(host.parentNode!==sidebar||host.nextElementSibling!==ref)sidebar.insertBefore(host,ref);const body=document.body.classList,theme=body.contains('dark-mode')?'dark':body.contains('light-mode')?'light':matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(host.dataset.theme!==theme)host.dataset.theme=theme;}watchDock(sidebar);return !!sidebar;}
  // Re-attach after Torn re-renders: childList only on the sidebar and its parent, one placement per microtask, no timers.
  // Without any sidebar the throttled body/header watcher below retries, so no document-wide subtree observer is needed.
  function watchDock(sidebar){if(dockWatched===sidebar||typeof MutationObserver!=='function')return;dockObserver?.disconnect();dockWatched=sidebar;if(!sidebar)return;dockObserver=new MutationObserver(()=>{if(dockQueued)return;dockQueued=true;queueMicrotask(()=>{dockQueued=false;ensureSidebarLauncher();syncLauncherVisibility();});});dockObserver.observe(sidebar,{childList:true});if(sidebar.parentNode)dockObserver.observe(sidebar.parentNode,{childList:true});}
  const LAUNCHER_ICON=size=>`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 19c.6-3.2 2.4-5 5-5s4.4 1.8 5 5M11 19c.5-2.7 2.2-4.5 5-4.5 2.5 0 4.2 1.6 5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  // Torn header status icons (desktop and mobile). Only a status bar that is actually rendered qualifies.
  function visibleStatusBar(){for(const bar of document.querySelectorAll('ul[class*="status-icons"],ul[class*="statusIcons"]')){let shown=true;for(let node=bar;node&&node.nodeType===1;node=node.parentElement){const cs=getComputedStyle(node);if(cs.display==='none'||cs.visibility==='hidden'){shown=false;break;}}if(shown)return bar;}return null;}
  function ensureHeaderLauncher(){const bar=visibleStatusBar();let item=document.getElementById('ra-status-launcher');if(!bar){item?.remove();return false;}if(!item){item=document.createElement('li');item.id='ra-status-launcher';item.style.cssText='list-style:none;display:inline-flex;align-items:center;margin:0 2px;padding:0';const button=document.createElement('button');button.type='button';button.title='Recruitment Agency';button.setAttribute('aria-label','Open Recruitment Agency');button.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:20px;height:18px;padding:0;border:0;background:transparent;color:#c08cff;cursor:pointer';button.innerHTML=LAUNCHER_ICON(17);button.onclick=toggleApp;item.appendChild(button);}if(item.parentElement!==bar)bar.prepend(item);return true;}
  function ensureTornLauncher(){const header=ensureHeaderLauncher();const dock=ensureSidebarLauncher();syncLauncherVisibility();return header||dock;}
  // Torn-hosted entries (header icon, sidebar entry) always stay so the app can never become unreachable;
  // the launcher setting only controls the floating fallback, which appears only when no Torn entry is rendered and the app is closed.
  function syncLauncherVisibility(){const fallback=document.getElementById('ra-launch'),header=document.getElementById('ra-status-launcher'),dock=dockHost,open=appVisible();for(const button of [header?.querySelector('button'),dock?.shadowRoot.querySelector('button'),fallback])button?.setAttribute('aria-expanded',String(open));const hosted=[header,dock].some(node=>node?.isConnected&&node.getClientRects().length>0);if(fallback)fallback.style.display=state.settings?.launcherEnabled!==false&&!hosted&&!open?'block':'none';}
  let launcherCheckTimer=0;
  function scheduleLauncherCheck(){if(launcherCheckTimer)return;launcherCheckTimer=setTimeout(()=>{launcherCheckTimer=0;ensureTornLauncher();watchLauncherHosts();},300);}
  let launcherObserver=null;
  function watchLauncherHosts(){if(typeof MutationObserver!=='function'||!document.body)return;launcherObserver?.disconnect();launcherObserver=new MutationObserver(scheduleLauncherCheck);launcherObserver.observe(document.body,{childList:true});const header=document.getElementById('ra-status-launcher')?.closest('#header-root,header')||document.getElementById('ra-status-launcher')?.parentElement?.parentElement||document.getElementById('header-root');if(header&&header!==document.body&&header!==document.documentElement)launcherObserver.observe(header,{childList:true,subtree:true});}

  function mountLauncher(){if(!document.getElementById('ra-launch-css')){const style=document.createElement('style');style.id='ra-launch-css';style.textContent=`#ra-launch{font:12px/1.4 Arial,sans-serif;box-sizing:border-box;position:fixed;left:0;top:42%;z-index:2147483400;width:22px;height:44px;padding:0;font-size:9px;letter-spacing:.04em;writing-mode:vertical-rl;opacity:.82;border-radius:0 9px 9px 0;border:1px solid #5a3b73;border-left:0;background:radial-gradient(circle at 35% 20%,#9b4dff30,transparent 45%),linear-gradient(145deg,#1b1425,#0d0a12);color:#d06cff;font-weight:900;cursor:pointer;display:none;box-shadow:0 10px 30px #0008,0 0 22px #9b4dff18,inset 0 1px 0 #ffffff0b}`;document.head.appendChild(style);}if(document.getElementById('ra-launch'))return;const fallback=document.createElement('button');fallback.id='ra-launch';fallback.type='button';fallback.textContent='RA';fallback.title='Recruitment Agency';fallback.setAttribute('aria-label','Open Recruitment Agency');fallback.onclick=toggleApp;document.body.appendChild(fallback);}
  function mount(){injectStyles();const app=document.createElement('div');app.id='ra-app';app.innerHTML=`<div class="ra-titlebar" id="ra-titlebar"><div class="ra-title-brand"><span class="ra-title-mark" aria-hidden="true">◆</span><div class="ra-title-copy"><small>VOIDSMITH INDUSTRIES</small><strong>RECRUITMENT AGENCY <span class="ra-version">v${SCRIPT_VERSION}</span></strong></div></div>${workspaceSelectHtml()}<div class="ra-title-spacer" aria-hidden="true"></div><div class="ra-title-actions"><button class="ra-btn" id="ra-settings-button" title="Settings" aria-label="Settings">⚙</button><button class="ra-btn" id="ra-mobile-menu" aria-label="Menu">☰</button><button class="ra-btn" id="ra-close" aria-label="Close">×</button></div></div><div class="ra-shell"><aside class="ra-sidebar"><div class="ra-sidebar-head"><span class="ra-brand">RECRUITMENT</span><button class="ra-btn" id="ra-collapse" aria-label="Collapse navigation">≡</button></div><div id="ra-nav"></div></aside><main class="ra-main"><header class="ra-pagehead"><div><h2 id="ra-page-title">Search & Results</h2><p id="ra-page-desc"></p></div><div id="ra-page-actions"></div></header><div class="ra-content" id="ra-content"></div><aside id="ra-drawer" class="ra-drawer" hidden></aside><div id="ra-modal" class="ra-modal" hidden></div></main></div>`;document.body.appendChild(app);const help=document.createElement('div');help.id='ra-help-popover';help.className='ra-help-popover';help.hidden=true;help.setAttribute('role','dialog');document.body.appendChild(help);document.getElementById('ra-close').onclick=closeApp;document.getElementById('ra-settings-button').onclick=()=>route('settings');const workspaceToggle=document.getElementById('ra-workspace-toggle'),workspaceMenu=document.getElementById('ra-workspace-menu');workspaceToggle.onclick=()=>{const opening=workspaceMenu.hidden;workspaceMenu.hidden=!opening;workspaceToggle.setAttribute('aria-expanded',String(opening));};document.querySelectorAll('[data-workspace-domain]').forEach(button=>button.onclick=async()=>{const domain=button.dataset.workspaceDomain==='faction'?'faction':'company';workspaceMenu.hidden=true;workspaceToggle.setAttribute('aria-expanded','false');const from=state.page;await saveSettings({activeDomain:domain,activePage:`${domain}-candidates`});if(state.page!==from){rebuildNav();return;}const drawer=document.getElementById('ra-drawer');if(drawer){drawer.hidden=true;state.drawerCandidateId='';state.playerCard.userId='';}await route(`${domain}-candidates`,false);});document.getElementById('ra-collapse').onclick=async()=>{await saveSettings({sidebarCollapsed:!state.settings.sidebarCollapsed});rebuildNav();};document.getElementById('ra-mobile-menu').onclick=()=>document.querySelector('.ra-shell')?.classList.toggle('sidebar-open');document.addEventListener('keydown',e=>{if(e.key==='Escape'){const layered=['ra-help-popover','ra-modal','ra-drawer','ra-workspace-menu'].some(id=>{const el=document.getElementById(id);return el&&!el.hidden;})||!!document.querySelector('.ra-shell.sidebar-open'),target=e.target,tornField=!!target?.closest&&!target.closest('#ra-app')&&!!target.matches?.('input,textarea,select,[contenteditable],[contenteditable] *');if(appVisible()&&!layered&&!tornField){closeApp();return;}closeHelp(true);closeModal();document.querySelector('.ra-shell')?.classList.remove('sidebar-open');const drawer=document.getElementById('ra-drawer');if(drawer&&!drawer.hidden){drawer.hidden=true;state.drawerCandidateId='';}}});bindWindow();rebuildNav();restoreGeometry().catch(()=>{});}

  async function start(options={}){
    if(state.mounted)return;
    state.db=options.db||await openDB(options.indexedDB);
    state.settings=mergeSettings((await getMeta()).settings||{});
    state.page=V46Navigation.normalizeRoute(state.settings.activePage);
    // A saved page that no longer exists (removed workflow pages) or is hidden reopens that workspace's Search & Results.
    if(state.page!==state.settings.activePage||!visibleRouteSet().has(state.page))state.page=defaultDomainRoute();
    const meta=await getMeta();meta.settings=state.settings;meta.ui=meta.ui||{windowGeometry:{}};await idb.put('meta',meta);
    await repositories.backfillLegacy(Date.now());await ensureDefaultMatchProfile();
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    applyTheme();mountLauncher();state.mounted=true;
    ensureTornLauncher();
    void restorePendingPrivateChatDraft().catch(error=>toast(error.message,true));
    // Torn re-renders its header/sidebar: watch only those hosts (plus body children), throttled; no document-wide observer, no polling.
    watchLauncherHosts();
    for(const type of ['resize','popstate','hashchange'])window.addEventListener(type,scheduleLauncherCheck);
    await logEvent('startup',`Recruitment Agency v${SCRIPT_VERSION} source started`,{version:SCRIPT_VERSION,dbVersion:DB_VERSION});
    return true;
  }

  return Object.freeze({SCRIPT_VERSION,DB_VERSION,HARD_API_RATE,MIN_API_GAP_MS,DEFAULT_VISIBLE_COLUMNS,openDB,mergeSettings,start,_test:{navigate:route,openApp,state,repositories,companyRepositories,factionRepositories,activeDomain,navHtml,workspaceSelectHtml,openPlayerCard,lastActiveText,recruitmentDomainForFeed,persistDiscoveredCandidate,getDiscoveryCandidate,syncDomainForums,normalizeApiSearchCandidate,persistApiSearchCandidate,searchCandidates,normalizeWorkstatHofCandidate,persistWorkstatHofCandidate,discoverWorkstatProspects,matchProfileRequirements,clearRecruitmentData,candidateCsvRow,csvCell,getActiveMatchProfile,matchAvailability,forumThreadUrl,recruitCandidate,restorePendingPrivateChatDraft,findPrivateChatInput,setPrivateChatInputValue,currentProfileUserId}});
});

/* userscript bootstrap */
(() => {
  'use strict';
  const INSTALLER_VERSION = '4.8.4';
  const EXPECTED_APP_VERSION = '4.8.3';
  const DOM_GUARD = 'data-r4g3-ra-v45-owner';
  const RA_ROOT_SELECTOR = '#ra-app,#ra-help-popover';
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

  // The app shell is built lazily on first open; guard its ResizeObserver and enhance it at that moment.
  let restoreResizeObserver = () => {};
  window.addEventListener('ra:app-mounting', () => { restoreResizeObserver = installShellResizeGuard(); });
  window.addEventListener('ra:app-mounted', () => {
    restoreResizeObserver();
    try {
      enhanceShellUi(app);
    } catch (error) {
      console.error(`[RA] ${INSTALLER_VERSION} shell enhancement failed.`, error);
      try { alert(`Recruitment Agency could not start: ${error?.message || error}`); } catch {}
    }
  });
  app.start().catch(error => {
    restoreResizeObserver();
    clearDomGuard();
    console.error(`[RA] ${INSTALLER_VERSION} failed to start.`, error);
    alert(`Recruitment Agency could not start: ${error?.message || error}`);
  });
})();
