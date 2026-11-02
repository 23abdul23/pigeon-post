import { describe, expect, it } from 'vitest'
import { createPrefsStorage, type PrefsLike } from '../src/lib/prefsStorage'

function fakePrefs(): PrefsLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async ({ key }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }) => void data.set(key, value),
    remove: async ({ key }) => void data.delete(key),
    keys: async () => ({ keys: [...data.keys()] }),
    clear: async () => data.clear(),
  }
}

describe('createPrefsStorage', () => {
  it('set_then_get_roundtrips', async () => {
    const s = createPrefsStorage(fakePrefs())
    await s.setItem('user', 'v')
    expect(await s.getItem('user')).toBe('v')
  })
  it('get_missing_key_is_null', async () => {
    expect(await createPrefsStorage(fakePrefs()).getItem('nope')).toBeNull()
  })
  it('removeItem_deletes', async () => {
    const s = createPrefsStorage(fakePrefs())
    await s.setItem('a', '1')
    await s.removeItem('a')
    expect(await s.getItem('a')).toBeNull()
  })
  it('keys_are_prefixed_so_other_prefs_are_untouched', async () => {
    const p = fakePrefs()
    await p.set({ key: 'other', value: 'x' })
    const s = createPrefsStorage(p)
    await s.setItem('a', '1')
    expect([...p.data.keys()].sort()).toEqual(['oidc.a', 'other'])
    expect(await s.getItem('other')).toBeNull()
  })
  it('clear_removes_only_prefixed_keys', async () => {
    const p = fakePrefs()
    await p.set({ key: 'other', value: 'x' })
    const s = createPrefsStorage(p)
    await s.setItem('a', '1')
    await s.clear()
    expect([...p.data.keys()]).toEqual(['other'])
  })
  it('length_and_key_count_only_prefixed', async () => {
    const p = fakePrefs()
    await p.set({ key: 'other', value: 'x' })
    const s = createPrefsStorage(p)
    await s.setItem('a', '1')
    await s.setItem('b', '2')
    expect(await s.length).toBe(2)
    expect([await s.key(0), await s.key(1)]).toEqual(['a', 'b'])
    expect(await s.key(2)).toBeNull()
  })
  it('getItem_returns_null_not_throw_when_prefs_throws', async () => {
    const p = { ...fakePrefs(), get: async () => { throw new Error('boom') } }
    expect(await createPrefsStorage(p).getItem('a')).toBeNull()
  })
  it('setItem_propagates_failure', async () => {
    const p = { ...fakePrefs(), set: async () => { throw new Error('disk full') } }
    await expect(createPrefsStorage(p).setItem('a', '1')).rejects.toThrow('disk full')
  })
})
