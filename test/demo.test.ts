import { beforeEach, describe, expect, it } from 'vitest'
import { loadDemoData } from '../src/lib/demo'
import { PEOPLE } from '../src/lib/social'
import { getState, resetState } from '../src/lib/store'

describe('demo mailbox', () => {
  beforeEach(() => resetState())

  const received = () => getState().letters.filter((l) => l.toId === 'me')

  it('has both unread (delivered) and already opened letters, some saved', () => {
    loadDemoData()
    const unread = received().filter((l) => l.status === 'DELIVERED')
    const opened = received().filter((l) => l.status === 'OPENED')
    expect(unread.length).toBeGreaterThanOrEqual(5)
    expect(opened.length).toBeGreaterThanOrEqual(5)
    expect(getState().letters.filter((l) => l.saved).length).toBeGreaterThanOrEqual(2)
  })

  it('gives every letter its own id, so several can come from one friend', () => {
    loadDemoData()
    const ids = getState().letters.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(received().filter((l) => l.fromId === 'lars').length).toBeGreaterThanOrEqual(2)
  })

  it('names the sender, city and country exactly as the contact list does', () => {
    loadDemoData()
    for (const l of received()) {
      const person = PEOPLE.find((p) => p.id === l.fromId)
      expect(person, `unknown sender ${l.fromId}`).toBeDefined()
      expect([l.fromName, l.fromCity, l.cc]).toEqual([person!.name, person!.city, person!.cc])
    }
  })

  it('is safe to load twice: demo letters are replaced, not duplicated', () => {
    loadDemoData()
    const first = getState().letters.length
    loadDemoData()
    expect(getState().letters.length).toBe(first)
  })
})
