(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const FACTION_STAGES=FactionCore.FACTION_STAGES;
  const TERMINAL_STAGES=new Set(['Joined','Rejected']);
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);
  const PROFILE_STATES=FactionCore.PROFILE_STATES;

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const score=value=>Number.isFinite(Number(value))?Number(value).toFixed(0):'—';
  const dateText=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toLocaleString():'—';};

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

  function buildOverviewModel(rows=[],profiles=[]){
    const stageCounts=Object.fromEntries(FACTION_STAGES.map(stage=>[stage,0]));
    let activeCandidates=0,eligible=0,notCurrentlyEligible=0;
    for(const row of Array.isArray(rows)?rows:[]){
      const stage=normalizeStage(row.pipelineStage);stageCounts[stage]++;
      if(!row.archived&&!TERMINAL_STAGES.has(stage))activeCandidates++;
      if(['Eligible','Eligible by Waiver'].includes(text(row.baselineEligibility)))eligible++;
      if(text(row.baselineEligibility)==='NOT CURRENTLY ELIGIBLE')notCurrentlyEligible++;
    }
    return {
      totalCandidates:(Array.isArray(rows)?rows:[]).length,
      activeCandidates,
      eligible,
      notCurrentlyEligible,
      activeProfiles:(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).filter(profile=>profile.status==='Active').length,
      stageCounts
    };
  }

  function buildTodayModel(rows=[],context={}){
    const queue=FactionCore.buildTodayQueue(rows,context);
    const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    return queue.map(item=>{
      const row=byId.get(text(item.userId))||{};
      return {...item,name:text(row.name)||`User ${item.userId}`,baselineEligibility:text(row.baselineEligibility)||'Unknown',fit:row.fit??null,suggestedProfileId:text(row.suggestedProfileId),pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId)};
    });
  }

  function buildPipelineModel(rows=[]){
    const buckets=Object.fromEntries(FACTION_STAGES.map(stage=>[stage,[]]));
    for(const row of Array.isArray(rows)?rows:[]){if(!row||text(row.factionRecord?.domain).toLowerCase()==='company')continue;buckets[normalizeStage(row.pipelineStage)].push(row);}
    return buckets;
  }

  function kpi(label,value){return `<div class="ra-kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;}
  function stageOptions(selected){return FACTION_STAGES.map(stage=>`<option value="${esc(stage)}" ${stage===selected?'selected':''}>${esc(stage)}</option>`).join('');}

  function renderOverview(model={}){
    const counts=model.stageCounts||{};
    return `<div class="ra-kpis">${kpi('Active Candidates',number(model.activeCandidates))}${kpi('Baseline Eligible',number(model.eligible))}${kpi('Active Profiles',number(model.activeProfiles))}${kpi('Invite Ready',number(counts['Invite Ready']))}</div><section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Recruitment</h3><p>Faction-only workflow state over shared Player Intelligence.</p></div></div><div class="ra-detail-grid"><span>Not Currently Eligible<b>${number(model.notCurrentlyEligible)}</b></span><span>Replied<b>${number(counts.Replied)}</b></span><span>Evaluating<b>${number(counts.Evaluating)}</b></span><span>Joined<b>${number(counts.Joined)}</b></span></div><div class="ra-actions" style="margin-top:10px"><button class="ra-btn ra-primary" data-go-page="faction-today">Open Today</button><button class="ra-btn" data-go-page="faction-requirements">Requirements &amp; Profiles</button><button class="ra-btn" data-go-page="faction-candidates">Faction Candidates</button></div></section>`;
  }

  function renderToday(items=[]){
    const body=(Array.isArray(items)?items:[]).map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.pipelineStage)}</td><td>${esc((item.reasons||[]).join(' · '))}</td><td>${esc(item.baselineEligibility)}</td><td>${score(item.fit)}</td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Today</h3><p>Priority Faction recruitment work. Viewing never changes stage.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Stage</th><th>Why now</th><th>Baseline</th><th>Fit</th></tr></thead><tbody>${body||'<tr><td colspan="5">Nothing requires attention.</td></tr>'}</tbody></table></div></section>`;
  }

  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus);if(status.toLowerCase()==='online')return '<span class="ra-online-live">Online</span>';if(status.toLowerCase()==='idle')return '<span class="ra-online-idle">Idle</span>';if(status.toLowerCase()==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function sortHeader(key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-faction-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  function recruitmentFitCell(row={}){const value=Number(row.recruitmentFit);if(!Number.isFinite(value))return '<span class="ra-muted">—</span>';const confidence=text(row.recruitmentConfidence)||'Low';return `<span title="Recruitment Fit · ${esc(confidence)} confidence"><b>${value.toFixed(1)}</b><small class="ra-muted"> ${esc(confidence)}</small></span>`;}
  function provenanceCell(row={}){const p=row.prospectProvenance||{};const source=Array.isArray(p.sources)&&p.sources.length?p.sources[0]:'Unknown';const state=text(row.prospectState)||text(p.state)||'Known Candidate';return `<span title="${esc(state)}"><b>${esc(source)}</b><small class="ra-muted"> · ${esc(state)}</small></span>`;}
  function contactedLabel(row={}){const stage=text(row.pipelineStage).toLowerCase();return ['contacted','replied','evaluating','invite ready','joined'].includes(stage)?'Contacted':'Not yet';}
  function renderCandidates(rows=[],options={}){
    const filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'},layout=options.layout==='compact'?'compact':'expanded';const total=Number.isFinite(Number(options.total))?Number(options.total):(Array.isArray(rows)?rows:[]).length;
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const activeProfileId=text(options.activeProfileId);
    const pagination=options.pagination||{page:0,pageCount:1,start:0,end:(Array.isArray(rows)?rows:[]).length};const filteredTotal=Number.isFinite(Number(options.filteredTotal))?Number(options.filteredTotal):(Array.isArray(rows)?rows:[]).length;
    const rangeText=filteredTotal?`${Number(pagination.start||0)+1}-${Number(pagination.end||0)}`:'0';
    const pager=`<div class="ra-actions"><button type="button" class="ra-btn" data-results-page="prev" ${Number(pagination.page||0)<=0?'disabled':''}>Previous</button><span class="ra-muted">${rangeText} of ${filteredTotal}</span><button type="button" class="ra-btn" data-results-page="next" ${Number(pagination.page||0)>=Number(pagination.pageCount||1)-1?'disabled':''}>Next</button></div>`;
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+['<option value="">Faction default</option>',...profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${profile.profileId===activeProfileId?'selected':''}>${esc(profile.name||profile.profileId)}${profile.status==='Active'?'':' · '+esc(profile.status)}</option>`)].join('');
    const playerCell=row=>`<a class="ra-link" href="#" data-player-card="${esc(row.userId)}" data-player-domain="faction">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small>`;
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-faction-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-faction-recruit="${esc(row.userId)}">Message</button>`;
    const battle=row=>{const attacks=Number(row.attacks30),rw=Number(row.rwHits30);if(!Number.isFinite(attacks)&&!Number.isFinite(rw))return '—';return `${Number.isFinite(attacks)?attacks.toLocaleString():'—'} / ${Number.isFinite(rw)?rw.toLocaleString():'—'}`;};
    const expandedBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr data-context-id="${esc(row.userId)}"><td>${playerCell(row)}</td><td>${stat(row.level)}</td><td>${stat(row.age)}</td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${stat(row.networth)}</td><td>${esc(text(row.drugUse)||'—')}</td><td>${stat(row.activity30)}</td><td>${battle(row)}</td><td>${stat(row.activeStreak)}</td><td>${stat(row.xanax30)}</td><td>${esc(row.currentOrganizationLabel||'Unknown')}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${provenanceCell(row)}</td><td>${esc(contactedLabel(row))}</td><td>${messageCell(row)}</td></tr>`).join('');
    const compactBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr data-context-id="${esc(row.userId)}"><td>${playerCell(row)}</td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${messageCell(row)}</td></tr>`).join('');
    const resultsTable=layout==='compact'
      ? `<table class="ra-table ra-core-results ra-results-compact"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>Recruit Fit</th><th>Message</th></tr></thead><tbody>${compactBody||'<tr><td colspan="7">No matching Faction candidates.</td></tr>'}</tbody></table>`
      : `<table class="ra-table ra-core-results ra-results-expanded"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('level','Level',sort)}</th><th>${sortHeader('age','Age',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('networth','Net Worth',sort)}</th><th>Drug Use</th><th>${sortHeader('activity30','30d Active',sort)}</th><th>Battle / RW</th><th>${sortHeader('activeStreak','Streak',sort)}</th><th>${sortHeader('xanax30','Xanax 30d',sort)}</th><th>Faction</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>${sortHeader('recruitmentFit','Recruit Fit',sort)}</th><th>Source</th><th>Contacted</th><th>Message</th></tr></thead><tbody>${expandedBody||'<tr><td colspan="18">No matching Faction candidates.</td></tr>'}</tbody></table>`;
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Search configured recruitment forums and Torn users, then filter the combined candidate intelligence.</p></div><div class="ra-actions"><select id="ra-faction-results-profile" class="ra-btn" aria-label="Faction recruitment profile">${profileOptions}</select><button type="button" class="ra-btn" id="ra-faction-profile-apply">Apply Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-clear" ${activeProfileId?'':'disabled'}>Clear Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-save-search" ${activeProfileId?'':'disabled title="Choose a specialist profile first"'}>Save Search</button></div></div><div class="ra-formgrid ra-core-search-grid"><div class="ra-field"><label>Name / ID</label><input id="ra-faction-filter-search" value="${esc(filters.search||'')}" placeholder="Player name or ID"></div><div class="ra-field"><label>Status</label><select id="ra-faction-filter-status"><option value="">Any</option><option value="Online" ${text(filters.onlineStatus).toLowerCase()==='online'?'selected':''}>Online</option><option value="Idle" ${text(filters.onlineStatus).toLowerCase()==='idle'?'selected':''}>Idle</option><option value="Offline" ${text(filters.onlineStatus).toLowerCase()==='offline'?'selected':''}>Offline</option></select></div><div class="ra-field"><label>Current Faction</label><input id="ra-faction-filter-organization" value="${esc(filters.organization||'')}" placeholder="Faction name or ID"></div><div class="ra-field"><label>Faction Presence</label><select id="ra-faction-filter-organization-presence"><option value="any" ${!filters.organizationPresence||filters.organizationPresence==='any'?'selected':''}>Any</option><option value="none" ${filters.organizationPresence==='none'?'selected':''}>None</option><option value="has" ${filters.organizationPresence==='has'?'selected':''}>Has Faction</option></select></div><div class="ra-field"><label>END ≥</label><input id="ra-faction-filter-end" value="${esc(filters.minEnd||'')}" placeholder="e.g. 100k"></div><div class="ra-field"><label>MAN ≥</label><input id="ra-faction-filter-man" value="${esc(filters.minMan||'')}" placeholder="e.g. 50k"></div><div class="ra-field"><label>INT ≥</label><input id="ra-faction-filter-int" value="${esc(filters.minInt||'')}" placeholder="e.g. 50k"></div></div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-search-apply">Search</button><button type="button" class="ra-btn" id="ra-faction-search-clear">Clear</button></div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${filteredTotal} matching of ${total} Faction candidate(s).</p></div><div class="ra-actions"><button type="button" class="ra-btn ${layout==='expanded'?'ra-primary':''}" data-results-layout="expanded">Expanded</button><button type="button" class="ra-btn ${layout==='compact'?'ra-primary':''}" data-results-layout="compact">Compact</button></div></div><div class="ra-table-wrap">${resultsTable}</div><div class="ra-panel-foot">${pager}</div></section>`;
  }
  function renderPipeline(model={}){
    return `<div class="ra-pipeline">${FACTION_STAGES.map(stage=>`<section class="ra-stage" data-faction-stage="${esc(stage)}"><div class="ra-stage-head"><b>${esc(stage)}</b><span>${(model[stage]||[]).length}</span></div><div class="ra-stage-drop">${(model[stage]||[]).map(row=>`<article class="ra-stage-card" data-context-id="${esc(row.userId)}"><b>${esc(row.name)}</b><div>${esc(row.baselineEligibility)} · Fit ${score(row.fit)}</div><div>${esc(row.pinnedSpecialistProfileId||row.suggestedProfileId||'No specialist profile')}</div><select class="ra-btn" data-faction-stage-select="${esc(row.userId)}">${stageOptions(row.pipelineStage)}</select></article>`).join('')}</div></section>`).join('')}</div>`;
  }

  function renderCriterionRow(raw={},scope='baseline'){
    const req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||'level',operator:text(raw.operator)||'gte',kind:text(raw.kind)==='Hard'?'Hard':'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    return `<div class="ra-formgrid" data-faction-criterion-row data-faction-criterion-id="${esc(req.id)}" data-faction-criterion-scope="${esc(scope)}" style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input data-faction-criterion-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select data-faction-criterion-field="field">${CRITERION_FIELDS.map(field=>`<option value="${field}" ${field===req.field?'selected':''}>${field}</option>`).join('')}</select></div><div class="ra-field"><label>Operator</label><select data-faction-criterion-field="operator">${CRITERION_OPERATORS.map(op=>`<option value="${op}" ${op===req.operator?'selected':''}>${op}</option>`).join('')}</select></div><div class="ra-field"><label>Type</label><select data-faction-criterion-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind==='Preferred'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input data-faction-criterion-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input data-faction-criterion-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-faction-remove-criterion="${esc(scope)}">×</button></div>`;
  }


  function renderWaiverManagement({baseline={},profiles=[],rows=[]}={}){
    const normalizedBaseline=FactionCore.normalizeBaseline(baseline||{});
    const normalizedProfiles=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const candidateRows=Array.isArray(rows)?rows:[];
    const playerOptions=candidateRows.map(row=>'<option value="'+esc(row.userId)+'">'+esc(row.name||('User '+row.userId))+' · '+esc(row.userId)+' · '+esc(row.baselineEligibility||'Unknown')+'</option>').join('');
    const profileOptions=normalizedProfiles.map(profile=>'<option value="'+esc(profile.profileId)+'">'+esc(profile.name||profile.profileId)+'</option>').join('');
    const requirementOptions=[
      ...normalizedBaseline.criteria.map(req=>'<option value="'+esc(req.id)+'" data-waiver-context="baseline" data-waiver-profile="">Baseline · '+esc(req.label||req.id)+'</option>'),
      ...normalizedProfiles.flatMap(profile=>(profile.criteria||[]).map(req=>'<option value="'+esc(req.id)+'" data-waiver-context="specialist" data-waiver-profile="'+esc(profile.profileId)+'">Specialist · '+esc(profile.name||profile.profileId)+' · '+esc(req.label||req.id)+'</option>'))
    ].join('');
    const candidateStatus=candidateRows.map(row=>'<tr><td>'+esc(row.name||('User '+row.userId))+' <small class="ra-muted">'+esc(row.userId)+'</small></td><td>'+esc(row.baselineEligibility||'Unknown')+'</td><td>'+number((row.waivers||[]).filter(item=>text(item.state)==='Active').length)+'</td></tr>').join('');
    const history=candidateRows.flatMap(row=>(Array.isArray(row.waivers)?row.waivers:[]).map(waiver=>({row,waiver}))).sort((a,b)=>number(b.waiver.grantedAt)-number(a.waiver.grantedAt)).map(({row,waiver})=>{
      const context=text(waiver.context).toLowerCase()==='specialist'?'specialist':'baseline';
      const profile=context==='specialist'?normalizedProfiles.find(item=>text(item.profileId)===text(waiver.profileId)):null;
      const criteria=context==='specialist'?(profile?.criteria||[]):normalizedBaseline.criteria;
      const requirement=criteria.find(item=>text(item.id)===text(waiver.requirementId));
      const requirementLabel=text(requirement?.label)||text(waiver.requirementId)||'Unknown requirement';
      const contextLabel=context==='specialist'?('Specialist · '+(profile?.name||waiver.profileId||'Unknown profile')):'Baseline';
      const active=text(waiver.state)==='Active';
      const resolveButton=active?'<button type="button" class="ra-btn" data-faction-waiver-resolve="'+esc(waiver.waiverId)+'" data-faction-waiver-player="'+esc(row.userId)+'">Resolve</button>':'';
      return '<tr><td>'+esc(row.name||('User '+row.userId))+'</td><td>'+esc(requirementLabel)+'</td><td>'+esc(contextLabel)+'</td><td>'+esc(waiver.reason)+'</td><td>'+esc(waiver.state||'Unknown')+'</td><td>'+esc(dateText(waiver.reviewAt))+'</td><td>'+esc(waiver.resolvedReason||'')+'</td><td>'+resolveButton+'</td></tr>';
    }).join('');
    return '<section class="ra-panel"><div class="ra-panel-head"><div><h3>Waiver Management</h3><p>Grant an individual exception without changing the underlying Player Intelligence fact or requirement. Resolved waivers remain in history.</p></div></div>'+
      '<div class="ra-formgrid"><div class="ra-field"><label>Candidate</label><select id="ra-faction-waiver-player"><option value="">Choose candidate</option>'+playerOptions+'</select></div>'+
      '<div class="ra-field"><label>Context</label><select id="ra-faction-waiver-context"><option value="baseline">Baseline</option><option value="specialist">Specialist</option></select></div>'+
      '<div class="ra-field"><label>Specialist Profile</label><select id="ra-faction-waiver-profile"><option value="">Choose profile</option>'+profileOptions+'</select></div>'+
      '<div class="ra-field"><label>Requirement</label><select id="ra-faction-waiver-requirement"><option value="">Choose requirement</option>'+requirementOptions+'</select></div>'+
      '<div class="ra-field"><label>Review</label><input id="ra-faction-waiver-review" type="datetime-local"></div>'+
      '<div class="ra-field" style="grid-column:1/-1"><label>Reason</label><textarea id="ra-faction-waiver-reason" placeholder="Why is this individual exception approved?"></textarea></div></div>'+
      '<div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-waiver-grant">Grant Waiver</button></div>'+
      '<div class="ra-table-wrap" style="margin-top:12px"><table class="ra-table"><thead><tr><th>Candidate</th><th>Baseline status</th><th>Active waivers</th></tr></thead><tbody>'+(candidateStatus||'<tr><td colspan="3">No Faction candidates.</td></tr>')+'</tbody></table></div>'+
      '<div class="ra-table-wrap" style="margin-top:12px"><table class="ra-table"><thead><tr><th>Candidate</th><th>Requirement</th><th>Context</th><th>Reason</th><th>State</th><th>Review</th><th>Resolution</th><th>Action</th></tr></thead><tbody>'+(history||'<tr><td colspan="8">No waiver history.</td></tr>')+'</tbody></table></div></section>';
  }

  function renderRequirementsPage({config={},profiles=[],rows=[]}={}){
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const profileCards=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).map(profile=>`<section class="ra-panel" data-faction-profile-card="${esc(profile.profileId)}"><div class="ra-panel-head"><div><h3>${esc(profile.name||profile.profileId||'Specialist Profile')}</h3><p>Specialist matching context. Hard failures affect this profile only.</p></div></div><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input data-faction-profile-field="name" value="${esc(profile.name)}"></div><div class="ra-field"><label>Status</label><select data-faction-profile-field="status">${PROFILE_STATES.map(state=>`<option value="${state}" ${state===profile.status?'selected':''}>${state}</option>`).join('')}</select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-faction-profile-field="notes">${esc(profile.notes)}</textarea></div></div><div data-faction-profile-criteria>${profile.criteria.map(req=>renderCriterionRow(req,`profile:${profile.profileId}`)).join('')}</div><div class="ra-actions"><button class="ra-btn" data-faction-profile-add-criterion="${esc(profile.profileId)}">Add criterion</button><button class="ra-btn ra-primary" data-faction-profile-save="${esc(profile.profileId)}">Save Profile</button><button class="ra-btn ra-danger" data-faction-profile-delete="${esc(profile.profileId)}">Delete</button></div></section>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Baseline</h3><p>Hard requirements gate Invite Ready unless individually waived. Preferred requirements affect score only.</p></div></div><div id="ra-faction-baseline-criteria">${baseline.criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button class="ra-btn" id="ra-faction-baseline-add">Add Requirement</button><button class="ra-btn ra-primary" id="ra-faction-baseline-save">Save Faction Baseline</button></div></section><section class="ra-panel"><div class="ra-panel-head"><div><h3>Specialist Profiles</h3><p>Draft, Active, Paused and Archived profiles are separate from Faction Baseline eligibility.</p></div></div><div class="ra-actions"><button class="ra-btn ra-primary" id="ra-faction-profile-new">Create Specialist Profile</button></div></section>${profileCards||'<section class="ra-panel"><div class="ra-muted">No specialist profiles yet.</div></section>'}${renderWaiverManagement({baseline,profiles,rows})}`;
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    CRITERION_FIELDS,
    CRITERION_OPERATORS,
    buildCandidateRows,
    buildOverviewModel,
    buildTodayModel,
    buildPipelineModel,
    renderOverview,
    renderToday,
    renderCandidates,
    renderPipeline,
    renderCriterionRow,
    renderRequirementsPage,
    dateText
  });
});