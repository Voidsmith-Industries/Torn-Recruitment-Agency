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
