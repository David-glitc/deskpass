// Shared helpers for the wave 3 apps: token metadata, batched reads, BDEX quotes, amounts and countdowns.
import {parseAbi,formatUnits,parseUnits,isAddress,getAddress,encodePacked} from 'viem';
import {client,config,esc,net,link} from './core.js';
export const ZERO='0x0000000000000000000000000000000000000000';
export const DEAD='0x000000000000000000000000000000000000dEaD';
// Multicall3 is deployed at its canonical address on BOT Chain, so many reads cost one RPC round trip.
const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11';
export const erc20=parseAbi(['function symbol() view returns(string)','function name() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function totalSupply() view returns(uint256)','function allowance(address,address) view returns(uint256)']);
export const quoterAbi=parseAbi(['function quoteExactInput(bytes path,uint256 amountIn) returns(uint256 amountOut,uint160[],uint32[],uint256)']);
/** Read many contract calls in one request. Each item: {address,abi,functionName,args}. Failed calls return undefined. */
export async function many(calls){
 if(!calls.length)return [];
 try{const r=await client.multicall({contracts:calls,multicallAddress:MULTICALL,allowFailure:true});return r.map(x=>x.status==='success'?x.result:undefined);}
 catch{return Promise.all(calls.map(c=>client.readContract(c).catch(()=>undefined)));}
}
/** BOT Chain tokens this app knows by name, plus native BOT. */
export const BOT={address:ZERO,symbol:'BOT',name:'BOT (native)',decimals:18};
export const known=[BOT,...(config.tokens||[])];
const cache=new Map(known.map(t=>[t.address.toLowerCase(),t]));
/** Symbol, name and decimals for a token (native BOT for address(0)); cached for the page. */
export async function meta(address){
 const k=String(address).toLowerCase();if(cache.has(k))return cache.get(k);
 const [symbol,name,decimals]=await many(['symbol','name','decimals'].map(functionName=>({address,abi:erc20,functionName})));
 if(decimals===undefined)throw Error(`${address} is not an ERC-20 token on ${net.label}.`);
 const t={address:getAddress(address),symbol:symbol||'TOKEN',name:name||symbol||'Token',decimals:Number(decimals)};cache.set(k,t);return t;
}
export const metas=list=>Promise.all([...new Set(list.map(a=>String(a).toLowerCase()))].map(meta)).then(()=>Object.fromEntries([...cache.entries()]));
export const tokenOf=a=>cache.get(String(a).toLowerCase());
/** A readable amount: thousands separators, at most `dp` decimals, compact for big values. */
export function nice(n,decimals=18,dp=4){
 const v=Number(formatUnits(n??0n,decimals));if(!isFinite(v))return formatUnits(n,decimals);
 if(v!==0&&Math.abs(v)<10**-dp)return `<${(10**-dp).toFixed(dp)}`;
 if(Math.abs(v)>=1e9)return `${(v/1e9).toLocaleString('en-US',{maximumFractionDigits:2})}B`;
 if(Math.abs(v)>=1e6)return `${(v/1e6).toLocaleString('en-US',{maximumFractionDigits:2})}M`;
 return v.toLocaleString('en-US',{maximumFractionDigits:v>=1000?2:dp});
}
export const units=(value,decimals=18)=>{const s=String(value).trim();if(!/^\d+(\.\d+)?$/.test(s)||((s.split('.')[1]||'').length>decimals))throw Error(`Use a positive number with at most ${decimals} decimal places.`);const n=parseUnits(s,decimals);if(n<=0n)throw Error('Amount must be greater than zero.');return n;};
export const checksum=v=>{const s=String(v).trim();if(!isAddress(s))throw Error('Enter a valid 0x address.');return getAddress(s);};
/** A token chip linked to BOTScan (native BOT links to BOT Chain). */
export function chip(t,cls=''){
 const href=t.address===ZERO?'https://www.botchain.ai/':`${net.explorer}/token/${t.address}`;
 return `<a class="tok ${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(t.name)} on ${esc(net.label)}"><i aria-hidden="true">${esc(t.symbol.slice(0,1))}</i>${esc(t.symbol)}</a>`;
}
/** <option>s for the known tokens, plus a "custom address" entry. `skipNative` hides BOT. */
export const tokenOptions=(selected,skipNative=false)=>known.filter(t=>!skipNative||t.address!==ZERO).map(t=>`<option value="${t.address}" ${t.address===selected?'selected':''}>${esc(t.symbol)}</option>`).join('')+'<option value="custom">Other token…</option>';
/** Resolve a token picker: the select's value, or the custom address field next to it. */
export const picked=(f,name)=>f[name]==='custom'?checksum(f[`${name}-custom`]||''):f[name];
export const tokenPicker=(name,label,selected,skipNative=false)=>`<label for="${name}">${esc(label)}</label><div class="pick"><select id="${name}" name="${name}" data-custom="${name}-custom">${tokenOptions(selected,skipNative)}</select><input id="${name}-custom" name="${name}-custom" placeholder="0x… token address" aria-label="${esc(label)} address" hidden></div>`;
/** Show the custom-address input whenever a picker is set to "Other token…". */
export function wirePickers(root=document){
 root.addEventListener('change',e=>{const s=e.target.closest('select[data-custom]');if(!s)return;const i=document.getElementById(s.dataset.custom);i.hidden=s.value!=='custom';i.required=s.value==='custom';if(!i.hidden)i.focus();});
}
/** BDEX V3 path from WBOT to `token`: direct pools first (1%, 0.3%, 0.05%), then two hops through USDT. Returns the best quote. */
export async function bestRoute(token,amountIn){
 const W=config.infrastructure.WBOT,U=config.infrastructure.USDT,fees=[10000,3000,500];
 const paths=fees.map(f=>encodePacked(['address','uint24','address'],[W,f,token]));
 if(token.toLowerCase()!==U.toLowerCase())for(const f1 of [3000,500,10000])for(const f2 of fees)paths.push(encodePacked(['address','uint24','address','uint24','address'],[W,f1,U,f2,token]));
 const quotes=await Promise.all(paths.map(path=>quote(path,amountIn).then(out=>({path,out})).catch(()=>({path,out:0n}))));
 const best=quotes.sort((a,b)=>a.out>b.out?-1:a.out<b.out?1:0)[0];
 return best&&best.out>0n?best:null;
}
export async function quote(path,amountIn){const {result}=await client.simulateContract({address:config.infrastructure.quoter,abi:quoterAbi,functionName:'quoteExactInput',args:[path,amountIn]});return result[0];}
/** Describe a V3 path as "WBOT → 1% → CA". */
export function describePath(path){
 const hex=path.slice(2),out=[];
 for(let i=0;i<hex.length;){out.push(getAddress('0x'+hex.slice(i,i+40)));i+=40;if(i<hex.length){out.push(`${parseInt(hex.slice(i,i+6),16)/10000}%`);i+=6;}}
 return out.map(x=>x.startsWith('0x')?(tokenOf(x)?.symbol||link(x)):`<span class="hop">${x}</span>`).join(' <span aria-hidden="true">→</span> ');
}
/** "3d 4h", "2h 05m", "04:09" style countdowns from seconds. */
export function countdown(s){
 s=Math.max(0,Math.floor(s));const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60,p=v=>String(v).padStart(2,'0');
 return d?`${d}d ${h}h`:h?`${h}h ${p(m)}m`:`${p(m)}:${p(x)}`;
}
export const when=t=>new Date(Number(t)*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
export const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let timer=null;
/** One page-wide 1 s ticker for live countdowns; replaced on every render. Skipped under reduced motion. */
export function tick(fn){clearInterval(timer);if(!reduced())timer=setInterval(fn,1000);}
export const pct=(a,b)=>b>0n?Math.min(100,Number(a*10000n/b)/100):0;
export const optional=html=>html.replace(' required ',' ');
