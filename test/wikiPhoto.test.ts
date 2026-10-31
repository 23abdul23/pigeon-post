import { afterEach, describe, expect, it, vi } from 'vitest'
import { wikiPhoto, wikiPhotoUrl } from '../src/lib/wikiPhoto'

const reply = (pages: object) => vi.fn(async () => ({ ok: true, json: async () => ({ query: { pages } }) }))
afterEach(() => vi.unstubAllGlobals())

describe('wikiPhoto', () => {
  it('searches "{place}, {country}" for one result', () => {
    const u = new URL(wikiPhotoUrl('Sintra', 'Portugal'))
    expect(u.searchParams.get('gsrsearch')).toBe('Sintra, Portugal')
    expect(u.searchParams.get('generator')).toBe('search')
    expect(u.searchParams.get('gsrlimit')).toBe('1')
  })

  it('returns the first result’s thumbnail and caches it', async () => {
    const f = reply({ 1: { index: 1, thumbnail: { source: 'https://img/a.jpg' } } })
    vi.stubGlobal('fetch', f)
    expect(await wikiPhoto('Alfama', 'Portugal')).toBe('https://img/a.jpg')
    expect(await wikiPhoto('Alfama', 'Portugal')).toBe('https://img/a.jpg')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('is null when the page has no picture, and retries after a miss', async () => {
    const f = reply({ 1: { index: 1 } })
    vi.stubGlobal('fetch', f)
    expect(await wikiPhoto('Nowhere', 'Chile')).toBeNull()
    await Promise.resolve()
    expect(await wikiPhoto('Nowhere', 'Chile')).toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('is null, without throwing, when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await wikiPhoto('Oslo', 'Norway')).toBeNull()
  })
})
