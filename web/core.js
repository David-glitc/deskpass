import {createPublicClient,createWalletClient,custom,http,defineChain,parseAbi,parseUnits,formatUnits,isAddress,getAddress} from 'viem';
// Wallets may return lowercase or non-checksummed addresses; normalize before use.
const norm=a=>a?getAddress(a.toLowerCase()):null;
export const config=APP,abis=ABIS;
export const net=config.net;
export const chain=defineChain({id:net.id,name:net.name,nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},rpcUrls:{default:{http:[config.rpc]}},blockExplorers:{default:{name:net.explorerName,url:net.explorer}}});
export const client=createPublicClient({chain,transport:http(config.rpc,{timeout:20000,retryCount:1})});
export const tokenAbi=parseAbi(['function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)','function deposit() payable','function withdraw(uint256)','function ownerOf(uint256) view returns(address)','function getApproved(uint256) view returns(address)']);
const nftAbi=parseAbi(['function approve(address,uint256)']);
export const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const short=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'—';
export const fmt=(n,decimals=18)=>formatUnits(n,decimals);
export const link=(address,label=short(address))=>`<a href="${net.explorer}/address/${esc(address)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
export const state={account:null,verified:false};
let busy=false,provider=null;const actions=new Map();let nextAction=0;
export function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
export function action(key,fn){actions.set(key,fn);}
export function button(label,fn,primary=false){const id=`a${nextAction++}`;actions.set(id,fn);return `<button type="button" data-action="${id}" ${primary?'class="primary"':''}>${esc(label)}</button>`;}
export const field=(name,label,value='',type='text',attrs='')=>`<label for="${esc(name)}">${esc(label)}</label><input id="${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" required ${attrs}>`;
export const area=(name,label)=>`<label for="${name}">${label}</label><textarea id="${name}" name="${name}" maxlength="2000" required></textarea>`;
export function form(id,body,label,fn){actions.set(id,fn);return `<form data-form="${id}">${body}<button type="submit" class="primary" ${!config.ready?'disabled':''}>${label}</button></form>`;}
export function details(title,content){return `<details><summary>${title}</summary>${content}</details>`;}
export function address(value){if(!isAddress(value))throw Error('Enter a valid 0x address.');return value;}
export function amount(value,decimals=18){if(!/^\d+(\.\d+)?$/.test(value)||((value.split('.')[1]||'').length>decimals))throw Error(`Use a positive number with at most ${decimals} decimal places.`);const n=parseUnits(value,decimals);if(n<=0n)throw Error('Amount must be greater than zero.');return n;}
export function integer(value){if(!/^\d+$/.test(value))throw Error('Use a whole number.');return BigInt(value);}
export const read=(name,fn,args=[],addr=config.contracts[name])=>client.readContract({address:addr,abi:abis[name],functionName:fn,args});
/** Latest block time in seconds. Deadlines use chain time so a skewed device clock cannot break them. */
export const chainTime=async()=>Number((await client.getBlock()).timestamp);

// EIP-6963 discovery lists every installed wallet (BO Wallet, MetaMask, OKX, Rabby…); window.ethereum is the fallback.
const wallets=new Map();
window.addEventListener('eip6963:announceProvider',e=>{if(e.detail?.provider&&e.detail?.info?.uuid)wallets.set(e.detail.info.uuid,e.detail);});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const chainHex='0x'+net.id.toString(16);
const chainParams={chainId:chainHex,chainName:net.name,nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},rpcUrls:[net.rpc],blockExplorerUrls:[net.explorer]};
function choose(){
 const list=[...wallets.values()];if(!list.length&&window.ethereum)list.push({info:{uuid:'injected',name:'Browser wallet'},provider:window.ethereum});
 if(!list.length)throw Error('No wallet found. Install BO Wallet, MetaMask or another EVM wallet, then reload this page.');
 if(list.length===1)return Promise.resolve(list[0]);
 const dialog=$('wallets');$('wallet-list').innerHTML=list.map(w=>`<button type="button" data-wallet="${esc(w.info.uuid)}">${w.info.icon&&/^data:image\/(png|svg\+xml|webp|jpeg);/.test(w.info.icon)?`<img src="${esc(w.info.icon)}" alt="" width="24" height="24">`:''}<span>${esc(w.info.name)}</span></button>`).join('');
 return new Promise((resolve,reject)=>{
  const pick=e=>{const b=e.target.closest('[data-wallet]');if(!b)return;cleanup();dialog.close();resolve(list.find(w=>w.info.uuid===b.dataset.wallet));};
  const cancel=()=>{cleanup();reject(Error('No wallet selected.'));};
  const cleanup=()=>{dialog.removeEventListener('click',pick);dialog.removeEventListener('close',cancel);};
  dialog.addEventListener('click',pick);dialog.addEventListener('close',cancel,{once:true});dialog.showModal();
 });
}
export async function connect(){
 if(!provider){const picked=await choose();provider=picked.provider;
  provider.on?.('accountsChanged',accounts=>{state.account=norm(accounts[0]);$('connect').textContent=state.account?short(state.account):'Connect wallet';run(refresh);});
  provider.on?.('chainChanged',()=>status(`Wallet network changed. Transactions require ${net.label} (${net.id}).`));}
 state.account=norm((await provider.request({method:'eth_requestAccounts'}))[0]);$('connect').textContent=short(state.account);return state.account;
}
export async function addChain(){if(!provider)await connect();try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex}]});}catch(e){if(e.code!==4902&&e?.data?.originalError?.code!==4902)throw e;await provider.request({method:'wallet_addEthereumChain',params:[chainParams]});}status(`Your wallet is on ${net.label} (${net.id}).`);}
async function wallet(){
 if(!state.verified)throw Error(`${net.label} contracts are not available yet. No transaction was sent.`);
 if(!state.account)await connect();
 if(Number(await provider.request({method:'eth_chainId'}))!==net.id)await addChain();
 if(Number(await provider.request({method:'eth_chainId'}))!==net.id)throw Error(`Switch your wallet to ${net.label} (${net.id}).`);
 state.account=norm((await provider.request({method:'eth_accounts'}))[0]);if(!state.account)throw Error('Wallet disconnected.');
 return createWalletClient({account:state.account,chain,transport:custom(provider)});
}
export {wallet};
export async function transact(abi,addr,fn,args=[],value=0n){
 const w=await wallet();status('Checking transaction…');
 const {request}=await client.simulateContract({account:state.account,address:addr,abi,functionName:fn,args,value});
 // 25% gas headroom: tight wallet estimates can fail on first-time storage writes (for example vote checkpoints).
 const gas=await client.estimateContractGas({account:state.account,address:addr,abi,functionName:fn,args,value});
 status('Confirm the transaction in your wallet.');const hash=await w.writeContract({...request,gas:gas*125n/100n});status(`Waiting for confirmation: ${hash}`);
 const receipt=await client.waitForTransactionReceipt({hash,timeout:180000});if(receipt.status!=='success')throw Error(`Transaction reverted: ${hash}`);
 status(`Confirmed: ${hash}`);return receipt;
}
export const tx=(name,fn,args=[],value=0n,addr=config.contracts[name])=>transact(abis[name],addr,fn,args,value);
export async function approve(token,spender,n){await wallet();const allowed=await client.readContract({address:token,abi:tokenAbi,functionName:'allowance',args:[state.account,spender]});if(allowed<n){if(allowed>0n)await transact(tokenAbi,token,'approve',[spender,0n]);await transact(tokenAbi,token,'approve',[spender,n]);}}
// Checks the NFT exists on this chain and belongs to the connected wallet before approving, so a wrong-chain address fails with a clear message.
export async function approveNFT(token,id,spender){
 await wallet();const code=await client.getCode({address:token});
 if(!code||code==='0x')throw Error(`There is no contract at ${token} on ${net.label}. Use an NFT collection deployed on BOT Chain (chain ID ${net.id}); addresses from Ethereum or other chains won't work.`);
 const owner=await client.readContract({address:token,abi:tokenAbi,functionName:'ownerOf',args:[id]}).catch(()=>{throw Error(`Token #${id} doesn't exist in ${token}, or that contract isn't an ERC-721 NFT.`);});
 if(owner.toLowerCase()!==state.account.toLowerCase())throw Error(`Your connected wallet doesn't own token #${id}. Its owner is ${owner}.`);
 const approved=await client.readContract({address:token,abi:tokenAbi,functionName:'getApproved',args:[id]}).catch(()=>null);
 if(approved?.toLowerCase()!==spender.toLowerCase())await transact(nftAbi,token,'approve',[spender,id]);
}
export const wrapForms=()=>details('Wrap or unwrap BOT',form('wrap',field('wrap-amount','BOT to wrap','0.01','text','inputmode="decimal"'),'Wrap BOT',async f=>transact(tokenAbi,config.infrastructure.WBOT,'deposit',[],amount(f['wrap-amount'])))+form('unwrap',field('unwrap-amount','WBOT to unwrap','0.01','text','inputmode="decimal"'),'Unwrap WBOT',async f=>transact(tokenAbi,config.infrastructure.WBOT,'withdraw',[amount(f['unwrap-amount'])])));
/** A BOT Chain asset symbol, linked to its BOTScan token page (BOT links to BOT Chain). Unknown symbols stay plain text. */
export const asset=(symbol,address)=>{const k=String(symbol).toUpperCase(),a=config.assetLinks?.[k];const href=a?.href||(address?`${net.explorer}/token/${address}`:null);return href?`<a class="asset" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(a?.name||symbol)} on BOT Chain">${esc(symbol)}</a>`:esc(symbol);};
export const mine=a=>!!state.account&&a?.toLowerCase()===state.account.toLowerCase();

