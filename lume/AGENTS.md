# Lume contributor instructions

- Read the root README and docs/NATIVE-INTEGRATION.md before claiming a feature is complete.
- Run `npm --prefix lume test`, `npm --prefix lume run check`, and `npm --prefix lume run verify:browser`.
- Never store credentials, personal profile data, signing files or pairing/recovery files in this repository, commits, logs or issues.
- All instances use the operator's own Cloudflare account. No developer-owned production endpoint or central identity service may be hardcoded.
- Profile names are labels; device possession authorizes access. No anonymous profile discovery or name-as-password design.
- Keep unacknowledged operations durable. Preserve conflicting versions. Never claim perfect or conflict-free sync without qualifications.
- Make small exact-match upstream patches. Keep upstream copyright and third-party notices. Do not remove security cryptography when removing cryptocurrency features.
- Do not disable Chromium security, signature validation, HTTPS checks, sandboxing or Shields to make a test pass.
- A responsive profile console is not a native browser integration. Native compilation and physical-device tests are separate gates.
- Brave Sync protobuf is not this JSON protocol. Do not simply point the Brave Sync endpoint at this Worker.
- Native builds require their own credentials, entitlements and substantial local build resources. Never publish an untested binary as a release.
