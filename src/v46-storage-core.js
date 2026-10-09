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
      const next = Domain.normalizeCompanyRecruitment(input,observedAt,{ambiguous:options.ambiguous === true,assumed:options.assumed === true});
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
      const next = Domain.normalizeFactionRecruitment(input,observedAt,{ambiguous:options.ambiguous === true});
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
        factionId:profile.factionId,
        factionName:profile.factionName,
        networth:snapshot.extra?.networth,
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