const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

const ROOT = path.join(__dirname, '..');
const MODULES = ['scout-core.js','results-core.js','global-core.js','match-core.js','forum-core.js','v45-runtime.js','v45-candidates.js','v45-discovery.js','v45-messaging.js','v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-operations.js','v46-company-workflow.js','v46-company-workflow-ui.js','v46-company-opportunity-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-operations.js','v47-faction-workflow.js','v47-faction-workflow-ui.js','v47-faction-opportunity-ui.js','v47-faction-platform.js','v45-app.js'];
const BOOT = sourceCompatibleBoot(ROOT);

function chromePath(){
  for(const cmd of ['google-chrome-stable','google-chrome','chromium-browser','chromium']){
    try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
  }
  throw new Error('No Chrome/Chromium executable found.');
}

function serve(){
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><section><h2>Information</h2><div><button>One</button><button>Two</button></div></section><script>window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>"";window.open=()=>null;</script></body></html>');
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}

function rgb(hex){
  const clean=hex.replace('#','');
  return `rgb(${parseInt(clean.slice(0,2),16)}, ${parseInt(clean.slice(2,4),16)}, ${parseInt(clean.slice(4,6),16)})`;
}

async function visibleLauncher(page){
  await page.waitForFunction(()=>['#ra-sidebar-launcher','#ra-launch'].some(selector=>{const el=document.querySelector(selector);return el&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';}),{timeout:10000});
  return page.evaluate(()=>['#ra-sidebar-launcher','#ra-launch'].find(selector=>{const el=document.querySelector(selector);return el&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';})||'');
}

test('dark theme keeps Recruitment Agency tables and settings readable against hostile Torn text rules',{timeout:60000},async()=>{
  const server=await serve();
  const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1440,height:900});
    await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'load'});

    for(const file of MODULES) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
    await page.addScriptTag({content:BOOT});
    await page.waitForSelector('#ra-app',{timeout:10000});

    const launcher=await visibleLauncher(page);
    assert.ok(launcher,'visible launcher should exist');
    await page.click(launcher);
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ra-app')).display==='block',{timeout:5000});

    await page.evaluate(()=>{
      const hostile=document.createElement('style');
      hostile.id='torn-hostile-text-colors';
      hostile.textContent=`
        table td, table td small, table td select, table td button, table td a,
        .ra-settings summary, .ra-settings label, .ra-settings input,
        .ra-settings select, .ra-settings textarea, .ra-settings option {
          color:#000 !important;
        }
      `;
      document.head.appendChild(hostile);
      const probe=document.createElement('div');
      probe.innerHTML='<table class="ra-table"><tbody><tr><td id="ra-readability-cell">Candidate text <small class="ra-muted" id="ra-readability-muted">123456</small></td><td><select class="ra-btn" id="ra-readability-control"><option>Not Contacted</option></select></td></tr></tbody></table>';
      document.getElementById('ra-content').appendChild(probe);
    });

    const tableColors=await page.evaluate(()=>({
      cell:getComputedStyle(document.getElementById('ra-readability-cell')).color,
      muted:getComputedStyle(document.getElementById('ra-readability-muted')).color,
      control:getComputedStyle(document.getElementById('ra-readability-control')).color
    }));
    assert.equal(tableColors.cell,rgb('#f6f1fb'),'table body text should use the v4.9 high-contrast text token');
    assert.equal(tableColors.muted,rgb('#aaa0b8'),'secondary table text should remain muted but readable');
    assert.equal(tableColors.control,rgb('#f6f1fb'),'table controls should retain high-contrast text');

    await page.click('#ra-settings-button');
    await page.waitForFunction(()=>document.getElementById('ra-page-title')?.textContent==='Settings',{timeout:5000});
    await page.waitForSelector('.ra-settings summary');

    const settingsColors=await page.evaluate(()=>({
      summary:getComputedStyle(document.querySelector('.ra-settings summary')).color,
      label:getComputedStyle(document.querySelector('.ra-settings .ra-field label')).color,
      value:getComputedStyle(document.querySelector('.ra-settings .ra-field select, .ra-settings .ra-field input, .ra-settings .ra-field textarea')).color,
      danger:getComputedStyle(document.querySelector('.ra-settings .ra-danger-zone summary')).color
    }));
    assert.equal(settingsColors.summary,rgb('#d06cff'),'settings section headings should use the v4.9 Voidsmith accent');
    assert.equal(settingsColors.label,rgb('#d06cff'),'settings labels should use the v4.9 Voidsmith accent');
    assert.equal(settingsColors.value,rgb('#f6f1fb'),'settings form values should retain high-contrast text');
    assert.equal(settingsColors.danger,rgb('#e25d63'),'Danger Zone heading should remain red');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
