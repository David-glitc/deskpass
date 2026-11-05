# Deskpass

A fee-sharing pass for BOT Chain. 3,000 NFTs; each one earns an equal share of everything sent to the contract after it was minted. Minting burns BOT.

## The gap it fills
Wave 3's Launchdesk (a launchpad modeled on otcdesks.cash) sends part of each coin's creator slice to a "desks" pot (`desks.fund()`). The wave 3 `LaunchdeskDesks` contract is a minimal version: BOT only, flat 1 BOT price, no way for other apps to pay in tokens. BOT Chain has no fee-sharing pass that other apps, DAOs or token teams can pay revenue into, in BOT *or* in tokens such as WBOT and USDT. Deskpass is that, and it is a **drop-in replacement for `desks`** (same `fund()` selector, plus a `receive()`).

*Assumed:* because wave 3 already ships `LaunchdeskDesks`, Deskpass is built as its successor rather than a copy. Launchdesk takes `desks` as an immutable constructor argument, so choosing between the two is a deploy-time decision for the user (see LAUNCH.md).

## Contract surface (`src/Deskpass.sol`, 12.8 KB, no owner)
| Function | What it does |
|---|---|
| `mint(count)` payable | 1–10 passes. Price steps with supply: ids 1–1,000 cost 1 BOT, 1,001–2,000 cost 2 BOT, 2,001–3,000 cost 4 BOT. The payment is sent to `0x…dEaD`. |
| `fund()` / `receive()` payable | Add native BOT to the pot. |
| `fundToken(token, amount)` | Add any ERC-20. Credited by balance delta, so fee-on-transfer tokens cannot over-credit. |
| `poke(asset)` | Distribute anything funded before the first pass existed. |
| `claim(asset, ids)` / `claimAll(assets, ids)` | Pay out the pot share of passes you own. `address(0)` is BOT. |
| `claimable(asset, id)`, `assets()`, `priceFor(n)` | Views for the UI. |
| `tokenURI(id)` | On-chain JSON and SVG; the tier (Founder / Floor / Standard) sets the colour. |

Accounting: per asset, a cumulative reward-per-pass accumulator plus an append-only checkpoint list (`minted` at funding time, accumulator). A pass's baseline for an asset is found by binary search, so a pass minted after a funding never shares in it, and an asset needs no registration. Sub-unit remainders carry forward in `dust`, so the contract never owes more than it holds (fuzzed). Rewards belong to the NFT and move with it.

## Fee model
No protocol fee, no owner, nothing upgradable. 100% of mint price is burned; 100% of funding goes to pass holders.
Maximum burn if sold out: 1,000 + 2,000 + 4,000 = **7,000 BOT**.

## Run it
```bash
forge test                       # 14 unit tests + 1 fuzz test + 1 fork test (the fork test no-ops without FOUNDRY_FORK)
FOUNDRY_FORK=true forge test --match-test fork   # real BOT Chain mainnet fork: real burn address, WBOT funding
npm install && forge build
npm run test:web                 # anvil fork + deploy + site build + headless Chromium: connect, mint, fund, claim
npm run build                    # dist/ (static site; reads deployments/mainnet.json once deployed)
```
The web app is the wave 1–3 static stack (`web/core.js`, `web/w3kit.js`, `web/base.css`, bundled with esbuild + viem); product code is `web/products/deskpass.js`.
