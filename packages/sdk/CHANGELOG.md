# Changelog

All notable changes to `@mopux/sdk` are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 - Unreleased

First release.

- Client for the Mopux API v1 (spec 1.2.0): all 71 operations, with types generated from the OpenAPI spec.
- `Mopux.login()`, token functions, `withToken()`.
- `Page` with lazy `iterate…()` helpers; accepts Laravel pagination, page fields and the plain lists of API 1.1.
- Typed errors, including `AuthorizationError.isPlanRestriction()` / `isBillingBlocked()` and `UncertainWriteError`.
- Retries for 429 and failed reads; writes are never retried.
- `Upload` for task documents and comment attachments.
- `MockFetch` in `@mopux/sdk/testing`.
