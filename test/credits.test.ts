// @vitest-environment node
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CREDITS } from '../src/lib/credits'

const root = join(__dirname, '..')
const EMAIL = 'privacy@pigeonpost.app'
const page = (n: string) => {
  const p = join(root, 'public', n)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

describe('credits', () => {
  it('credits_include_every_bird_model_file_in_public_models', () => {
    const files = readdirSync(join(root, 'public/models')).filter((f) => f.endsWith('.glb'))
    expect(files.length).toBeGreaterThan(0)
    const listed = CREDITS.flatMap((c) => c.models ?? [])
    for (const f of files) expect(listed, f).toContain(f)
  })
  it('credits_include_openstreetmap_geonames_wikipedia', () => {
    const names = CREDITS.map((c) => c.name.toLowerCase()).join('|')
    for (const n of ['openstreetmap', 'geonames', 'wikipedia']) expect(names).toContain(n)
  })
  it('every_credit_has_a_license', () => {
    for (const c of CREDITS) {
      expect(c.license.trim().length, c.name).toBeGreaterThan(0)
      if (/unconfirmed/i.test(c.license)) expect(c.license.startsWith('UNCONFIRMED'), c.name).toBe(true)
    }
  })
  it('legal_pages_exist_and_are_non_empty', () => {
    for (const n of ['privacy.html', 'terms.html', 'delete-account.html']) {
      const h = page(n)
      expect(h.length, n).toBeGreaterThan(1500)
      expect(h.toLowerCase()).toContain('<!doctype html>')
      expect(h, n).toContain(EMAIL)
    }
  })
  it('delete_account_page_explains_in_app_and_email_paths', () => {
    const h = page('delete-account.html')
    expect(h).toContain('Settings')
    expect(h).toContain(EMAIL)
  })
})
