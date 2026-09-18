const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const userscript = fs.readFileSync(path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js'), 'utf8');
const STABLE_URL = 'https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Recruitment-Agency/main/dist/recruitment-agency.user.js';

test('v4.8 migration release points future userscript updates at Voidsmith GitHub', () => {
  assert.ok(userscript.includes('// @downloadURL  ' + STABLE_URL));
  assert.ok(userscript.includes('// @updateURL    ' + STABLE_URL));
});

test('v4.8 release metadata keeps a single stable update authority', () => {
  const updateLines = userscript.match(/^\/\/ @(?:downloadURL|updateURL)\s+.+$/gm) || [];
  assert.equal(updateLines.length, 2);
  for (const line of updateLines) assert.ok(line.endsWith(STABLE_URL), line);
});
