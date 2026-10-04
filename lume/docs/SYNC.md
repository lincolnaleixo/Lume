# Lume Sync protocol v1

## Storage and authorization

A Worker routes the authenticated API to a single SQLite-backed Durable Object named `owner-vault-v1`. Each deployment has its own namespace. Every paired device receives an independent random 256-bit bearer token. Only SHA-256 token digests are stored in `devices`. An independent Cloudflare secret authorizes registration and revocation. The admin secret and vault encryption key are different values.

Endpoints:

| Method | Path | Authorization |
| --- | --- | --- |
| GET | `/health` | Public, no profile data |
| POST / GET | `/api/v1/devices` | Admin token |
| DELETE | `/api/v1/devices/:id` | Admin token |
| GET | `/api/v1/changes?after=N` | Non-revoked device token |
| POST | `/api/v1/operations` | Non-revoked device token |

All API replies are non-cacheable. Requests with a foreign Origin are rejected. The console is hosted on the same origin. Native clients can use ordinary HTTPS requests without a browser Origin header. There is no wildcard CORS and no authentication through a guessable profile name.

## Encrypted records

A record is an independently editable field. Profile labels live in the `catalog` profile, keyed by random profile IDs. Settings use one entity per field. Bookmark integrations should use independent bookmark IDs and fields, not serialize the entire bookmark tree into one last-write-wins blob. Portable settings need an explicit allowlist.

An operation is `{id, profile, entity, parents, envelope}`. IDs are stable across retries. `envelope` is `{v:1, iv, ct}` using AES-256-GCM, a fresh 96-bit random nonce, and base64url ciphertext including the authentication tag. AAD is the UTF-8 JSON encoding of `[1, id, profile, entity, sortedParents]`. Replacing an ID, parent list or profile invalidates the ciphertext. Nonces come from Web Crypto, never from timestamps.

The server sees opaque profile IDs, field identifiers, operation IDs, ciphertext sizes, causal relationships and device labels. It does not receive decrypted names or setting values. This is not metadata anonymity. Device labels should not include sensitive details.

## Concurrency

`parents` is the set of versions observed for that exact field when the edit was made. The server appends each operation and removes only those parents from the current heads in a synchronous SQLite transaction. Unknown parents and parents from another field/profile are rejected. Concurrent unobserved edits remain as multiple heads. Independent fields merge automatically.

The client reducer uses observed-remove multi-value registers. It removes any known operation mentioned as a parent and retains unobserved heads. It is independent of wall-clock timestamps and converges under reordered or duplicated delivery. A resolution is a new operation naming all observed conflicting heads. The previous versions remain in the encrypted history.

No automatic winner is silently selected for conflicting values. Two people can still independently create profiles with the same display name; UUIDs keep them distinct and the UI can list both. A label must never be used as a storage path or sole database key.

## Crash/retry safety

The client persists an encrypted outbox before contacting the server. Server acknowledgement alone never discards an edit: the client pulls it back from the committed log before clearing the outbox. Lost responses are harmless because operation IDs are idempotent. Reusing an ID with different content, or from another device, is rejected.

Changes are paginated by server-assigned sequence. Every received envelope is authenticated before advancing the persisted cursor. A server reset or cursor moving past the available log is an explicit error, not a reason to silently wipe client data. The browser console uses Web Locks to serialize writers across tabs and IndexedDB transactions for persistence. The native integration must provide equivalent serialization and durable storage.

Limits: 128 KiB request body, 32 operations per API batch, 64 parents per operation, 32 KiB encoded ciphertext and 64 active devices. The SDK sends at most four locally bounded records per batch. These limits are not intended for photos, downloads, cookies or full browser profile directories.

## Threat model and limitations

HTTPS, a trusted local device and a trusted console build/origin are required. Client-side encryption does not protect against an attacker who replaces the console JavaScript or compromises an unlocked device. A non-extractable web CryptoKey prevents ordinary key export, not unauthorized use by injected scripts. The future native apps must keep keys outside renderer-controlled JavaScript and enforce IPC origin/capability boundaries.

The server can deny service or roll back to a previous history. Instance/cursor checks catch common resets, not every malicious rollback. Cryptographic transparency, authenticated state roots and rollback-resistant checkpoints are not implemented. All of one owner's authorized devices share the key and can write all profiles. There are no per-profile permissions or multi-user invitations.

Local tests execute the actual Worker handler against SQLite using a Durable Object state adapter. They cover authentication, revocation, malformed input, atomic rollback, duplicates, offline outbox recovery, ciphertext authentication and concurrent edits. They do not certify the Cloudflare production runtime, native browser integration, JIT entitlements, network conditions, iOS background execution or a full cryptographic audit.