let product;
async function run(fn){if(busy)return;busy=true;$('workspace').setAttribute('aria-busy','true');try{await fn();await refresh();}catch(e){status(e.shortMessage||e.message||'The request failed. Please retry.',true);}finally{busy=false;$('workspace').removeAttribute('aria-busy');}}
let renderSeq=0;
/** Headline figures in the app bar: [[label, html], …]. Values are trusted HTML built by the product script. */
function stats(list){const el=$('stats');el.hidden=!list;if(list)el.innerHTML=list.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('');}
async function refresh(){
 if(!state.verified){stats(product.stats?.(true));$('records').innerHTML=`<p class="empty">This app is awaiting its ${net.label} contract deployment. Transactions unlock once the deployment is verified.</p>`;return;}
 // A slower, older render (for example from before the wallet connected) must never overwrite a newer one.
 const seq=++renderSeq;$('records').setAttribute('aria-busy','true');
 try{const html=await product.render();if(seq===renderSeq){$('records').innerHTML=html;stats(product.stats?.());product.after?.();}}finally{if(seq===renderSeq)$('records').removeAttribute('aria-busy');}
}
async function boot(){
 if(!config.ready){status(`Deployment pending — ${net.label} transactions are not enabled yet.`);await refresh();return;}
 try{if(await client.getChainId()!==net.id)throw Error('RPC returned an unexpected network.');const code=await client.getCode({address:config.contracts[config.contract]});if(!code||code==='0x')throw Error('The app contract is unavailable.');
  state.verified=true;await product.onVerified?.();status(`Connected to ${net.label}.${net.key==='testnet'?' Test BOT is free from the faucet.':''} Connect your wallet to get started.`);await refresh();}
 catch(e){status(e.shortMessage||e.message,true);stats(product.stats?.(true));$('records').innerHTML='<p class="empty">Could not load onchain data. Use Refresh to retry.</p>';}
}
export function start(p){
 product=p;
 document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)run(actions.get(b.dataset.action));});
 document.addEventListener('submit',e=>{if(!e.target.dataset.form)return;e.preventDefault();const f=e.target;run(()=>actions.get(f.dataset.form)(Object.fromEntries(new FormData(f))));});
 $('connect').onclick=()=>run(connect);$('add-chain').onclick=()=>run(addChain);$('refresh').onclick=()=>run(state.verified?refresh:boot);
 product.controls();
 boot();
}
