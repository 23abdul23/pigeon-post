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

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// Expected functions come from the template, so a partial build cannot pass silently.
let template;
try {
  template = readFileSync('template.yaml', 'utf8');
} catch (e) {
  die(`FAIL: cannot read template.yaml: ${e.message}`);
}
// Name = the nearest preceding 2-space-indented key, so comments, Condition, DependsOn and blank lines before Type are fine.
const typeRe = /^\s*Type:\s*['"]?AWS::Serverless::Function['"]?\s*(#.*)?$/;
const expected = [];
let key = null;
for (const line of template.split(/\r?\n/)) {
  const k = line.match(/^ {2}['"]?([\w-]+)['"]?:\s*(#.*)?$/);
  if (k) key = k[1];
  else if (/^ {4}Type:/.test(line) && typeRe.test(line) && key) expected.push(key);
}
// Independent count: any Type line anywhere, so a layout the name parser misses still trips the gate.
const typeCount = (template.match(/Type:\s*['"]?AWS::Serverless::Function['"]?/g) ?? []).length;
if (typeCount === 0) die('FAIL: no AWS::Serverless::Function resources found in template.yaml');
if (typeCount !== expected.length) {
  die(`FAIL: template.yaml has ${typeCount} AWS::Serverless::Function types but only ${expected.length} names were parsed [${expected}]`);
}

const root = resolve('.aws-sam/build');
if (!existsSync(root)) die('FAIL: .aws-sam/build not found; run `sam build --config-env ci` first');

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
if (failures.length) die(failures.join('\n'));
console.log(`OK ${ok} bundles import cleanly`);
