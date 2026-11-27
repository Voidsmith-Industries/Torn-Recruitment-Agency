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
