// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const WF = '.github/workflows/android.yml';
const read = () => readFileSync(WF, 'utf8');

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
function steps(): Step[] {
  const doc = parse(read()) as { jobs: Record<string, { steps: Step[] }> };
  return Object.values(doc.jobs).flatMap((j) => j.steps);
}
const idx = (re: RegExp) => steps().findIndex((s) => typeof s.run === 'string' && re.test(s.run));

describe('android release workflow', () => {
  it('android_workflow_exists', () => {
    expect(existsSync(WF)).toBe(true);
    const doc = parse(read());
    expect(Object.keys(doc.on)).toEqual(expect.arrayContaining(['workflow_dispatch', 'push']));
    expect(doc.on.push.tags).toContain('android-v*');
    expect(doc.permissions).toEqual({ contents: 'read' });
  });

  it('runs_tests_before_building', () => {
    const build = idx(/\.\/gradlew/);
    expect(build).toBeGreaterThan(-1);
    for (const re of [/npx vitest run/, /npm --prefix api test/, /npx tsc -b/]) {
      const i = idx(re);
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(build);
    }
  });

  it('uses_no_inline_secrets', () => {
    const text = read();
    expect(text).not.toMatch(/[A-Za-z0-9+/=]{60,}/);
    for (const m of text.matchAll(/secrets\.[A-Za-z0-9_]+/g)) {
      expect(text).toContain('${{ ' + m[0] + ' }}');
    }
    for (const s of steps()) {
      for (const v of Object.values(s.env ?? {})) {
        const str = String(v);
        if (str.length > 40) expect(str).toMatch(/^\$\{\{.*\}\}$/);
      }
    }
  });

  it('uploads_to_internal_track_only', () => {
    const tracks = [...read().matchAll(/^\s*track:\s*(\S+)/gm)].map((m) => m[1]);
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.every((t) => t === 'internal')).toBe(true);
  });

  it('pins_java_21', () => {
    // Capacitor 8 compiles with JavaVersion.VERSION_21.
    const j = steps().find((s) => s.uses?.startsWith('actions/setup-java'));
    expect(j).toBeDefined();
    expect(j!.with!.distribution).toBe('temurin');
    expect(String(j!.with!['java-version'])).toBe('21');
  });

  it('build_config_is_checked_before_the_web_build', () => {
    const check = steps().findIndex((s) => s.name === 'Check build configuration');
    const build = idx(/npm run build/);
    expect(check).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeLessThan(build);
    const step = steps()[check];
    for (const n of ['VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_DOMAIN', 'VITE_API_URL', 'VITE_PUSH_ENABLED']) {
      expect(step.env).toHaveProperty(n);
      expect(String(step.env![n])).toMatch(/^\$\{\{ vars\./);
      expect(step.run).toContain(n);
    }
    expect(step.run).toContain('REPLACE_ME');
    expect(step.run).toContain('android/app/google-services.json');
    expect(step.run).toMatch(/exit 1/);
    // Values are never echoed, only names.
    expect(step.run).not.toMatch(/echo[^\n]*\$\{?(VITE_|!)/);
  });

  it('build_config_check_rejects_missing_or_placeholder_values', () => {
    const run = steps().find((s) => s.name === 'Check build configuration')!.run!;
    const ok = { VITE_COGNITO_USER_POOL_ID: 'eu-west-2_abc', VITE_COGNITO_CLIENT_ID: 'abc', VITE_COGNITO_DOMAIN: 'https://x.auth', VITE_API_URL: 'https://api', VITE_PUSH_ENABLED: 'false' };
    const sh = (env: Record<string, string>) =>
      spawnSync('bash', ['-c', run], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', cwd: mkdtempSync(join(tmpdir(), 'wf-')) });
    expect(sh(ok).status).toBe(0);
    expect(sh({ ...ok, VITE_API_URL: '' }).status).not.toBe(0);
    const r = sh({ ...ok, VITE_COGNITO_CLIENT_ID: 'REPLACE_ME' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('VITE_COGNITO_CLIENT_ID');
    expect(r.stdout + r.stderr).not.toContain('eu-west-2_abc');
    expect(sh({ ...ok, VITE_PUSH_ENABLED: 'true' }).status).not.toBe(0);
  });

  it('manual_runs_are_limited_to_main_or_release_tags', () => {
    const doc = parse(read()) as { jobs: Record<string, { if?: string }> };
    for (const j of Object.values(doc.jobs)) {
      expect(j.if).toContain("github.ref == 'refs/heads/main'");
      expect(j.if).toContain("startsWith(github.ref, 'refs/tags/android-v')");
    }
  });

  it('version_name_is_validated_before_it_is_written', () => {
    const run = steps().find((s) => s.run?.includes('${REF_NAME#android-v}'))!.run!;
    const sh = (ref: string, type: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'wf-'));
      const envFile = join(dir, 'env');
      writeFileSync(envFile, '');
      const r = spawnSync('bash', ['-c', run], { env: { PATH: process.env.PATH, REF_NAME: ref, REF_TYPE: type, GITHUB_ENV: envFile }, encoding: 'utf8' });
      return { status: r.status, env: readFileSync(envFile, 'utf8') };
    };
    expect(sh('android-v1.2.3', 'tag')).toEqual({ status: 0, env: 'ANDROID_VERSION_NAME=1.2.3\n' });
    expect(sh('main', 'branch')).toEqual({ status: 0, env: 'ANDROID_VERSION_NAME=1.0\n' });
    for (const bad of ['android-v', 'android-v1.0\nEVIL=1', 'android-v1 2', 'android-v$(x)']) {
      const r = sh(bad, 'tag');
      expect(r.status).not.toBe(0);
      expect(r.env).toBe('');
    }
  });

  it('gradle_release_signing_is_env_driven_and_optional', () => {
    const g = readFileSync('android/app/build.gradle', 'utf8');
    expect(g).toContain('ANDROID_KEYSTORE_PATH');
    expect(g).toContain('ANDROID_VERSION_CODE');
    expect(g).not.toMatch(/storePassword\s*=?\s*["']/);
  });
  it('upload_step_is_internal_draft_and_uses_the_play_secret_via_with', () => {
    const all = steps();
    const ups = all.filter((s) => s.uses?.startsWith('r0adkll/upload-google-play@'));
    expect(ups).toHaveLength(1);
    const w = ups[0].with!;
    expect(w.track).toBe('internal');
    expect(w.status).toBe('draft');
    expect(w.packageName).toBe('app.pigeonpost');
    expect(Object.values(w).map(String)).toContain('${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}');
    expect(all.filter((s) => s !== ups[0] && s.with && 'track' in s.with)).toHaveLength(0);
  });

  it('keystore_cleanup_step_runs_always', () => {
    const c = steps().find((s) => (s as { if?: string }).if === 'always()');
    expect(c).toBeDefined();
    expect(c!.run).toMatch(/rm -f .*upload\.keystore/);
  });

  it('vite_vars_are_scoped_to_the_build_step_only', () => {
    const doc = parse(read()) as { env?: Record<string, unknown>; jobs: Record<string, { env?: Record<string, unknown> }> };
    expect(Object.keys(doc.env ?? {}).filter((k) => k.startsWith('VITE_'))).toEqual([]);
    for (const j of Object.values(doc.jobs)) expect(Object.keys(j.env ?? {}).filter((k) => k.startsWith('VITE_'))).toEqual([]);
    const withVite = steps().filter((s) => Object.keys(s.env ?? {}).some((k) => k.startsWith('VITE_')));
    expect(withVite.map((s) => s.name)).toEqual(['Check build configuration', 'Build web bundle']);
    expect(withVite[1].run).toMatch(/npm run build/);
  });

  it('signing_secrets_are_checked_before_the_keystore_is_decoded', () => {
    const check = idx(/:\?/);
    const decode = idx(/base64 -d/);
    const gradle = idx(/\.\/gradlew/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(decode);
    expect(check).toBeLessThan(gradle);
    const run = steps()[check].run!;
    for (const n of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'PLAY_SERVICE_ACCOUNT_JSON']) {
      expect(run).toContain(n);
      expect(steps()[check].env).toHaveProperty(n);
    }
    expect(steps()[decode].run).toMatch(/test -s/);
  });

  it('gradle_fails_on_partial_signing_config', () => {
    const g = readFileSync('android/app/build.gradle', 'utf8');
    const i = g.indexOf('throw new GradleException');
    expect(i).toBeGreaterThan(-1);
    const block = g.slice(Math.max(0, i - 900), i + 300);
    for (const n of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
      expect(block).toContain(n);
    }
    // The throw must sit inside the branch guarded by the partial-missing condition, not run unconditionally.
    const before = g.slice(0, i);
    const ifAt = before.lastIndexOf('if (');
    expect(ifAt).toBeGreaterThan(-1);
    const header = g.slice(ifAt, g.indexOf('{', ifAt) + 1);
    expect(header).toMatch(/releaseSigningMissing\.size\(\)\s*!=\s*0\s*&&\s*releaseSigningMissing\.size\(\)\s*!=\s*releaseSigningEnv\.size\(\)/);
    const between = g.slice(ifAt + header.length, i);
    expect(between).not.toContain('}');
  });

  it('version_name_strips_the_tag_prefix', () => {
    const text = read();
    const step = steps().find((s) => s.run?.includes('${REF_NAME#android-v}'));
    expect(step).toBeDefined();
    expect(step!.env).toHaveProperty('REF_NAME');
    expect(step!.run).toContain('ANDROID_VERSION_NAME');
    expect(step!.run).toContain('GITHUB_ENV');
    for (const s of steps()) expect(s.run ?? '').not.toContain('github.ref_name');
    expect(text).not.toMatch(/ANDROID_VERSION_NAME:\s*\$\{\{/);
  });
});

const CI = '.github/workflows/android-ci.yml';
describe('android pull-request workflow', () => {
  const doc = () => parse(readFileSync(CI, 'utf8')) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, { steps: Step[]; 'working-directory'?: string }> };
  const ciSteps = () => Object.values(doc().jobs).flatMap((j) => j.steps);

  it('android_ci_workflow_parses_and_triggers_on_pull_request', () => {
    expect(existsSync(CI)).toBe(true);
    const d = doc();
    expect(Object.keys(d.on)).toContain('pull_request');
    expect(d.permissions).toEqual({ contents: 'read' });
  });

  it('android_ci_uses_node_20_and_jdk_21', () => {
    const node = ciSteps().find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(String(node!.with!['node-version'])).toBe('20');
    const j = ciSteps().find((s) => s.uses?.startsWith('actions/setup-java'));
    expect(j!.with!.distribution).toBe('temurin');
    expect(String(j!.with!['java-version'])).toBe('21');
  });

  it('android_ci_builds_web_syncs_and_assembles_debug', () => {
    const runs = ciSteps().map((s) => s.run ?? '');
    const at = (re: RegExp) => runs.findIndex((r) => re.test(r));
    const order = [/npm ci/, /npm run build/, /npx cap sync android/, /\.\/gradlew assembleDebug/].map(at);
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const gradle = ciSteps().find((s) => /\.\/gradlew assembleDebug/.test(s.run ?? '')) as Step & { 'working-directory'?: string };
    expect(gradle['working-directory']).toBe('android');
  });

  it('android_ci_references_no_secrets', () => {
    const text = readFileSync(CI, 'utf8');
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/[A-Za-z0-9+/=]{60,}/);
  });
});
