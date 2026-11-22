# @mopux/cli

Command line client for the [Mopux](https://www.mopux.com) API, built on [`@mopux/sdk`](../sdk).

```bash
npm install -g @mopux/cli
mopux login https://acme.mopux.com
mopux tasks my
```

Requires Node.js 24 or 26. Single-file executables for Linux, macOS and Windows (no Node needed) are attached to each [GitHub release](https://github.com/mopux/mopux-js/releases), with a `SHA256SUMS` file to verify them.

## Commands

| Command | Description |
| --- | --- |
| `mopux login [url]` | Log in and save the session in a profile (`--email`, `--profile`, `--token-name`, `--with-token`, `--default`) |
| `mopux logout` | Revoke the token of the profile and forget it |
| `mopux whoami` | User and installation in use |
| `mopux profiles [list \| use <name> \| remove <name>]` | Manage profiles |
| `mopux projects list` | Your projects (`--search`, `--all`) |
| `mopux board <project-id>` | Groups and open tasks of a project (`--search`, `--archived`) |
| `mopux tasks my` | Your tasks across projects (`--search`, `--project <id>`…) |
| `mopux task show <id>` | A task |
| `mopux task create` | `--project`, `--group`, `--title`, and optionally `--description`, `--priority low\|normal\|high\|max`, `--start`, `--end`, `--hours HH:MM`, `--assign <user-id>`…, `--tag`… |
| `mopux task status <id> <status>` | `pending`, `doing`, `review` or `done` |
| `mopux task comment <id> [text]` | Comment, optionally with `--file <path>`… |
| `mopux notifications` | Your notifications (`--unread`, `--limit`), or `--read-all` |

Global options: `--json` prints the API data as JSON for scripts, `--profile <name>` picks a profile, `--help` shows the usage of any command.

## Profiles and credentials

Each `mopux login` creates or updates a profile (by default named after the first part of the host, e.g. `acme`). The first one becomes the default; `--default` or `mopux profiles use <name>` changes it.

- `~/.config/mopux/config.json` (or `$XDG_CONFIG_HOME/mopux`) keeps the profiles, never the tokens.
- The token goes to the system keychain: libsecret (`secret-tool`) on Linux, Keychain on macOS. Without a keychain (Windows, servers, containers) it is saved in `~/.config/mopux/credentials.json` with permissions 600. Set `MOPUX_TOKEN_STORAGE=file` to always use the file.
- The password is asked without echo and never stored: the CLI exchanges it for a personal API token named `mopux-cli@<hostname>`.

### Scripts and CI

No profile needed: set `MOPUX_URL` and `MOPUX_TOKEN` (a personal API token of a user with permission to use the API):

```bash
MOPUX_URL=https://acme.mopux.com MOPUX_TOKEN="$MOPUX_TOKEN" mopux tasks my --json | jq '.[].title'
```

Or save a profile from a token on standard input: `echo "$MOPUX_TOKEN" | mopux login https://acme.mopux.com --with-token`.

Exit codes: `0` success, `1` error, `2` wrong usage, `3` not logged in or invalid session, `4` no permission, plan without API or blocked billing.

## Certificates

The executables trust the system certificate store. With the npm package, Node.js uses its own list: for an installation behind a local or corporate certificate authority, run it with `NODE_USE_SYSTEM_CA=1`.

## License

MIT. See [LICENSE](LICENSE).
