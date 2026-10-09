const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');

let Platform=null;
try{Platform=require('../src/v47-faction-platform');}catch{}
function platform(){assert.ok(Platform,'Faction platform module should exist');return Platform;}

const EXPECTED_ROUTES=[
  'faction-overview','faction-today','faction-discover','faction-candidates','faction-pipeline',
  'faction-requirements','faction-campaigns','faction-followups','faction-timeline','faction-stage-aging',
  'faction-contact-outcomes','faction-recruitment-sessions','faction-reactivation','faction-opportunity','faction-compare'
];

test('Faction platform owns the complete approved Faction route set only',()=>{
  const P=platform();
  assert.deepEqual(P.FACTION_ROUTES,EXPECTED_ROUTES);
  for(const route of EXPECTED_ROUTES){
    assert.equal(P.isFactionRoute(route),true);
    const meta=P.routeMeta(route);
    assert.ok(meta.title.startsWith('Faction '));
    assert.ok(meta.description.length>0);
  }
  assert.equal(P.isFactionRoute('company-overview'),false);
  assert.equal(P.isFactionRoute('scout'),false);
});

test('Faction platform installs only on Faction navigation and leaves Company/shared handlers alone',()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="ra-app"><h2 id="ra-page-title"></h2><p id="ra-page-desc"></p><div id="ra-nav"><button data-page="company-overview">Company</button><button data-page="faction-overview">Faction</button><button data-page="scout">Scout</button></div><div id="ra-content"></div></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
  const fakeDb={transaction(){throw new Error('DB should not be touched until rendering');}};
  const app={_test:{state:{db:fakeDb,settings:{activePage:'company-overview'},page:'company-overview'},repositories:{},factionRepositories:{}}};
  const P=platform();
  assert.equal(P.install(app,{renderInitial:false}),true);
  assert.equal(document.querySelector('[data-page="company-overview"]').onclick,null);
  assert.equal(document.querySelector('[data-page="scout"]').onclick,null);
  assert.equal(typeof document.querySelector('[data-page="faction-overview"]').onclick,'function');
  P.uninstall();
  dom.window.close();
});

test('Faction platform exposes synchronous navigation rebinding for rebuilt sidebars',()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="ra-app"><div id="ra-nav"><button data-page="faction-overview">Faction</button></div><div id="ra-content"></div></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
  const fakeDb={transaction(){throw new Error('DB should not be touched until rendering');}};
  const app={_test:{state:{db:fakeDb,settings:{},page:'company-overview'},repositories:{},factionRepositories:{}}};
  const P=platform();
  P.install(app,{renderInitial:false});
  const nav=document.getElementById('ra-nav');
  nav.innerHTML='<button data-page="faction-candidates">Candidates</button>';
  assert.equal(document.querySelector('[data-page="faction-candidates"]').onclick,null);
  assert.equal(P.syncNavigation(),true);
  assert.equal(typeof document.querySelector('[data-page="faction-candidates"]').onclick,'function');
  P.uninstall();
  dom.window.close();
});


test('Faction Results profile applies saved filters with specialist work-stat fallbacks',()=>{
  const P=platform();
  const profile={
    profileId:'rw',name:'RW Fighter',status:'Active',
    searchFilters:{onlineStatus:'Online',organizationPresence:'none',minEnd:''},
    criteria:[
      {field:'end',operator:'gte',value:250000},
      {field:'man',operator:'gte',value:50000},
      {field:'rwHits30',operator:'gte',value:50}
    ]
  };
  const filters=P._test.profileSearchFilters(profile);
  assert.equal(filters.onlineStatus,'Online');
  assert.equal(filters.organizationPresence,'none');
  assert.equal(filters.minEnd,'250000');
  assert.equal(filters.minMan,'50000');
  assert.equal(filters.minInt,'');
  assert.equal(P._test.activeResultsProfile({activeResultsProfileId:'rw'},[profile]).profileId,'rw');
  assert.equal(P._test.activeResultsProfile({activeResultsProfileId:'missing'},[profile]),null);
});


test('Faction Results uses a bounded 100-row local render window',()=>{
  const P=platform();
  assert.equal(P._test.RESULTS_PAGE_SIZE,100);
});
