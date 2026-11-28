const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','src','v45-app.js'),'utf8');

test('v4.9.2 core runtime reports the v4.9.2 release version',()=>{
  assert.match(app,/SCRIPT_VERSION\s*=\s*'4\.9\.2'/);
  assert.match(app,/Recruitment Agency v\$\{SCRIPT_VERSION\} source started/);
});
