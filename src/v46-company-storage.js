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
