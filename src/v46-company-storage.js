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
