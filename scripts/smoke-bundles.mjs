// Imports every built Lambda bundle the way the Node 22 runtime does, so init-time crashes
// (e.g. `Dynamic require of "node:https" is not supported`) fail the build, not production.
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

Object.assign(process.env, {
  TABLE_NAME: 'smoke-table',
  LETTERS_BUCKET: 'smoke-bucket',
  USER_POOL_ID: 'us-east-1_smoke',
  AWS_REGION: 'us-east-1',
  SES_SENDER: '',
  BEDROCK_MODEL_ID: 'smoke-model',
});

const root = resolve('.aws-sam/build');
if (!existsSync(root)) {
  console.error('FAIL: .aws-sam/build not found; run `sam build --config-env ci` first');
  process.exit(1);
}
const failures = [];
let ok = 0;
for (const fn of readdirSync(root, { withFileTypes: true })) {
  if (!fn.isDirectory()) continue;
  const dir = join(root, fn.name);
  const bundles = readdirSync(dir).filter((f) => /\.(mjs|js)$/.test(f));
  try {
    if (bundles.length !== 1) throw new Error(`expected exactly one bundle, found [${bundles}]`);
    await import(pathToFileURL(join(dir, bundles[0])).href);
    ok++;
  } catch (e) {
    failures.push(`FAIL ${fn.name}: ${e.message}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`OK ${ok} bundles import cleanly`);
