// End-to-end rehearsal on a local anvil fork of BOT Chain mainnet: deploy, build the site against it, drive it in headless Chromium
// with an injected wallet (anvil's unlocked dev account). Needs `forge`, `anvil`, a built `out/` and `npm i`. No real keys, no mainnet writes.
import {spawn,execFileSync} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),PORT=8677,SITE=8778,RPC=`http://127.0.0.1:${PORT}`;
const DEV='0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',DEVKEY='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil's public dev key
const sh=(c,a)=>execFileSync(c,a,{cwd:root,encoding:'utf8'}).trim();
const anvil=spawn('anvil',['--fork-url',process.env.BOT_FORK_URL||'https://rpc.botchain.ai','--port',String(PORT),'--silent'],{stdio:'ignore'});
let server,browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'})).ok)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 const out=sh('forge',['create','src/Deskpass.sol:Deskpass','--rpc-url',RPC,'--private-key',DEVKEY,'--broadcast']);
 const address=out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1];
 fs.mkdirSync(path.join(root,'deployments'),{recursive:true});
 const journal=path.join(root,'deployments','local-rehearsal.json');fs.writeFileSync(journal,JSON.stringify({ready:true,contracts:{Deskpass:address}}));
 execFileSync('node',['web/build.mjs'],{cwd:root,env:{...process.env,BOT_RPC_URL:RPC,DESKPASS_JOURNAL:journal},stdio:'inherit'});
 server=http.createServer((q,r)=>{let f=path.join(root,'dist',q.url.split('?')[0]);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)){r.statusCode=404;return r.end();}
  r.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f));}).listen(SITE);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await (await browser.newContext({viewport:{width:390,height:900}})).newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({rpc,dev})=>{const call=(method,params=[])=>fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(r=>r.json()).then(j=>{if(j.error)throw Object.assign(new Error(j.error.message),{code:j.error.code});return j.result;});
  window.ethereum={request:async({method,params})=>method==='eth_requestAccounts'||method==='eth_accounts'?[dev]:call(method,params),on(){},removeListener(){}};},{rpc:RPC,dev:DEV});
 await page.goto(`http://127.0.0.1:${SITE}/app/`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#stats')?.textContent.includes('/ 3,000'),null,{timeout:30000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflows at 390px');
 await page.click('#connect');
 await page.waitForFunction(()=>document.querySelector('#records')?.textContent.includes('no passes')||document.querySelector('#wallet-list button'),null,{timeout:15000});
 if(await page.locator('#wallet-list button').count())await page.locator('#wallet-list button').first().click();
 await page.waitForFunction(()=>document.querySelector('#records')?.textContent.includes('no passes'),null,{timeout:15000});
 await page.fill('#count','2');await page.click('form[data-form="mint"] button[type=submit]');
 await page.waitForFunction(()=>document.querySelector('#records')?.textContent.includes('Pass #2'),null,{timeout:60000});
 await page.fill('#fund-amount','4');await page.click('form[data-form="fund"] button[type=submit]');
 await page.waitForFunction(()=>document.querySelector('#records')?.textContent.includes('2 BOT')||document.querySelector('#records')?.textContent.includes('2.0 BOT'),null,{timeout:60000});
 const text=await page.locator('#records').innerText();assert.match(text,/pass #1/i);
 await page.getByRole('button',{name:'Claim everything'}).click();
 await page.waitForFunction(()=>document.querySelector('#records')?.textContent.includes('Nothing to claim yet'),null,{timeout:60000});
 assert.deepEqual(errors,[],'page errors');
 console.log('deskpass web check: connect, mint, fund, claim all passed');
}finally{await browser?.close();server?.close();anvil.kill();}
