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
});
