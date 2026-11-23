# Changelog

All notable changes to `@mopux/cli` are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-11-22

First release.

- `login` (password without echo or `--with-token`), `logout`, `whoami` and `profiles`.
- `projects list`, `board`, `tasks my`, `task show/create/status/comment` and `notifications`.
- Tables or `--json`; clear messages and exit codes for every API error.
- Tokens in the system keychain (libsecret, macOS Keychain) or a credentials file with permissions 600.
- Single-file executables for Linux, macOS and Windows.
