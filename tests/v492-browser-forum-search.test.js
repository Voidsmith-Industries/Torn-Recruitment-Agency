// 4.9.2 forum sync, Search more and Torn rate-limit handling (L4, L5, L15).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openPage, settle, getAll, getOne } = require('./v492-browser-harness');

function forumApi(pages, seen) {
  return url => {
    if (!url.pathname.startsWith('/v2/forum/')) return null;
    seen.push(url);
    const n = Number(url.searchParams.get('offset') || 0) / 20;
    const posts = pages[n] || [];
    const next = n + 1 < pages.length + 1 ? `https://api.torn.com/v2/forum/${url.pathname.split('/')[3]}/posts?sort=DESC&offset=${(n + 1) * 20}` : null;
    return { posts, _metadata: { links: { next, prev: null } } };
  };
}

const post = (id, user, ts) => ({ id, author: { id: user, username: `Poster${user}` }, content: `Looking for a company job, END 50000 #${id}`, created_time: ts });

test('L4 every forum sync starts at the newest page, dedupes seen posts, reports only this run and stops on an empty page', { timeout: 60000 }, async () => {
  const now = Math.floor(Date.now() / 1000);
  const seen = [];
  const pages = [[post(1, 9001, now - 60), post(2, 9002, now - 120)], [post(3, 9003, now - 300)], []];
  const page = await openPage(forumApi(pages, seen));
  await page.evaluate(async () => {
    const t = RA_V45App._test;
    await t.saveSettings({ recruitment: { ...t.state.settings.recruitment, companyThreadId: '16000000' } });
    // stale 4.9.1 checkpoint: old window continuation + old counters
    await new Promise(r => { const q = t.state.db.transaction('forumSyncState', 'readwrite').objectStore('forumSyncState').put({ feedId: 'company', next: 'https://api.torn.com/v2/forum/16000000/posts?sort=DESC&from=1&to=2&offset=980', resumeAvailable: true, counters: { candidatesCreated: 3, candidatesUpdated: 3, postsExamined: 9, pagesChecked: 3 } }); q.onsuccess = r; });
  });
  const first = await page.evaluate(() => RA_V45App._test.syncDomainForums('company'));
  assert.equal(seen[0].searchParams.has('offset'), false, 'first request is page 1, not the stale continuation');
  assert.equal(seen[0].searchParams.get('from') === '1', false);
  assert.ok(seen.every(u => !u.searchParams.has('limit')), 'forum/{id}/posts has no limit param (fixed 20/page)');
  assert.equal(seen.length, 3, 'empty last page ends the run even with a next link');
  assert.equal(first.candidatesCreated, 3);
  assert.equal(first.candidatesUpdated, 0);
  const cp = await getOne(page, 'forumSyncState', 'company');
  assert.equal(cp.next, '', 'empty page clears the continuation');
  seen.length = 0;
  const second = await page.evaluate(() => RA_V45App._test.syncDomainForums('company'));
  assert.equal(seen[0].searchParams.has('offset'), false);
  assert.equal(second.candidatesCreated + second.candidatesUpdated, 0, 'already-seen posts are not counted again');
  assert.equal(seen.length, 1, 'caught up after a fully seen newest page');
  pages[0].unshift(post(4, 9001, now - 5));
  seen.length = 0;
  const third = await page.evaluate(() => RA_V45App._test.syncDomainForums('company'));
  assert.equal(third.candidatesUpdated, 1);
  assert.equal(third.candidatesCreated, 0);
  await page.close();
});

test('L5 Search more resets on Clear and a more-request with different params runs as a fresh search', { timeout: 60000 }, async () => {
  const calls = [];
  const page = await openPage(url => {
    if (url.pathname.startsWith('/v2/forum/')) return { posts: [], _metadata: { links: { next: null } } };
    if (url.pathname !== '/v2/user/search') return null;
    calls.push(url);
    const n = url.searchParams.get('cursor') ? Number(url.searchParams.get('cursor').slice(1)) : 0;
    return { search: Array.from({ length: 25 }, (_, i) => ({ id: 800000 + n * 25 + i, name: `P${n * 25 + i}`, level: 10, faction_id: 0 })), _metadata: { links: { next: `https://api.torn.com/v2/user/search?limit=25&cursor=c${n + 1}` } } };
  });
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-company-search-apply');
  await page.$eval('#ra-company-search-apply', el => { window.__b = el; el.click(); });
  await page.waitForFunction(() => !window.__b.isConnected && document.getElementById('ra-company-search-more'), { timeout: 20000 });
  await page.$eval('#ra-company-search-clear', el => { window.__b = el; el.click(); });
  await page.waitForFunction(() => !window.__b.isConnected, { timeout: 10000 });
  assert.equal(await page.$('#ra-company-search-more'), null, 'Clear hides Search more');
  // a "more" request whose params differ from the last search is a fresh search: forum sync runs and page 1 is fetched
  const synced = await page.evaluate(async () => { let synced = 0; await RA_V45App._test.searchCandidates('company', { onlineStatus: 'Online' }, { syncDomainForums: async () => { synced++; return {}; }, tornRequest: async () => ({ search: [], _metadata: { links: {} } }), persistApiCandidate: async () => {} }, { more: true }); return synced; });
  assert.equal(synced, 1, 'mismatched Search more falls back to a fresh search');
  await page.close();
});

test('L15 Torn error code 5 backs off and retries once, then explains the rate limit', { timeout: 60000 }, async () => {
  let n = 0, mode = 'once';
  const page = await openPage(url => url.pathname === '/v2/user/5/profile' ? (n++ === 0 || mode === 'always' ? { error: { code: 5, error: 'Too many requests' } } : { profile: { id: 5, name: 'Five' } }) : null);
  const ok = await page.evaluate(() => RA_V45App._test.tornRequest('user/5/profile'));
  assert.equal(ok.profile.name, 'Five');
  assert.equal(n, 2);
  mode = 'always'; n = 0;
  const message = await page.evaluate(() => RA_V45App._test.tornRequest('user/5/profile').then(() => 'resolved', e => e.message));
  assert.equal(n, 2, 'only one retry');
  assert.match(message, /too many requests/i);
  assert.match(message, /wait/i);
  await page.close();
});
