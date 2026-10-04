# Lume

**Your browser. Your profiles. Your cloud.**

Lume is an early source fork of Brave with cryptocurrency features disabled by default and an independently self-hosted profile-sync foundation. Anyone can deploy their own sync instance to their own Cloudflare account. There is no shared Lume backend, email login, Google account, or Brave Sync account.

> **Development status, 4 October 2026:** this repository contains the Brave source snapshot, Lume source policies, a runnable encrypted sync service, a responsive profile console, and protocol tests. It is **not yet a finished browser release**. The console is **not wired into native browser profiles**. Native desktop/iPhone/iPad builds, complete UI rebranding and native integration have not been validated. Do not use it as your primary browser or password vault yet.

## What is implemented

| Area | Current state |
| --- | --- |
| Browser source | Brave Core v1.96.61, Chromium 154.0.8037.98; pinned source snapshot |
| Cryptocurrency policies | Wallet, Rewards and Brave Ads build defaults set to false; source checks in CI |
| Brave Sync | Disabled by default; old endpoint replaced with a non-routable `.invalid` address |
| Lume branding | Product name, macOS bundle ID and product directory; installer and full iOS branding still pending |
| Browser protection | Shields source retained; no deliberate removal of adblocking, HTTPS, certificate checks or the sandbox |
| Independent sync | Worker plus SQLite-backed Durable Object, per-device authorization and revocation |
| Encryption | Client-side AES-256-GCM; even profile names are encrypted before storage |
| Profile console | Create, search, archive profiles and sync preferences; responsive for desktop, iPhone and iPad |
| Reliability foundation | Durable outbox, atomic batches, operation IDs, cursor pagination and retained concurrent versions |
| Native browser integration | **Not implemented yet**; see [native integration plan](lume/docs/NATIVE-INTEGRATION.md) |
| Installable browser binaries | **Not built or signed** |

## Deploy to your own Cloudflare account

Only the sync service requires Cloudflare. It has no connection to the repository owner's account. No account IDs or secrets are hardcoded. Node.js 22.13+ is required.

```sh
git clone https://github.com/lincolnaleixo/Lume.git
cd Lume/lume
npm test
npm run setup -- init
npm run setup -- deploy
npm run setup -- pair
```

The deployment command opens Cloudflare's own Wrangler login. It deploys only to the account you select. The pairing command creates a private file in `lume/.local/`. Open your Worker URL on the device and import the file once. Later, just choose a profile by name. Create a separate pairing file for each device so you can revoke it individually.

**Keep `lume/.local/owner-recovery.json` offline and private.** It includes the encryption key and an administration token. It is gitignored. Never commit it, attach it to an issue or include it in a public build. No key recovery is possible from the server alone.

[Full self-hosting guide](lume/docs/SELF-HOSTING.md) · [Protocol and threat model](lume/docs/SYNC.md) · [Native integration and release gates](lume/docs/NATIVE-INTEGRATION.md)

## No email or password is not the same as no authentication

A profile name is a label, not an access credential. A device is paired once with a random token and encryption key. The web console stores a non-extractable CryptoKey in IndexedDB. The future native clients must use platform credential storage. There is no public endpoint for listing or retrieving profiles by name.

Each self-hosted instance currently belongs to **one owner**. All that owner's paired devices can access all their profiles. Independent people should deploy independent instances. This is not a multi-user sharing service.

## What reliable sync means here

Edits to separate fields coexist. Concurrent edits to the same field retain multiple versions until explicitly resolved. A late request cannot silently erase an unobserved edit. The outbox survives a lost response and retry. Deleted data uses tombstones in the encrypted payload, not destructive deletion of the operation history.

No system can truthfully promise zero conflicts, no bugs, perfect synchronization. These tests validate specific failure cases, not every possible failure. Background synchronization on suspended iOS apps, log compaction, complete disaster recovery and native browser migrations remain work to do.

## Native browser development

Brave's checkout must live at `YOUR_WORKSPACE/src/brave`. To work on the browser rather than only the sync service:

```sh
mkdir -p lume-workspace/src
git clone https://github.com/lincolnaleixo/Lume.git lume-workspace/src/brave
cd lume-workspace/src/brave
# First install upstream OS/compiler prerequisites.
# Use the pnpm version specified by the upstream package.json.
pnpm install --frozen-lockfile
pnpm run init
pnpm run build
```

This fetches large Chromium dependencies. It is **not** part of sync-service setup or routine CI. Build and signing requirements are in the [upstream instructions](https://github.com/brave/brave-core/tree/v1.96.61). Do not install an unvalidated package over Brave. Use a separate development user-data directory. macOS auto-update from Brave is deliberately disabled so it cannot replace Lume with a Brave binary; a signed Lume updater and security-update procedure are still required.

For iOS/iPadOS, the imported upstream build uses its existing WebKit path. A Blink build is a separate experimental target and requires the applicable Apple browser-engine entitlements. An ordinary paid developer membership does not grant those entitlements automatically.

## Repository layout

The root contains real Brave Core source, not an Electron/WebView replacement. Lume additions are under `lume/`. `upstream/brave-core` preserves the initial imported source snapshot. `.github/workflows/lume-ci.yml` checks the new code without deploying to anyone's account.

This existing GitHub repository was initialized with a **source snapshot**, not GitHub's native Fork operation. It does not have a forked-from badge or the full upstream commit history. [Provenance](lume/browser/upstream.json) records the exact upstream commit. Future updates must be reviewed and tested, not automatically merged by an agent.

## License and attribution

Original upstream and third-party licenses and copyright notices are retained. New Lume code uses MPL-2.0. See upstream `LICENSE` / `LICENSE.html` as present in the source tree and [Mozilla's license text](https://www.mozilla.org/MPL/2.0/). Brave and related marks belong to their respective owners; Lume is not affiliated with Brave Software or Cloudflare. Cryptocurrency removal does **not** mean removing cryptography needed for HTTPS, privacy or encrypted sync.
