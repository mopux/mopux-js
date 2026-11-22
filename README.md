# Mopux JavaScript

Official TypeScript packages for the [Mopux](https://www.mopux.com) API.

| Package | Description |
| --- | --- |
| [`@mopux/sdk`](packages/sdk) | Client for the Mopux API v1 |

Requires Node.js 24 or 26.

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Releases: bump the version in `packages/sdk/package.json` and `packages/sdk/src/version.ts`, update the changelog and push a `vX.Y.Z` tag. GitHub Actions runs the checks and stages the version on npm through trusted publishing (no tokens); a maintainer approves it on npmjs.com with 2FA before it becomes public.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
