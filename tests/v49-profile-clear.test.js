const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('v4.9 Results profiles have an explicit clear path in both recruitment domains',()=>{
  const app=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  const company=fs.readFileSync(require.resolve('../src/v46-company-platform'),'utf8');
  const faction=fs.readFileSync(require.resolve('../src/v47-faction-platform'),'utf8');

  assert.match(app,/setActiveMatchProfile:async profileId=>\{const id=text\(profileId\);if\(!id\)\{await saveSettings\(\{match:\{\.\.\.state\.settings\.match,activeProfileId:''\}\}\);return null;\}/);
  assert.match(company,/ra-company-profile-clear/);
  assert.match(company,/setActiveMatchProfile\(''\)/);
  assert.match(company,/runtime\.searchFilters=\{\.\.\.DEFAULT_SEARCH_FILTERS\}/);
  assert.match(faction,/ra-faction-profile-clear/);
  assert.match(faction,/activeResultsProfileId:''/);
  assert.match(faction,/runtime\.searchFilters=\{\.\.\.DEFAULT_SEARCH_FILTERS\}/);
});
