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
    res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>
      <main id="profile-root">
        <a id="button2-profile-456" class="profile-button profile-button-initiateChat" href="#">Start chat</a>
        <section id="fake-chat" data-user-id="456" hidden>
          <textarea id="fake-chat-input" aria-label="Private chat message"></textarea>
          <button id="fake-send" type="button">Send</button>
        </section>
      </main>
      <script>
        window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';
        window.__chatButtonClicks=0;window.__sendClicks=0;window.__enterKeydowns=0;
        document.getElementById('button2-profile-456').addEventListener('click',event=>{
          event.preventDefault();window.__chatButtonClicks++;
          document.getElementById('fake-chat').hidden=false;
        });
        document.getElementById('fake-send').addEventListener('click',()=>window.__sendClicks++);
        document.getElementById('fake-chat-input').addEventListener('keydown',event=>{if(event.key==='Enter')window.__enterKeydowns++;});
      </script>
    </body></html>`);
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}

test('synthetic Torn profile opens private chat and fills the approved draft without sending it',{timeout:60000},async()=>{
  const server=await serve();
  const port=server.address().port;
  const browser=await puppeteer.launch({executablePath:chromePath(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/profiles.php?XID=456`,{waitUntil:'load'});

    for(const file of MODULES) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'src',file),'utf8')});
    await page.evaluate(()=>{
      const plan=RA_V45Messaging.recruitmentChatPlan('faction','Hello {name}, join {faction_name}.',{userId:456,name:'Bob',faction_name:'Silent Ledger'});
      RA_V45Messaging.queuePrivateChatDraft(plan);
    });
    await page.addScriptTag({content:BOOT});

    await page.waitForFunction(()=>document.getElementById('fake-chat-input').value==='Hello Bob, join Silent Ledger.',{timeout:10000});
    const result=await page.evaluate(()=>({
      chatButtonClicks:window.__chatButtonClicks,
      sendClicks:window.__sendClicks,
      enterKeydowns:window.__enterKeydowns,
      text:document.getElementById('fake-chat-input').value,
      focused:document.activeElement===document.getElementById('fake-chat-input'),
      pending:localStorage.getItem(RA_V45Messaging.PRIVATE_CHAT_DRAFT_KEY)
    }));

    assert.equal(result.chatButtonClicks,1,'Recruit should open the target private-chat surface once');
    assert.equal(result.text,'Hello Bob, join Silent Ledger.');
    assert.equal(result.focused,true,'prepared chat input should be focused for the user');
    assert.equal(result.sendClicks,0,'Recruit must never click Torn Send');
    assert.equal(result.enterKeydowns,0,'Recruit must never synthesize Enter to submit chat');
    assert.equal(result.pending,null,'successful target handoff should consume the one-shot draft');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
