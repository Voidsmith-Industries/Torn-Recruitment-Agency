const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'recruitment-agency.user.js');
const WRAPPER = fs.readFileSync(path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js'), 'utf8');
const WRAPPER_HEADER = WRAPPER.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0];
const SOURCE_VERSION = WRAPPER_HEADER.match(/^\/\/ @version\s+(\S+)$/m)[1];

function build() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-userscript.js')], { cwd: ROOT, stdio: 'pipe' });
  return fs.readFileSync(DIST, 'utf8');
}

function split(dist) {
  const match = dist.match(/^(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)\n\n([\s\S]*)$/);
  assert.ok(match, 'dist must start with a metadata block followed by the script body');
  return { header: match[1], body: match[2] };
}

test('GitHub release builder emits one self-contained userscript with no remote runtime requires', () => {
  const dist = build();
  const { header, body } = split(dist);
  assert.match(header, new RegExp(`^// @version\\s+${SOURCE_VERSION.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(header, /^\/\/ @icon\s+data:image\/svg\+xml,/m);
  assert.doesNotMatch(dist, /^\/\/ @require\s+/m);
  assert.doesNotMatch(dist, /@require/);
  // Runtime globals and the installer version constant survive minification.
  for (const name of ['RA_V46DomainCore', 'RA_V47FactionPlatform', 'RA_V45App']) assert.ok(body.includes(name), `${name} missing from bundle`);
  assert.ok(body.includes(`"${SOURCE_VERSION}"`) || body.includes(`'${SOURCE_VERSION}'`), 'installer version constant must be bundled');
  assert.ok(body.includes('data-r4g3-ra-v45-owner'), 'duplicate-instance owner guard must be bundled');
  assert.doesNotThrow(() => new vm.Script(body, { filename: 'recruitment-agency.user.js' }), 'bundle must be valid JavaScript');
});

test('bundled release keeps the metadata block byte-exact and unminified (minus @require lines)', () => {
  const dist = build();
  const expected = WRAPPER_HEADER.split('\n').filter(line => !line.startsWith('// @require')).join('\n');
  assert.equal(split(dist).header, expected);
  assert.ok(dist.startsWith(`${expected}\n\n`));
  const grants = expected.match(/^\/\/ @grant\s+.+$/gm) || [];
  assert.deepEqual(grants.map(line => line.split(/\s+/).pop()), ['GM_xmlhttpRequest'], 'grants must not widen');
  const connects = expected.match(/^\/\/ @connect\s+.+$/gm) || [];
  assert.deepEqual(connects.map(line => line.split(/\s+/).pop()), ['script.google.com', 'script.googleusercontent.com']);
  assert.match(expected, /^\/\/ @match\s+https:\/\/www\.torn\.com\/\*$/m);
  assert.match(expected, /^\/\/ @noframes$/m);
});

test('bundled release preserves Voidsmith website update URLs', () => {
  const dist = build();
  const stable = 'https://voidsmithindustries.com/torn/install/recruitment-agency.user.js';
  assert.ok(dist.includes('// @downloadURL  ' + stable));
  assert.ok(dist.includes('// @updateURL    ' + stable));
});

test('shipped bundle is minified without eval or packing', () => {
  const dist = build();
  const { body } = split(dist);
  const sourceBytes = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'))
    .reduce((sum, f) => sum + fs.statSync(path.join(ROOT, 'src', f)).size, 0);
  assert.ok(Buffer.byteLength(body) < sourceBytes * 0.85, 'body must be smaller than the readable sources');
  assert.doesNotMatch(body, /\/\* bundled runtime:/, 'source comments are stripped');
  assert.doesNotMatch(body, /\beval\s*\(/, 'no eval in the shipped bundle');
  assert.doesNotMatch(body, /\bnew Function\s*\(/, 'no Function constructor in the shipped bundle');
  assert.doesNotMatch(body, /\bFunction\s*\(\s*['"`]/, 'no Function constructor in the shipped bundle');
  assert.doesNotMatch(body, /eval\(function\(p,a,c,k,e,[dr]\)/, 'no p.a.c.k.e.r packing');
  assert.doesNotMatch(body, /\batob\s*\(\s*['"`][A-Za-z0-9+/=]{200,}/, 'no base64-packed code');
});

test('release build is deterministic and the committed dist matches a fresh build', () => {
  const committed = fs.readFileSync(DIST);
  const first = build();
  const second = build();
  assert.equal(second, first, 'same input must produce the same bytes');
  assert.ok(Buffer.from(first, 'utf8').equals(committed), 'dist/recruitment-agency.user.js is stale: run npm run build');
});
