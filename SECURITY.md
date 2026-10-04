# Lume security status

Lume is experimental. It has not received an independent security audit, native browser validation or a production release. Do not use it as a primary browser, password vault or store of sensitive data yet.

Never post device tokens, Cloudflare credentials, pairing files, recovery files, browser profiles or signing material in public issues. Before public releases, maintainers must enable a private vulnerability-reporting channel and document a response process. No private reporting channel is currently promised here.

The original upstream security policy is preserved at `lume/docs/UPSTREAM_SECURITY.md`. Vulnerabilities in unmodified upstream Brave/Chromium code should follow upstream's reporting policy. Lume-specific defects must not be represented as defects in Brave or Cloudflare without verification.

See `lume/docs/SYNC.md` for threat-model limitations and `lume/docs/NATIVE-INTEGRATION.md` for release gates.
