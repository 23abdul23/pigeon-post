import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStory } from '../src/lib/stories'

beforeEach(() => vi.stubGlobal('window', { setTimeout, clearTimeout }))
afterEach(() => vi.unstubAllGlobals())

const page = (i: number, extract: string, thumb = true) => ({ title: `Place ${i}`, index: i, extract, fullurl: `https://en.wikipedia.org/wiki/P${i}`, ...(thumb && { thumbnail: { source: `https://img/p${i}.jpg` } }) })
const long = (s: string) => `${s} ${'Filler words that make this extract long enough to pass the filter. '.repeat(3)}`
const geo = { query: { pages: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, page(i + 1, long(`Place ${i + 1} is a notable landmark in the city. It has a second sentence.`), i !== 0)])) } }
const taxa = (kind: string, names: string[]) => ({ results: names.map((n) => ({ taxon: { preferred_common_name: n, name: `sci ${n}`, iconic_taxon_name: kind, default_photo: { square_url: `https://img/${n}.jpg` } } })) })
const canned = (url: string, off: string[] = []) => {
  if (off.some((o) => url.includes(o))) return null
  if (url.includes('wikipedia.org/w/api.php')) return geo
  if (url.includes('iconic_taxa=Aves')) return taxa('Aves', ['Robin', 'Wren', 'Owl'])
  if (url.includes('iconic_taxa=Plantae')) return taxa('Plantae', ['Oak', 'Fern', 'Robin', 'Moss'])
  if (url.includes('iconic_taxa=Mammalia')) return taxa('Mammalia', ['Fox', 'Newt', 'Bee'])
  if (url.includes('restcountries')) return { capital: ['Lisbon'], population: 10_000_000, languages: { por: 'Portuguese' }, currencies: { EUR: { name: 'Euro' } }, demonyms: { eng: { m: 'Portuguese' } } }
  if (url.includes('rest_v1/page/summary')) return { extract: 'Culture is shaped by fado and tiles.' }
  return null
}
const stub = (off: string[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const j = canned(url, off)
  return j ? { ok: true, json: async () => j } : { ok: false }
}))

describe('story extras', () => {
  it('assembles nearby, wildlife, people and culture with caps and dedupe', async () => {
    stub()
    const s = await buildStory(38.7201, -9.1401, 10)
    expect(s.birds).toEqual(['Robin', 'Wren', 'Owl'])
    const x = s.extras!
    expect(x.nearby!.length).toBeLessThanOrEqual(5)
    expect(x.nearby!.map((n) => n.title)).not.toContain(s.place)
    expect(x.nearby![0].blurb).toBe(x.nearby![0].blurb!.split('.')[0] + '.')
    expect(x.nearby![1]).toMatchObject({ url: expect.stringContaining('wikipedia.org'), photo: expect.stringContaining('https://img/') })
    const names = x.wildlife!.map((w) => w.name)
    expect(names.length).toBeLessThanOrEqual(8)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((n) => n === 'Robin')).toHaveLength(1)
    expect(x.wildlife!.find((w) => w.name === 'Oak')).toMatchObject({ kind: 'Plant', photo: 'https://img/Oak.jpg' })
    expect(x.wildlife!.find((w) => w.name === 'Fox')!.kind).toBe('Mammal')
    expect(x.people).toEqual({ capital: 'Lisbon', population: 10_000_000, languages: ['Portuguese'], currency: 'Euro', demonym: 'Portuguese' })
    expect(x.culture).toContain('fado')
  })

  it('omits people when only restcountries fails', async () => {
    stub(['restcountries'])
    const x = (await buildStory(41.1, -8.6, 10)).extras!
    expect(x.people).toBeUndefined()
    expect(x.culture && x.nearby && x.wildlife).toBeTruthy()
  })

  it('has no extras when every extra fetch fails, but keeps the story text', async () => {
    stub(['iconic_taxa', 'restcountries', 'rest_v1'])
    const s = await buildStory(40.2, -8.4, 10)
    expect(s.text.length).toBeGreaterThan(20)
    expect(s.extras?.wildlife).toBeUndefined()
    expect(s.extras?.people).toBeUndefined()
    expect(s.extras?.culture).toBeUndefined()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await buildStory(50.5, 5.5, 10)).extras).toBeUndefined()
  })
})
