const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const Platform=require('../src/v46-company-platform');

const EXPECTED_ROUTES=['company-discover','company-candidates'];

test('Company platform owns Company Search & Results and names Forum Discovery',()=>{
  assert.deepEqual(Platform.COMPANY_ROUTES,EXPECTED_ROUTES);
  for(const route of EXPECTED_ROUTES){
    assert.equal(Platform.isCompanyRoute(route),true);
    const meta=Platform.routeMeta(route);
    assert.ok(meta.title.length>0);
    assert.ok(meta.description.length>0);
  }
  assert.equal(Platform.isCompanyRoute('scout'),false);
  for(const removed of ['company-overview','company-pipeline','company-vacancies','company-compare'])assert.equal(Platform.isCompanyRoute(removed),false,removed);
  assert.equal(Platform.isCompanyRoute('faction-candidates'),false);
  assert.deepEqual([...Platform._test.IMPLEMENTED_ROUTES],['company-candidates']);
});

test('Company platform installs only on a mounted v4.6-capable app and keeps Faction workflow outside its scope',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="ra-app"><h2 id="ra-page-title"></h2><p id="ra-page-desc"></p><div id="ra-nav"><button data-page="company-candidates">Search</button><button data-page="scout">Scout</button></div><div id="ra-content"></div></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
  const fakeDb={transaction(){throw new Error('DB should not be touched until rendering');}};
  const app={_test:{state:{db:fakeDb,settings:{activePage:'scout'},page:'scout'},companyRepositories:{}}};
  const installed=Platform.install(app,{renderInitial:false});
  assert.equal(installed,true);
  assert.equal(document.querySelector('[data-page="scout"]').onclick,null,'shared Scout navigation remains owned by the base app');
  assert.equal(typeof document.querySelector('[data-page="company-candidates"]').onclick,'function','Company navigation is owned by v4.6 platform');
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
