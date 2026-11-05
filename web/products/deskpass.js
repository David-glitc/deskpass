import {$,config,state,esc,link,form,field,read,tx,start,button,client,abis} from '../core.js';
import {ZERO,nice,units,many,erc20,meta,checksum} from '../w3kit.js';
const C='Deskpass';
let snap={minted:0n,burned:0n,assets:[]};
const tierName=id=>id<=1000n?'Founder':id<=2000n?'Floor':'Standard';
const addr=()=>config.contracts[C];
async function ownedIds(){
 if(!state.account)return [];
 const bal=await read(C,'balanceOf',[state.account]);
 const total=Number(snap.minted),ids=[];
 // Passes are enumerated by ownerOf over 1..minted (<= 3000), batched into one multicall.
 const calls=Array.from({length:total},(_,i)=>({address:addr(),abi:abis[C],functionName:'ownerOf',args:[BigInt(i+1)]}));
 const owners=await many(calls);
 owners.forEach((o,i)=>{if(o&&o.toLowerCase()===state.account.toLowerCase())ids.push(BigInt(i+1));});
 return ids.slice(0,Math.max(Number(bal),0));
}
function controls(){
 $('list-title').textContent='Your passes';
 $('controls').innerHTML='<div class="kiln-head"><span class="eyebrow">Mint</span><h2>Get a pass</h2><p>1 BOT for passes 1–1,000, 2 BOT for 1,001–2,000, 4 BOT for 2,001–3,000. The BOT you pay is burned.</p></div>'
  +form('mint',field('count','How many (1–10)','1','text','inputmode="numeric"'),'Mint and burn BOT',async f=>{
   const n=BigInt(f.count);if(n<1n||n>10n)throw Error('Mint between 1 and 10 passes at a time.');
   const price=await read(C,'priceFor',[n]);await tx(C,'mint',[n],price);})
  +'<h3>Add to the pot</h3><p class="tiny">Anyone can fund. Launchdesk sends here when it is pointed at this contract.</p>'
  +form('fund',field('fund-amount','BOT to send','1','text','inputmode="decimal"'),'Fund with BOT',async f=>{await tx(C,'fund',[],units(f['fund-amount']));});
}
async function render(){
 const [minted,burned,assets]=await many([{address:addr(),abi:abis[C],functionName:'totalMinted'},{address:addr(),abi:abis[C],functionName:'totalBurned'},{address:addr(),abi:abis[C],functionName:'assets'}]);
 snap={minted:minted??0n,burned:burned??0n,assets:[ZERO,...(assets||[]).filter(a=>a!==ZERO)]};
 if(!state.account)return '<p class="empty">Connect your wallet to see your passes and what they have earned.</p>';
 const ids=await ownedIds();
 if(!ids.length)return `<p class="empty">You hold no passes yet. ${Number(snap.minted)} of 3,000 are minted.</p>`;
 const sym=async a=>a===ZERO?'BOT':(await meta(a)).symbol;
 const dec=async a=>a===ZERO?18:(await meta(a)).decimals;
 const rows=await Promise.all(ids.map(async id=>{
  const earned=await many(snap.assets.map(a=>({address:addr(),abi:abis[C],functionName:'claimable',args:[a,id]})));
  const parts=[];for(let i=0;i<snap.assets.length;i++){if(earned[i]>0n)parts.push(`${nice(earned[i],await dec(snap.assets[i]))} ${esc(await sym(snap.assets[i]))}`);}
  return `<article class="card"><h3>Pass #${id} · ${tierName(id)}</h3><p>${parts.length?parts.join(' · '):'Nothing to claim yet'}</p></article>`;
 }));
 return `<div class="furnaces">${rows.join('')}</div><p>${button('Claim everything',async()=>{
  await tx(C,'claimAll',[snap.assets,ids]);},true)}</p>`;
}
function stats(empty){return [['Minted',empty?'—':`${snap.minted} / 3,000`],['BOT burned',empty?'—':nice(snap.burned)],['Funded assets',empty?'—':String(Math.max(snap.assets.length-1,1))]];}
start({controls,render,stats});
