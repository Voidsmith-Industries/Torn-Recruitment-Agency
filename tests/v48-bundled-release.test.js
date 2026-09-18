const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'recruitment-agency.user.js');

function build() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-userscript.js')], { cwd: ROOT, stdio: 'pipe' });
  return fs.readFileSync(DIST, 'utf8');
}

test('GitHub release builder emits one self-contained userscript with no remote runtime requires', () => {
  const dist = build();
  assert.match(dist, /^\/\/ ==UserScript==/);
  assert.match(dist, /@version\s+4\.8\.2/);
  assert.doesNotMatch(dist, /^\/\/ @require\s+/m);
  assert.match(dist, /RA_V46DomainCore/);
  assert.match(dist, /RA_V47FactionPlatform/);
  assert.match(dist, /RA_V45App/);
  assert.match(dist, /const INSTALLER_VERSION = '4\.8\.2'/);
});

test('bundled release preserves Voidsmith GitHub update URLs', () => {
  const dist = build();
  const stable = 'https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Recruitment-Agency/main/dist/recruitment-agency.user.js';
  assert.ok(dist.includes('// @downloadURL  ' + stable));
  assert.ok(dist.includes('// @updateURL    ' + stable));
});
