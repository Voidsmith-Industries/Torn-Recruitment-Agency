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
      activeResultsProfileId:text(raw.activeResultsProfileId),
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
