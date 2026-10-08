const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const Platform=require('../src/v46-company-platform');

const EXPECTED_ROUTES=[
  'company-overview','company-today','company-discover','company-candidates','company-pipeline',
  'company-vacancies','company-campaigns','company-followups','company-timeline','company-stage-aging',
  'company-contact-outcomes','company-recruitment-sessions','company-talent-pool','company-reactivation',
  'company-opportunity','company-compare'
];

test('Company platform owns the complete approved Company route set',()=>{
  assert.deepEqual(Platform.COMPANY_ROUTES,EXPECTED_ROUTES);
  for(const route of EXPECTED_ROUTES){
    assert.equal(Platform.isCompanyRoute(route),true);
    const meta=Platform.routeMeta(route);
    assert.ok(meta.title.startsWith('Company '));
    assert.ok(meta.description.length>0);
  }
  assert.equal(Platform.isCompanyRoute('scout'),false);
  assert.equal(Platform.isCompanyRoute('faction-overview'),false);
});

test('Company platform installs only on a mounted v4.6-capable app and keeps Faction workflow outside its scope',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="ra-app"><h2 id="ra-page-title"></h2><p id="ra-page-desc"></p><div id="ra-nav"><button data-page="company-overview">Overview</button><button data-page="scout">Scout</button></div><div id="ra-content"></div></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
  const fakeDb={transaction(){throw new Error('DB should not be touched until rendering');}};
  const app={_test:{state:{db:fakeDb,settings:{activePage:'scout'},page:'scout'},companyRepositories:{}}};
  const installed=Platform.install(app,{renderInitial:false});
  assert.equal(installed,true);
  assert.equal(document.querySelector('[data-page="scout"]').onclick,null,'shared Scout navigation remains owned by the base app');
  assert.equal(typeof document.querySelector('[data-page="company-overview"]').onclick,'function','Company navigation is owned by v4.6 platform');
  Platform.uninstall();
  dom.window.close();
});


test('v4.9 role profiles derive Company search thresholds without inventing missing criteria',()=>{
  const profile={criteria:{
    man:{enabled:true,target:50000},
    int:{enabled:false,target:90000},
    end:{enabled:true,target:100000}
  },searchFilters:{company:{search:'Alice',organizationPresence:'none'}}};
  assert.deepEqual(Platform._test.profileRequirements(profile),{minMan:50000,minEnd:100000});
  assert.deepEqual(Platform._test.profileSearchFilters(profile),{
    search:'Alice',minEnd:'100000',minMan:'50000',minInt:'',
    onlineStatus:'',organization:'',organizationPresence:'none'
  });
});

test('v4.9 explicit saved-search thresholds override role-profile fallbacks',()=>{
  const profile={criteria:{man:{enabled:true,target:50000}},searchFilters:{company:{minMan:'75k'}}};
  assert.equal(Platform._test.profileSearchFilters(profile).minMan,'75k');
});


test('Company Results uses a bounded 100-row local render window',()=>{
  assert.equal(Platform._test.RESULTS_PAGE_SIZE,100);
});
