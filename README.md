# Mopux JavaScript

Official TypeScript packages for the [Mopux](https://www.mopux.com) API.

| Package | Description |
| --- | --- |
| [`@mopux/sdk`](packages/sdk) | Client for the Mopux API v1 |
| [`@mopux/cli`](packages/cli) | `mopux` command line client |

Requires Node.js 24 or 26.

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Releases: bump the version in the package (`package.json` and `src/version.ts`), update its changelog and push a tag: `sdk-vX.Y.Z` for `@mopux/sdk`, `cli-vX.Y.Z` for `@mopux/cli`. GitHub Actions runs the checks and stages the version on npm through trusted publishing (no tokens); a maintainer approves it on npmjs.com with 2FA before it becomes public. CLI releases also attach the executables built with Bun and their `SHA256SUMS`.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
