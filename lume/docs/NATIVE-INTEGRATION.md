# Native integration and release gates

## Current boundary

This is a real source fork of Brave Core plus a working standalone profile-sync service and console. It is not yet a completed cross-platform browser. The new SDK is not registered with Chromium's ProfileManager, PrefService, BookmarkModel or the Brave iOS profile lifecycle. Native UI cannot yet create/open these cloud profiles. A standalone console working in Safari is not evidence that native iPhone/iPad sync is implemented.

## Required implementation order

### 1. Desktop bridge

- Retain local Chromium profiles. Map each immutable Lume profile UUID to a distinct native profile directory; names are display labels only.
- Add a trusted browser-process service for token/key storage and HTTPS sync. macOS Keychain, Windows protected credential storage and Linux's supported keyring integration are platform-specific adapters, not files copied between OSes.
- Use an explicit portable-pref allowlist. Never upload the raw `Preferences`, `Local State`, SQLite profile databases, cache, `Login Data`, cookies or OS-bound encryption keys.
- Observe local preference/bookmark changes. Journal an encrypted operation before sending. Prevent feedback loops when applying downloaded state. Store applied operation IDs and cursor atomically with native changes.
- Implement `lume://profiles` with profile list, search, last-sync status, device enrollment and retained-conflict UI. Call native profile APIs instead of shelling out with a user-supplied name.
- Split bookmark fields, preserve stable IDs and validate parent references/cycles. Treat tab sessions per-device so closing one window does not erase another device's session.
- Implement password sync only after a dedicated security design and tests; it is intentionally excluded from v0.1.

### 2. iOS and iPadOS

- Start with the imported upstream WebKit implementation. Build/sign using the owner's Apple Developer team, unique bundle IDs, app groups and keychain access groups. Do not retain Brave's signing identity.
- Implement genuinely isolated native profile stores and prove cookies, local storage, IndexedDB, history and open tabs cannot bleed between profiles. Web views must use appropriate persistent data stores; swapping a title or bookmarks is not profile isolation.
- Use CryptoKit or a reviewed shared native implementation compatible with the published AES-GCM test vectors. Keep tokens/keys in the Keychain, not arbitrary WKWebView page JavaScript.
- Implement outbox persistence, foreground/reconnect sync and OS-permitted background work. Do not promise continuous syncing while iOS suspends or terminates the app.
- Test on both a physical iPhone and iPad. The ordinary developer account supports development provisioning but does not itself authorize Blink/JIT/BrowserEngineKit.

### 3. Optional Blink target

Apple's alternative-browser-engine entitlements and the corresponding native port are a separate gate. A ChromiumWebView abstraction is not proof that the actual renderer is Blink. Do not label a WebKit build as Blink and do not automatically enable experimental JIT workarounds.

Reference: https://developer.apple.com/support/alternative-browser-engines/

### 4. Finish no-crypto and branding audit

Source defaults now disable `enable_brave_wallet`, `enable_brave_rewards` and `enable_brave_ads`. Brave Sync is off by default and its old endpoint is disabled. Shields remains in the source. These are source changes, not proof of a successful build on every target.

Before a release, inspect compiled desktop and iOS UI, first-run screens, settings, menus, wallet providers injected into pages, token banners, sponsored new-tab cards, Web3 resolution integrations and background requests. Swift/Xcode flags and UI can differ from desktop GN flags. Do not blindly delete every directory named `crypto`: that would break security libraries.

Complete all platform identities: icons, installer/product IDs, Windows GUIDs/registry paths, Linux package names, Android application IDs, iOS bundle IDs/app groups, signing and update keys. The current macOS branding changes are not a full installer audit. Never replace an existing Brave install or reuse its profile directory.

### 5. Release gate

- Successfully compile and run native desktop and iOS/iPadOS builds.
- Prove isolation with two profiles using the same site with different signed-in accounts.
- Test concurrent offline edits, duplicates, device clock skew, interrupted writes, keychain lock, quotas, server failures and restored backups.
- Build a recovery/restore flow, durable state migrations, storage compaction and supported key rotation.
- Independent security review of crypto/protocol/IPC, endpoint abuse controls and the handling of secrets in crash logs.
- Own signed updater, rollback protection, manual recovery path and rapid Chromium security-patch uptake.
- Audit that no profile data reaches Brave or Google. Preserve useful security services and adblock-list updates deliberately; do not claim the entire browser has zero third-party dependencies.

Only after these gates can the repository honestly advertise a ready-to-use Lume browser. Do not change `native_build_verified` in the provenance file merely because JavaScript tests pass.
