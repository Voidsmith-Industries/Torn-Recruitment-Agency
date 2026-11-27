(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V46Navigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPANY_PAGES = Object.freeze([
    Object.freeze({id:'company-candidates',label:'Search & Results',core:true})
  ]);

  const FACTION_PAGES = Object.freeze([
    Object.freeze({id:'faction-candidates',label:'Search & Results',core:true})
  ]);

  const GROUPS = Object.freeze([
    Object.freeze({id:'company-recruitment',label:'COMPANY',pages:COMPANY_PAGES}),
    Object.freeze({id:'faction-recruitment',label:'FACTION',pages:FACTION_PAGES}),
    Object.freeze({id:'intelligence',label:'OPTIONAL TOOLS',pages:Object.freeze([
      Object.freeze({id:'company-discover',label:'Forum Discovery',flag:'companyDiscovery'}),
      Object.freeze({id:'scout',label:'Scout',flag:'scout'}),
      Object.freeze({id:'smart-match',label:'Smart Match',flag:'smartMatch'}),
      Object.freeze({id:'global-intelligence',label:'Global Intelligence',flag:'globalIntelligence'})
    ])}),
    Object.freeze({id:'application',label:'ADVANCED',pages:Object.freeze([
      Object.freeze({id:'data',label:'Data',flag:'data'})
    ])})
  ]);

  const GROUP_IDS = Object.freeze(GROUPS.map(group => group.id));
  const ROUTES = Object.freeze([...GROUPS.flatMap(group => group.pages.map(page => page.id)),'settings']);

  function normalizeRoute(value) {
    const requested = String(value || '').trim().toLowerCase();
    return ROUTES.includes(requested) ? requested : 'company-candidates';
  }

  function moduleEnabled(settings, page) {
    if (page.core) return true;
    return settings?.optionalModules?.[page.flag] === true;
  }

  function visibleGroups(settings = {}) {
    return GROUPS.map(group => ({
      id:group.id,
      label:group.label,
      pages:group.pages.filter(page => moduleEnabled(settings, page)).map(page => ({id:page.id,label:page.label}))
    })).filter(group => group.pages.length > 0);
  }

  function normalizeExpandedGroups(value) {
    if (value === undefined) return ['company-recruitment'];
    if (!Array.isArray(value)) return ['company-recruitment'];
    const requested = new Set(value.map(item => String(item || '').trim().toLowerCase()));
    return GROUP_IDS.filter(id => requested.has(id));
  }

  function toggleExpandedGroup(current, groupId) {
    const id = String(groupId || '').trim().toLowerCase();
    const normalized = normalizeExpandedGroups(Array.isArray(current) ? current : undefined);
    if (!GROUP_IDS.includes(id)) return normalized;
    const open = new Set(normalized);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    return GROUP_IDS.filter(group => open.has(group));
  }

  return Object.freeze({COMPANY_PAGES,FACTION_PAGES,GROUPS,GROUP_IDS,ROUTES,normalizeRoute,visibleGroups,normalizeExpandedGroups,toggleExpandedGroup});
});
