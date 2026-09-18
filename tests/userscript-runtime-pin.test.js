const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');

const root=path.join(__dirname,'..');
const boot=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');

function fetchText(url){
  return new Promise((resolve,reject)=>{
    https.get(url,res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>{
        if(res.statusCode>=200&&res.statusCode<300) resolve(body);
        else reject(new Error('HTTP '+res.statusCode+': '+url));
      });
    }).on('error',reject);
  });
}

test('published userscript immutable runtime pin matches EXPECTED_APP_VERSION',async()=>{
  const expected=boot.match(/EXPECTED_APP_VERSION\s*=\s*'([^']+)'/)?.[1];
  const requireLine=boot.split('\n').find(line=>/@require\s+https:\/\/raw\.githubusercontent\.com\/Voidsmith-Industries\/Torn-Recruitment-Agency\/[0-9a-f]{40}\/src\/v45-app\.js/.test(line));
  assert.ok(expected,'userscript should declare EXPECTED_APP_VERSION');
  assert.ok(requireLine,'userscript should pin an immutable v45-app.js runtime');
  const url=requireLine.match(/https:\/\/\S+\/src\/v45-app\.js/)?.[0];
  assert.ok(url,'userscript should expose the immutable v45-app.js URL');
  const pinned=await fetchText(url);
  const actual=pinned.match(/SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(actual,'pinned runtime should declare SCRIPT_VERSION');
  assert.equal(actual,expected,'userscript expects runtime '+expected+' but immutable pin '+url.split('/')[6]+' serves runtime '+actual);
});
