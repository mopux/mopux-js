# Releasing

`@mopux/sdk` and `@mopux/cli` are released independently. A tag starts the release; GitHub Actions stages the package on npm with trusted publishing (OIDC, no tokens) and a maintainer approves it on npmjs.com.

## Steps

1. Update the version of the package you release, in every place:
   - `packages/<pkg>/package.json` (`version`);
   - `packages/sdk/src/version.ts` (`VERSION`), for the SDK;
   - `package-lock.json`: run `npm install` after the bump;
   - if the SDK minor changes, the `@mopux/sdk` range in `packages/cli/package.json` (with 0.x, `^0.1.0` does not accept `0.2.0`), then `npm install` again.
2. Move the `Unreleased` notes of `packages/<pkg>/CHANGELOG.md` under `## X.Y.Z - YYYY-MM-DD`.
3. Check locally: `npm run lint && npm run typecheck && npm test && npm run build`.
4. Commit (`chore: @mopux/sdk X.Y.Z`), tag and push the branch and the tag:
   ```sh
   git tag -a sdk-vX.Y.Z -m "sdk-vX.Y.Z"   # or cli-vX.Y.Z
   git push --atomic origin main sdk-vX.Y.Z
   ```
5. The `release` workflow checks that the tag matches `package.json`, runs the checks, runs `npm stage publish` and creates the GitHub release.
6. Approve the staged version on npmjs.com → **Staged packages** (it asks for your passkey). It goes live on npm a few minutes later.

## If something fails

- **E403 «OIDC permission denied»:** the trusted publisher of the package on npmjs.com must be `mopux/mopux-js`, workflow `release.yml`, environment `npm`. Staging is always allowed; `npm publish` is not.
- **E404 on PUT:** the package has no trusted publisher yet.
- **Re-run:** `gh run rerun <run-id> --failed -R mopux/mopux-js`. A version that is already on npm is skipped, so a re-run only completes the GitHub release.
- **Manual fallback:** from your own terminal (the passkey needs a browser): `npm publish --workspace @mopux/sdk --access public --provenance=false`.
