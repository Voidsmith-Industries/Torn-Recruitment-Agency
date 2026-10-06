const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

function tick(ms = 10) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for condition');
    await tick();
  }
}

test('v4.5 application mounts and primary navigation responds to real clicks', async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <section><h2>Information</h2><div><button>One</button><button>Two</button></div></section>
  </body></html>`, {
    url: 'https://www.torn.com/index.php',
    pretendToBeVisual: true
  });

  Object.defineProperty(dom.window.document, 'readyState', { value: 'complete', configurable: true });
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true
  });

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.location = dom.window.location;
  global.MutationObserver = dom.window.MutationObserver;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.ResizeObserver = ResizeObserverStub;
  global.indexedDB = indexedDB;
  global.IDBKeyRange = IDBKeyRange;
  global.innerWidth = 1440;
  global.innerHeight = 900;
  global.confirm = () => true;
  global.prompt = () => '';
  global.alert = () => {};
  dom.window.ResizeObserver = ResizeObserverStub;
  dom.window.open = () => null;
  dom.window.confirm = global.confirm;
  dom.window.prompt = global.prompt;
  dom.window.alert = global.alert;

  const App = require('../src/v45-app');
  assert.equal(await App.start({ indexedDB }), true);

  const app = document.getElementById('ra-app');
  assert.ok(app, 'application shell should be mounted');

  document.getElementById('ra-launch').click();
  assert.equal(app.style.display, 'block', 'fallback launcher should open the application');

  async function openPage(page, expectedTitle, expectedControl) {
    const button = document.querySelector(`[data-page="${page}"]`);
    assert.ok(button, `navigation button for ${page} should exist`);
    button.click();
    await waitFor(() => document.getElementById('ra-page-title')?.textContent === expectedTitle);
    assert.equal(document.getElementById('ra-page-title').textContent, expectedTitle);
    if (expectedControl) {
      await waitFor(() => document.querySelector(expectedControl));
      assert.ok(document.querySelector(expectedControl), `${expectedControl} should exist after routing to ${page}`);
    }
  }

  await openPage('company-candidates', 'Company Candidates', '#ra-content .ra-table');

  const factionSwitch = document.getElementById('ra-workspace-toggle');
  assert.ok(factionSwitch, 'workspace dropdown should exist');
  factionSwitch.click();
  document.querySelector('[data-workspace-domain="faction"]').click();
  await waitFor(() => document.getElementById('ra-page-title')?.textContent === 'Faction Candidates');
  assert.equal(document.getElementById('ra-page-title').textContent, 'Faction Candidates');
  assert.ok(document.querySelector('[data-page="faction-candidates"]'), 'Faction core route should exist after switching domains');

  document.getElementById('ra-settings-button').click();
  await waitFor(() => document.getElementById('ra-page-title')?.textContent === 'Settings');
  assert.equal(document.getElementById('ra-page-title').textContent, 'Settings');
  assert.ok(document.getElementById('ra-save-settings'), 'Settings controls should be live after clicking the titlebar Settings button');

  const mobileMenu = document.getElementById('ra-mobile-menu');
  mobileMenu.click();
  assert.equal(document.querySelector('.ra-shell').classList.contains('sidebar-open'), true, 'mobile menu button should toggle the shell state');

  const close = document.getElementById('ra-close');
  close.click();
  assert.equal(app.style.display, 'none', 'close button should hide the application');

  dom.window.close();
});