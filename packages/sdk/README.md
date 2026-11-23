# @mopux/sdk

Official TypeScript client for the [Mopux](https://www.mopux.com) API (`/api/v1`).

- Every API operation covered (71/71), checked against the OpenAPI spec in CI.
- Types generated from the OpenAPI spec: responses come back exactly as the API sends them (`snake_case`).
- No runtime dependencies: native `fetch`, `FormData` and `Blob`. ESM and CommonJS.
- Safe by default: retries rate-limited requests and failed reads, **never** retries a write whose outcome is unknown.
- `MockFetch` testing helper in `@mopux/sdk/testing`.

## Requirements

- Node.js 24 or 26. Only Node versions that still receive security fixes are supported.
- Use the API client server-side and keep API tokens on the server. The webhook entry point supports additional runtimes.

## Installation

```bash
npm install @mopux/sdk
```

## Quick start

```ts
import { Mopux, TaskPriorities, TaskStatuses } from '@mopux/sdk';

const mopux = new Mopux({ baseUrl: 'https://acme.mopux.com', token: process.env.MOPUX_TOKEN });

const board = await mopux.projects.board(12);
for (const group of board.task_groups ?? []) {
  console.log(`${group.title}: ${group.tasks.length} open tasks`);
}

const task = await mopux.tasks.create({
  project_id: 12,
  group_id: 7,
  title: 'Write the release notes',
  priority: TaskPriorities.High,
  hours_expected: '2:30',
  assignees: [3, 5],
});

await mopux.tasks.updateStatus(task.id ?? 0, TaskStatuses.Done);
```

## Authentication

The base URL is your Mopux installation (each installation has its own domain). The client adds `/api/v1/` itself.

**Personal access token.** Exchange credentials once and store the token (the API only shows it once):

```ts
const mopux = await Mopux.login({
  baseUrl: 'https://acme.mopux.com',
  email,
  password,
  tokenName: 'my-app',
});
saveSecret(mopux.token); // store it securely
```

Later:

```ts
const mopux = new Mopux({ baseUrl: 'https://acme.mopux.com', token });
await mopux.auth.user(); // the token's user
await mopux.auth.logout(); // revokes the token
```

`token` also accepts a function, sync or async, called before every request (useful when the token lives in a vault or is refreshed elsewhere).

Each login creates a new token. List and revoke the user's API tokens; secrets are never returned:

```ts
for (const token of await mopux.auth.tokens.list()) {
  console.log(token.id, token.name, token.current ? '(this client)' : '');
}
await mopux.auth.tokens.delete(leakedTokenId);
```

Changing or resetting the password revokes every token of the user, and API tokens unused for 90 days are deleted: log in again when you get an `AuthenticationError`.

The user needs the "API use" permission, and the installation's plan must include the API; otherwise the API answers `403` (`isPlanRestriction()` tells the plan case apart).

**OAuth.** When the installation enables OAuth, pass the access token the same way. Reads need the `mopux:read` scope and writes `mopux:write`. Tokens created for the MCP connector are rejected by the REST API.

**Several installations.** Clients are immutable: create one per installation, or derive another token with `mopux.withToken(token)`.

## Resources

| Property | Covers |
| --- | --- |
| `mopux.auth` | login, logout, user, `tokens.list()` / `tokens.delete()` |
| `mopux.projects` | list, iterate, create, show, update, delete, board, activity, summary, members |
| `mopux.taskGroups` | create (optionally with up to 4 tasks), reorder, rename, archive, move, copy, create a project, focus, status summary |
| `mopux.tasks` | create, update, batch update, my tasks, show, delete, single-field updates, move, touches, focus list, documents |
| `mopux.comments` | list, iterate, create (with mentions and files), update, delete, reply |
| `mopux.notifications` | list, iterate, mark read/unread, unread count, delete |
| `mopux.touches` | list, reply |
| `mopux.team` / `mopux.teamInvitations` | installation users, invitations |

### Updating tasks

`update()` changes only the fields you pass, atomically. `null` clears description, dates and hours; leaving a field out keeps it. Assignees are an explicit mutation:

```ts
await mopux.tasks.update(101, {
  date_end: null,
  hours_inverted: '1:15',
  assignees: { operation: 'add', user_ids: [8] }, // or 'remove' / 'replace'
});
```

Hours are `HH:MM` (also accepted as minutes in `updateHours()`); the API returns them as `HH:MM:SS`. Status `-1` (delayed) is read only.

### Comments and documents

```ts
import { Upload } from '@mopux/sdk';

await mopux.comments.create(101, {
  comment: 'Draft attached @Ada#5',
  files: [await Upload.fromPath('./draft.pdf')],
});

const attachment = await mopux.tasks.uploadFile(101, Upload.from('hello', 'notes.txt', 'text/plain'));
```

Download URLs expire after 15 minutes.

### Pagination

Listings return a `Page` (`items`, `currentPage`, `lastPage`, `perPage`, `total`, `hasMore()`, `nextPage()`); the `iterate…()` methods walk every page lazily:

```ts
const page = await mopux.projects.list({ search: 'web', perPage: 20 });

for await (const project of mopux.projects.iterate()) {
  console.log(project.title);
}
```

`tasks.my()` is not paginated. Prefer the aggregated endpoints to fetching objects one by one: `projects.board()` returns every group with its open tasks, `projects.summary()` the progress and workload, and `tasks.my()` the user's tasks across projects.

## Errors

Every error extends `MopuxError`.

| Error | When |
| --- | --- |
| `AuthenticationError` | 401: missing, invalid or revoked token |
| `AuthorizationError` | 403: no permission, missing OAuth scope, plan restriction or blocked billing |
| `NotFoundError` | 404 |
| `ValidationError` | 422: `errors` holds the messages per field |
| `RateLimitError` | 429 after the retries; `retryAfter` holds the seconds to wait |
| `ClientError` | other 4xx |
| `ServerError` | 5xx on a read |
| `UncertainWriteError` | 5xx on a write: the change **may have been applied** |
| `ConnectionError` | network failure; `isWriteOutcomeUncertain` is true for writes |
| `InvalidInputError` | rejected before sending |
| `MalformedResponseError` | unexpected response shape |

Every `ApiError` (the HTTP ones) gives `status`, `body`, `apiMessage` and `code`, the stable machine-readable `data.code` when the API sets one. Branch on the code, never on the message:

- `isPlanRestriction()`: the plan does not include the feature; `planFeature` names it (for example `api`).
- `isBillingBlocked()`: the installation is blocked by billing or its public trial has ended.

```ts
import { UncertainWriteError, ValidationError } from '@mopux/sdk';

try {
  await mopux.tasks.create(input);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.errors); // { title: ['The title field is required.'] }
  } else if (error instanceof UncertainWriteError) {
    // Do not create the task again blindly: check whether it exists first.
  } else {
    throw error;
  }
}
```

## Retries

Enabled by default (2 retries, exponential backoff with jitter):

- `429` is retried for every method, honouring `Retry-After` up to 60 seconds: the API throttles before running the request.
- Network errors and `5xx` are retried for reads only.
- Writes are **never** retried after a network error or a `5xx`; task creation is not idempotent.

```ts
new Mopux({ baseUrl, token, retry: { maxRetries: 4 } });
new Mopux({ baseUrl, token, retry: { maxRetries: 0 } }); // disabled
```

Other options: `timeoutMs` (per attempt, default 30 s), `fetch` (custom implementation), `userAgent` (appended to the SDK one) and `headers`.

## Testing

`MockFetch` answers from a queue and records the requests:

```ts
import { Mopux } from '@mopux/sdk';
import { MockFetch } from '@mopux/sdk/testing';

const mock = new MockFetch().push(MockFetch.json([{ id: 1, title: 'Review' }]), MockFetch.planRestricted());
const mopux = new Mopux({ baseUrl: 'https://acme.test', token: 'test', fetch: mock.fetch });

await mopux.tasks.my();
mock.assertSent('GET', 'tasks/my');
```

Helpers: `MockFetch.json()`, `error()`, `validation()`, `planRestricted()`, `networkError()`, `always()` and `assertNothingSent()`.

## Development

```bash
npm install
npm test            # Vitest, including the contract test against spec/openapi.yaml
npm run typecheck
npm run lint        # from the repository root
npm run sync-spec   # copy the public spec from mopux-com and regenerate the types
```

## License

MIT. See [LICENSE](LICENSE).

## Recibir webhooks

`parseWebhookEvent(rawBody, headers, secret)` verifica la firma antes de leer el JSON. Pásale los bytes originales de la petición y el secreto del endpoint. Admite `Uint8Array` (incluido `Buffer`), `ArrayBuffer` o texto UTF-8 sin modificar. Rechaza firmas inválidas con `InvalidWebhookSignatureError` y sobres inválidos con `InvalidWebhookPayloadError`.

`verifyWebhookSignature(rawBody, signatureHeader, secret, { tolerance, now })` permite verificar solo la firma. Ambas opciones se expresan en segundos y son opcionales. La tolerancia por defecto admite un desfase de hasta 300 segundos hacia el pasado o el futuro.

El resultado conserva `data` y la marca UTC original en `occurredAt`. Usa `event.is(WebhookEventType.TaskUpdated)` para obtener el tipo OpenAPI de `event.data`, o los accesores `task()`, `changes()`, `previousStatus()`, `assignedUserIds()`, `previousProjectId()` y `previousGroupId()`. Para una tarea borrada, `task()` devuelve `null` y la referencia reducida sigue disponible en `data.task`. Los eventos desconocidos conservan su nombre y sus datos. `deliveryId` identifica la entrega y se mantiene en los reintentos. El `id` del evento se conserva también en los reenvíos manuales.

La entrada `@mopux/sdk/webhooks` funciona con Node.js 18+ y en entornos con Web Crypto, como navegadores en contextos seguros y runtimes edge. Guarda el secreto en el servidor.

### Express

Registra esta ruta antes de cualquier middleware global que lea el cuerpo, como `express.json()`.

```ts
import express from 'express';
import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
  parseWebhookEvent,
} from '@mopux/sdk/webhooks';

const app = express();
const secret = process.env.MOPUX_WEBHOOK_SECRET;
if (!secret) throw new Error('Falta MOPUX_WEBHOOK_SECRET');

app.post('/webhooks/mopux', express.raw({ type: 'application/json', inflate: false }), async (req, res, next) => {
  try {
    const event = await parseWebhookEvent(req.body, req.headersDistinct, secret);
    console.log(event.id, event.event);
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) return res.sendStatus(401);
    if (error instanceof InvalidWebhookPayloadError) return res.sendStatus(400);
    next(error);
  }
});
```

### Next.js (Route Handler)

```ts
// app/api/webhooks/mopux/route.ts
import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
  parseWebhookEvent,
} from '@mopux/sdk/webhooks';

export const runtime = 'edge';

export async function POST(request: Request) {
  const secret = process.env.MOPUX_WEBHOOK_SECRET;
  if (!secret) throw new Error('Falta MOPUX_WEBHOOK_SECRET');

  try {
    const event = await parseWebhookEvent(await request.arrayBuffer(), request.headers, secret);
    console.log(event.id, event.event);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) return new Response(null, { status: 401 });
    if (error instanceof InvalidWebhookPayloadError) return new Response(null, { status: 400 });
    throw error;
  }
}
```

### Cloudflare Workers

```ts
import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
  parseWebhookEvent,
} from '@mopux/sdk/webhooks';

export default {
  async fetch(request: Request, env: { MOPUX_WEBHOOK_SECRET: string }) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const event = await parseWebhookEvent(await request.arrayBuffer(), request.headers, env.MOPUX_WEBHOOK_SECRET);
      console.log(event.id, event.event);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof InvalidWebhookSignatureError) return new Response(null, { status: 401 });
      if (error instanceof InvalidWebhookPayloadError) return new Response(null, { status: 400 });
      throw error;
    }
  },
};
```
