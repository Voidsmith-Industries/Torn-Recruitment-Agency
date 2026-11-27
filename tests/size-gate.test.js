const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Upper bound for the bundled userscript. Lower it as the bundle shrinks; never raise it without a reason.
const MAX_DIST_KIB = 250;
const DIST = path.join(__dirname, '..', 'dist', 'recruitment-agency.user.js');

test(`bundled userscript stays at or below ${MAX_DIST_KIB} KiB`, () => {
  const bytes = fs.statSync(DIST).size;
  assert.ok(bytes <= MAX_DIST_KIB * 1024, `dist is ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB), limit ${MAX_DIST_KIB} KiB`);
});
