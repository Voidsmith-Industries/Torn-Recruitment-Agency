const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');

const V482_PIN='76a95ba6e009dc16682cc8ef2ef689394f65edf8';

test('release package version is 4.8.3',()=>{
  assert.equal(pkg.version,'4.8.3');
});

test('README identifies v4.8.3 as the active distribution release',()=>{
  assert.match(readme,/Recruitment Agency \*\*v4\.8\.3\*\*/);
  assert.match(readme,/Search[^\n]*Results[^\n]*Last Online[^\n]*Message/i);
  assert.match(readme,/END \/ MAN \/ INT/i);
  assert.match(readme,/private chat/i);
  assert.match(readme,/final \*\*Send\*\* entirely manual/i);
  assert.match(readme,/Optional Features/i);
  assert.match(readme,/DB15/);
});

test('README install and history sections describe the released v4.8.3 runtime identity',()=>{
  assert.match(readme,/public userscript metadata and runtime version are \*\*4\.8\.3\*\*/i);
  assert.match(readme,new RegExp(V482_PIN));
  assert.match(readme,/EXPECTED_APP_VERSION[^\n]*4\.8\.3/i);
  assert.match(readme,/\*\*v4\.8\.2\*\*[^\n]*(?:search|forum|api)/i);
  assert.match(readme,/\*\*v4\.8\.0\*\*[^\n]*simplif/i);
  assert.match(readme,/\*\*v4\.7\.6\*\*[^\n]*private-chat Recruit/i);
});