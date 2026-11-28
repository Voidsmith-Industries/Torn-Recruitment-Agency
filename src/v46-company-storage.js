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
