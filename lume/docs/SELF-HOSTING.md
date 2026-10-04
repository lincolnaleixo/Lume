# Self-hosting Lume Sync

## Isolation model

Every owner deploys a separate Worker into their own Cloudflare account. The Durable Object namespace is created by Wrangler migrations. No manual database ID, R2 bucket, KV namespace or central Lume account is needed. Multiple installations in the same account require different Worker names and separate local setup directories.

The checked-in `wrangler.json` is a public template. `setup init` generates a separate `.local/wrangler.json` and `.local/owner-recovery.json`. `.local` is mode 0700 and secret files are mode 0600 on POSIX systems. On Windows, verify the directory's ACLs manually. The script never prints credentials.

## Setup

1. Install Node.js 22.13+ and clone the repository. Run commands from `lume/`, not the Brave repository root.
2. Run `npm test`, then `npm run setup -- init`. Choose a Worker name. Supplying a Cloudflare account ID is optional.
3. Securely back up `.local/owner-recovery.json` before continuing.
4. Run `npm run setup -- deploy`. Review the Cloudflare account selected by Wrangler. The Worker initially fails closed until the administrative secret has been set.
5. Paste your Worker HTTPS origin when prompted, such as the `workers.dev` origin printed by Wrangler. No custom domain is needed.
6. Run `npm run setup -- pair` separately for each device. Open the Worker URL and import that device's pairing file. AirDrop or another private transport is appropriate; a public repository or issue is not.

The profile console includes its own static assets. It has no external analytics, fonts, scripts, advertisements, Brave profile services or Cloudflare account credentials in the client bundle.

## Device administration

```sh
npm run setup -- devices
npm run setup -- revoke DEVICE_ID
```

Revocation removes future API access, not data the device already downloaded. The encryption key is shared among one owner's devices. Compromise of that key requires rekeying into a new vault; automated rotation is not implemented. The recovery file contains stronger authority than an ordinary device pairing file and must never be imported into the web UI.

## Free-tier suitability

Cloudflare's documented Workers Free plan supports SQLite-backed Durable Objects. The documented allowance includes 100,000 DO requests/day, 100,000 written rows/day, five million read rows/day and 5 GB total SQLite storage. Worker limits also apply. Each transaction writes more than one row, so the write allowance is not the same as the number of edits. Authentication, polling, indexes and concurrent devices consume resources too.

The intended workload is a small number of one owner's devices and small settings records. Staying free is a workload expectation, not a guarantee. Verify your dashboard limits and current pricing. Do not enable a paid plan accidentally. This project does not deploy a central service or pay for anyone else's usage. Foreground polling is currently every 20 seconds per open console; hidden tabs stop polling.

References checked 2026-10-04:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/binding/

## Backups and recovery limits

The console exports the locally downloaded encrypted operation log, including pending edits. It does not include the encryption key or token. Keep the owner recovery file separately. An export can be incomplete until the client has downloaded the whole log. The console does not yet provide a restore wizard or tested full-server disaster recovery.

The server keeps operations indefinitely in this version. Do not manually prune them: old clients, retries and causal parents depend on that history. Compaction requires a new protocol with device watermarks and snapshots. Native browser passwords, cookies, active sessions and caches are not synced.

## Before sharing the service URL

The URL itself is not a secret, but tokens and pairing files are. No anonymous vault creation or profile listing is exposed. Abuse protection beyond authentication and request-size limits, security review, native credential storage, disaster recovery and operational alerts remain production-readiness work. Use synthetic data while testing.
