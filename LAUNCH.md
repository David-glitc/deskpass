# Deskpass: launch steps (needs the user's approval; nothing here has been run on mainnet)

1. Decide: use Deskpass as Launchdesk's `desks` address (constructor argument, immutable) or keep `LaunchdeskDesks`. If Launchdesk is already deployed with `LaunchdeskDesks`, Deskpass stands alone: apps and people fund it directly.
2. Deploy (deployer wallet from the user's own secure config; no key is stored in this repo):
   `forge create src/Deskpass.sol:Deskpass --rpc-url https://rpc.botchain.ai --private-key $KEY --broadcast`
3. Write `deployments/mainnet.json` as `{"ready":true,"contracts":{"Deskpass":"0x…"}}`, run `npm run build`, then upload `dist/` (the user chooses the host).
4. Verify on BOTScan, then mint pass #1 yourself (1 BOT, burned) and send a small `fund()` to prove the loop.

## Estimated gas (from `forge test --gas-report`, at 20 gwei)
| Action | Gas | Cost |
|---|---|---|
| Deploy | ~2.72 M | ~0.054 BOT |
| `mint(1)` | ~95–180 k | ~0.002–0.004 BOT + 1 BOT burned |
| `fund()` (first call per asset / later) | ~167 k / ~70 k | ~0.003 BOT |
| `claim` one pass | ~90 k | ~0.002 BOT |
Total to launch with a first mint and fund: about 0.06 BOT plus the 1 BOT burn.

## Decisions for the user
- Prices (1 / 2 / 4 BOT) and the 3,000 cap are constants; change them in the source before deploying, not after.
- Whether Launchdesk should point at Deskpass or `LaunchdeskDesks`.
