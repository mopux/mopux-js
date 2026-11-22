// Copies the public OpenAPI spec of the Mopux API into spec/openapi.yaml.
// Source: MOPUX_SPEC, or ../mopux-com/docs/api/openapi-v1-public.yaml next to this repo.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(
  process.env.MOPUX_SPEC ?? resolve(root, '../../../../mopux-com/docs/api/openapi-v1-public.yaml'),
);

if (!existsSync(source)) {
  console.error(`Spec not found: ${source}. Set MOPUX_SPEC to the path of openapi-v1-public.yaml.`);
  process.exit(1);
}

copyFileSync(source, resolve(root, 'spec/openapi.yaml'));
console.log(`Copied ${source} -> spec/openapi.yaml`);
