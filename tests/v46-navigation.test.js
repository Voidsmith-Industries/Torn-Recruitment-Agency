const test=require('node:test');
const assert=require('node:assert/strict');
const N=require('../src/v46-navigation');

const REMOVED_ROUTES=[
  'company-overview','company-today','company-pipeline','company-vacancies','company-campaigns','company-followups',
  'company-timeline','company-stage-aging','company-contact-outcomes','company-recruitment-sessions','company-talent-pool',
  'company-reactivation','company-opportunity','company-compare','faction-overview','faction-today','faction-discover',
  'faction-pipeline','faction-requirements','faction-campaigns','faction-followups','faction-timeline','faction-stage-aging',
  'faction-contact-outcomes','faction-recruitment-sessions','faction-reactivation','faction-opportunity','faction-compare','logs'
];

test('navigation keeps Search & Results per domain and Forum Discovery under optional tools',()=>{
  assert.deepEqual(N.GROUPS.find(g=>g.id==='company-recruitment').pages.map(p=>p.id),['company-candidates']);
  assert.deepEqual(N.GROUPS.find(g=>g.id==='faction-recruitment').pages.map(p=>p.id),['faction-candidates']);
  const tools=N.GROUPS.find(g=>g.id==='intelligence');
  assert.deepEqual(tools.pages.map(p=>p.id),['company-discover','scout','smart-match','global-intelligence']);
  const forum=tools.pages.find(p=>p.id==='company-discover');
  assert.equal(forum.label,'Forum Discovery');
  assert.equal(forum.flag,'companyDiscovery','saved optionalModules.companyDiscovery keeps working');
  const visible=N.visibleGroups({optionalModules:{}});
  assert.deepEqual(visible.map(g=>g.label),['COMPANY','FACTION']);
  assert.deepEqual(visible[0].pages.map(p=>p.id),['company-candidates']);
  assert.deepEqual(visible[1].pages.map(p=>p.id),['faction-candidates']);
});

test('optional tools appear only when explicitly enabled and stale workflow flags are ignored',()=>{
  const groups=N.visibleGroups({optionalModules:{companyPipeline:true,factionRequirements:true,logs:true,companyDiscovery:true,scout:true,data:true}});
  assert.deepEqual(groups.find(g=>g.id==='company-recruitment').pages.map(p=>p.id),['company-candidates']);
  assert.deepEqual(groups.find(g=>g.id==='faction-recruitment').pages.map(p=>p.id),['faction-candidates']);
  assert.deepEqual(groups.find(g=>g.id==='intelligence').pages.map(p=>p.id),['company-discover','scout']);
  assert.deepEqual(groups.find(g=>g.id==='application').pages.map(p=>p.id),['data']);
});

test('multiple groups can remain expanded and all groups may be collapsed',()=>{
  assert.deepEqual(N.normalizeExpandedGroups(undefined),['company-recruitment']);
  assert.deepEqual(N.normalizeExpandedGroups([]),[]);
  assert.deepEqual(N.normalizeExpandedGroups(['bogus','faction-recruitment','intelligence','company-recruitment','intelligence']),['company-recruitment','faction-recruitment','intelligence']);
  assert.deepEqual(N.normalizeExpandedGroups(['recruitment']),[],'the v4.5 group alias is gone; unknown ids are dropped');
  let expanded=N.toggleExpandedGroup(['company-recruitment'],'faction-recruitment');
  assert.deepEqual(expanded,['company-recruitment','faction-recruitment']);
  expanded=N.toggleExpandedGroup(expanded,'intelligence');
  assert.deepEqual(expanded,['company-recruitment','faction-recruitment','intelligence']);
  expanded=N.toggleExpandedGroup(expanded,'company-recruitment');
  assert.deepEqual(expanded,['faction-recruitment','intelligence']);
});

test('Settings stays routable; removed workflow routes, Logs and legacy aliases fall back to Search & Results',()=>{
  assert.equal(N.normalizeRoute('settings'),'settings');
  assert.equal(N.normalizeRoute('company-discover'),'company-discover');
  assert.equal(N.normalizeRoute('faction-candidates'),'faction-candidates');
  for(const route of [...REMOVED_ROUTES,'overview','candidates','pipeline','discover','not-a-route']){
    assert.equal(N.ROUTES.includes(route),false,route);
    assert.equal(N.normalizeRoute(route),'company-candidates',route);
  }
  assert.equal(N.GROUPS.some(group=>group.pages.some(page=>page.id==='settings')),false,'Settings stays title-bar only');
});
