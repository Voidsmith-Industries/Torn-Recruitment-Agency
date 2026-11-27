const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const boot=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');
const app=fs.readFileSync(path.join(root,'src','v45-app.js'),'utf8');

// v4.9.1 hides Global Intelligence until a hosted service exists: no cross-origin transport is declared or used.
test('Global Intelligence is hidden: the userscript declares no @connect and keeps its single grant',()=>{assert.doesNotMatch(boot,/@connect/);assert.deepEqual(boot.match(/^\/\/ @grant\s+\S+$/gm),['// @grant        GM_xmlhttpRequest']);});

test('the app has no Global Intelligence network transport',()=>{assert.doesNotMatch(app,/GM_xmlhttpRequest/);assert.doesNotMatch(app,/function globalJson|flushGlobalQueue|testGlobalService/);});
