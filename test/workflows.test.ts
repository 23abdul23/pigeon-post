// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

  it('pins_java_17', () => {
    const j = steps().find((s) => s.uses?.startsWith('actions/setup-java'));
    expect(j).toBeDefined();
    expect(String(j!.with!['java-version'])).toBe('17');
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
    expect(withVite).toHaveLength(1);
    expect(withVite[0].run).toMatch(/npm run build/);
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
    const i = g.indexOf('GradleException');
    expect(i).toBeGreaterThan(-1);
    const block = g.slice(Math.max(0, i - 900), i + 300);
    for (const n of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
      expect(block).toContain(n);
    }
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
