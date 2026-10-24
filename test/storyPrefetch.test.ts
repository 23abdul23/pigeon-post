import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStory, prefetchStory } from '../src/lib/stories'

beforeEach(() => vi.stubGlobal('window', { setTimeout, clearTimeout })) // stories.ts runs in the browser
afterEach(() => vi.unstubAllGlobals())

describe('prefetchStory', () => {
  it('prefetch_then_build_does_not_fetch_again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetchMock)
    await buildStory(48.85, 2.35, 100)
    const n = fetchMock.mock.calls.length
    fetchMock.mockClear()
    prefetchStory(10.1, 20.2, 100)
    const story = await buildStory(10.1, 20.2, 250)
    expect(fetchMock).toHaveBeenCalledTimes(n)
    expect(story.km).toBe(250)
  })

  it('failed_prefetch_is_not_cached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    prefetchStory(1, 2, 0)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const story = await buildStory(1, 2, 0) // joins the prefetch if still running
    const afterFirst = fetchMock.mock.calls.length
    await buildStory(1, 2, 0)
    expect(story.text).toContain('A quiet stop')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst)
  })

  it('build_never_throws_offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(buildStory(0, 0, 0)).resolves.toBeDefined()
  })
})
