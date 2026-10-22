// Imports every built Lambda bundle the way the Node 22 runtime does, so init-time crashes
// (e.g. `Dynamic require of "node:https" is not supported`) fail the build, not production.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
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
// Expected functions come from the template, so a partial build cannot pass silently.
// Expected functions come from the template, so a partial build cannot pass silently.
const expected = [...readFileSync('template.yaml', 'utf8').matchAll(/^ {2}(\w+):\r?\n {4}Type: AWS::Serverless::Function\b/gm)].map((m) => m[1]);
if (expected.length === 0) {
  console.error('FAIL: no AWS::Serverless::Function resources found in template.yaml');
  process.exit(1);
}
const failures = [];
let ok = 0;
const seen = new Set();
for (const fn of readdirSync(root, { withFileTypes: true })) {
  if (!fn.isDirectory()) continue;
  seen.add(fn.name);
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
for (const name of expected) if (!seen.has(name)) failures.push(`FAIL ${name}: no build directory`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`OK ${ok} bundles import cleanly`);
