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
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);

  function text(value){return String(value??'').trim();}
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
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




  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus);if(status.toLowerCase()==='online')return '<span class="ra-online-live">Online</span>';if(status.toLowerCase()==='idle')return '<span class="ra-online-idle">Idle</span>';if(status.toLowerCase()==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function sortHeader(key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-company-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  function recruitmentFitCell(row={}){if(row.recruitmentFit===null||row.recruitmentFit===undefined||text(row.recruitmentFit)==='')return '<span class="ra-muted">—</span>';const value=Number(row.recruitmentFit);if(!Number.isFinite(value))return '<span class="ra-muted">—</span>';const confidence=text(row.recruitmentConfidence)||'Low';return `<span title="Recruitment Fit · ${esc(confidence)} confidence"><b>${value.toFixed(1)}</b><small class="ra-muted"> ${esc(confidence)}</small></span>`;}
  function provenanceCell(row={}){const p=row.prospectProvenance||{};const source=Array.isArray(p.sources)&&p.sources.length?p.sources[0]:'Unknown';const state=text(row.prospectState)||text(p.state)||'Known Candidate';return `<span title="${esc(state)}"><b>${esc(source)}</b><small class="ra-muted"> · ${esc(state)}</small></span>`;}
  function contactedLabel(row={}){if(Array.isArray(row.outcomes)&&row.outcomes.length)return 'Contacted';const stage=text(row.pipelineStage).toLowerCase();return ['contacted','replied','hired'].includes(stage)?'Contacted':'Not yet';}
  function renderCandidates(rows=[],options={}){
    const filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'},layout=options.layout==='compact'?'compact':'expanded';const total=Number.isFinite(Number(options.total))?Number(options.total):(Array.isArray(rows)?rows:[]).length;
    const profiles=Array.isArray(options.profiles)?options.profiles:[],activeProfileId=text(options.activeProfileId);
    const pagination=options.pagination||{page:0,pageCount:1,start:0,end:(Array.isArray(rows)?rows:[]).length};const filteredTotal=Number.isFinite(Number(options.filteredTotal))?Number(options.filteredTotal):(Array.isArray(rows)?rows:[]).length;
    const rangeText=filteredTotal?`${Number(pagination.start||0)+1}-${Number(pagination.end||0)}`:'0';
    const pager=`<div class="ra-actions"><button type="button" class="ra-btn" data-results-page="prev" ${Number(pagination.page||0)<=0?'disabled':''}>Previous</button><span class="ra-muted">${rangeText} of ${filteredTotal}</span><button type="button" class="ra-btn" data-results-page="next" ${Number(pagination.page||0)>=Number(pagination.pageCount||1)-1?'disabled':''}>Next</button></div>`;
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${text(profile.profileId)===activeProfileId?'selected':''}>${esc(profile.name)}</option>`).join('');
    const profileBar=`<div class="ra-actions ra-profile-bar"><label class="ra-muted" for="ra-company-profile-select">Recruitment profile</label><select id="ra-company-profile-select" class="ra-btn">${profileOptions}</select><button type="button" class="ra-btn" id="ra-company-profile-apply" ${profiles.length?'':'disabled'}>Apply Profile</button><button type="button" class="ra-btn" id="ra-company-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><details class="ra-profile-more"><summary class="ra-btn">More…</summary><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-profile-save-search" ${profiles.length?'':'disabled'}>Save Search to Profile</button><button type="button" class="ra-btn" id="ra-company-profile-manage">Manage Profiles</button></div></details></div>`;
    const playerCell=row=>`<a class="ra-link" href="#" data-player-card="${esc(row.userId)}" data-player-domain="company">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small>`;
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-company-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-company-recruit="${esc(row.userId)}">Message</button>`;
    const expandedBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td>${playerCell(row)}</td><td>${stat(row.level)}</td><td>${stat(row.age)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${stat(row.end)}</td><td>${esc(text(row.drugUse)||'—')}</td><td>${stat(row.activity30)}</td><td>${stat(row.activeStreak)}</td><td>${esc(row.currentOrganizationLabel||'Unknown')}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${provenanceCell(row)}</td><td>${esc(contactedLabel(row))}</td><td>${messageCell(row)}</td></tr>`).join('');
    const compactBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td>${playerCell(row)}</td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${messageCell(row)}</td></tr>`).join('');
    const resultsTable=layout==='compact'
      ? `<table class="ra-table ra-core-results ra-results-compact"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>Recruit Fit</th><th>Message</th></tr></thead><tbody>${compactBody||'<tr><td colspan="7">No matching Company candidates.</td></tr>'}</tbody></table>`
      : `<table class="ra-table ra-core-results ra-results-expanded"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('level','Level',sort)}</th><th>${sortHeader('age','Age',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>Drug Use</th><th>${sortHeader('activity30','30d Active',sort)}</th><th>${sortHeader('activeStreak','Streak',sort)}</th><th>Employment</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>${sortHeader('recruitmentFit','Recruit Fit',sort)}</th><th>Source</th><th>Contacted</th><th>Message</th></tr></thead><tbody>${expandedBody||'<tr><td colspan="15">No matching Company candidates.</td></tr>'}</tbody></table>`;
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Find players, narrow the list with filters, then message the ones you want.</p></div></div>${profileBar}<div class="ra-formgrid ra-core-search-grid"><div class="ra-field"><label>Name / ID</label><input id="ra-company-filter-search" value="${esc(filters.search||'')}" placeholder="Player name or ID"></div><div class="ra-field"><label>Status</label><select id="ra-company-filter-status"><option value="">Any</option><option value="Online" ${text(filters.onlineStatus).toLowerCase()==='online'?'selected':''}>Online</option><option value="Idle" ${text(filters.onlineStatus).toLowerCase()==='idle'?'selected':''}>Idle</option><option value="Offline" ${text(filters.onlineStatus).toLowerCase()==='offline'?'selected':''}>Offline</option></select></div><div class="ra-field"><label>Current Company</label><input id="ra-company-filter-organization" value="${esc(filters.organization||'')}" placeholder="Company name"></div><div class="ra-field"><label>Company Presence</label><select id="ra-company-filter-organization-presence"><option value="any" ${!filters.organizationPresence||filters.organizationPresence==='any'?'selected':''}>Any</option><option value="none" ${filters.organizationPresence==='none'?'selected':''}>None</option><option value="has" ${filters.organizationPresence==='has'?'selected':''}>Has Company</option></select></div><div class="ra-field"><label>END ≥</label><input id="ra-company-filter-end" value="${esc(filters.minEnd||'')}" placeholder="e.g. 100k"></div><div class="ra-field"><label>MAN ≥</label><input id="ra-company-filter-man" value="${esc(filters.minMan||'')}" placeholder="e.g. 50k"></div><div class="ra-field"><label>INT ≥</label><input id="ra-company-filter-int" value="${esc(filters.minInt||'')}" placeholder="e.g. 50k"></div></div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-company-search-apply">Search</button><button type="button" class="ra-btn" id="ra-company-search-clear">Clear</button><button type="button" class="ra-btn" id="ra-company-hof-discover" title="Import one bounded page of public work-stat HOF prospects without per-player enrichment">Discover Workstat Prospects</button></div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${filteredTotal} matching of ${total} Company candidate(s).</p></div><div class="ra-actions"><button type="button" class="ra-btn ${layout==='expanded'?'ra-primary':''}" data-results-layout="expanded">Expanded</button><button type="button" class="ra-btn ${layout==='compact'?'ra-primary':''}" data-results-layout="compact">Compact</button></div></div><div class="ra-table-wrap">${resultsTable}</div><div class="ra-panel-foot">${pager}</div></section>`;
  }

  function renderCriterionRow(raw={},scope='baseline'){
    const req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||'ee',operator:text(raw.operator)||'gte',kind:text(raw.kind)||'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    return `<div class="ra-formgrid" data-criterion-row data-criterion-id="${esc(req.id)}" style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input data-criterion-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select data-criterion-field="field">${CRITERION_FIELDS.map(field=>`<option value="${field}" ${field===req.field?'selected':''}>${field}</option>`).join('')}</select></div><div class="ra-field"><label>Operator</label><select data-criterion-field="operator">${CRITERION_OPERATORS.map(op=>`<option value="${op}" ${op===req.operator?'selected':''}>${op}</option>`).join('')}</select></div><div class="ra-field"><label>Type</label><select data-criterion-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind!=='Hard'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input data-criterion-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input data-criterion-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-remove-criterion="${esc(scope)}">×</button></div>`;
  }





  function renderBaselineEditor(config={},options={}){
    const criteria=Array.isArray(config.baseline?.criteria)?config.baseline.criteria:[];
    return `<details class="ra-panel" id="ra-company-baseline-editor" ${options.open?'open':''}><summary><b>Eligibility baseline</b> <span class="ra-muted">${criteria.length} criteria</span></summary><p class="ra-muted">Hard criteria mark candidates as not eligible in results. Preferred criteria only affect quality.</p><div id="ra-company-baseline-criteria" data-criteria-host>${criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-baseline-add">Add criterion</button><button type="button" class="ra-btn ra-primary" id="ra-company-baseline-save">Save Baseline</button></div></details>`;
  }
  return Object.freeze({COMPANY_STAGES,buildCandidateRows,renderCandidates,renderCriterionRow,renderBaselineEditor});
});
