# Security

## Reporting a vulnerability

Please report privately through GitHub's
[security advisory form](https://github.com/roil13/pdf-tools/security/advisories/new)
rather than opening a public issue. If that is unavailable to you, email
lior.yosub@gmail.com.

This is a spare-time project, so please don't expect a same-day reply. You will
get an acknowledgement, and credit in the fix unless you'd rather not have it.

## What the threat model actually is

The app is offline and local. It makes no network requests, has no accounts, no
telemetry and no server, so most of the usual categories do not apply. What is
worth reporting:

- **Anything that makes the app read or write outside what the user chose.**
  The renderer has no filesystem access and goes through a typed IPC surface in
  `electron/preload.ts`; `electron/protocol.ts` serves the UI over a custom
  scheme with path-traversal checks (`test/protocol.test.ts`).
- **A crafted PDF that causes something worse than an error.** Inputs are
  untrusted by definition. qpdf and pdf.js do the parsing; if a malformed file
  gets further than a toast, that is worth knowing.
- **Anything that sends data anywhere.** There is no case where this app should
  open a socket. If you find one, it is a bug regardless of what it does.

Vulnerabilities in qpdf, pdf.js, Tesseract or Electron themselves are best
reported upstream; tell us too, so the vendored copies can be updated.
