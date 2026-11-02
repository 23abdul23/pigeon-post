import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertCheckpoint, cancelCheckpoints, keepCheckpointsScheduled, scheduleCheckpoints } from '../src/lib/checkpointAlert'
import type { LocalNotifierLike } from '../src/lib/checkpointPlan'
import { defaultSettings, getState, setState } from '../src/lib/store'

class FakeNotification {
  static permission = 'granted'
  static made: FakeNotification[] = []
  onclick: (() => void) | null = null
  constructor(public title: string, public opts: { body: string; tag: string }) {
    FakeNotification.made.push(this)
  }
  close = vi.fn()
}

beforeEach(() => {
  FakeNotification.permission = 'granted'
  FakeNotification.made = []
  vi.stubGlobal('Notification', FakeNotification)
  setState({ settings: { ...defaultSettings, notifyBird: true } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setState({ settings: defaultSettings })
})

describe('alertCheckpoint', () => {
  it('shows a notification when permission is granted and notifyBird is on', () => {
    expect(alertCheckpoint('Lisbon', () => {})).toBe(true)
    const n = FakeNotification.made[0]
    expect(n.title).toBe('Checkpoint reached')
    expect(n.opts.body).toBe('Your bird reached Lisbon')
    expect(n.opts.tag).toBe('checkpoint')
  })

  it('clicking the notification calls onClick', () => {
    const onClick = vi.fn()
    alertCheckpoint('Lisbon', onClick)
    FakeNotification.made[0].onclick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('returns false and shows nothing when permission is denied', () => {
    FakeNotification.permission = 'denied'
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
    expect(FakeNotification.made).toEqual([])
  })

  it('returns false when Notification is undefined', () => {
    vi.stubGlobal('Notification', undefined)
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
  })

  it('returns false when settings.notifyBird is false', () => {
    setState({ settings: { ...getState().settings, notifyBird: false } })
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
    expect(FakeNotification.made).toEqual([])
  })

  it('returns false when constructing the notification throws', () => {
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { throw new TypeError('Illegal constructor') } })
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
  })
})

describe('native scheduling', () => {
  const plan = [{ id: 1, atMs: 5, place: 'A' }]
  const notifier = (over: Partial<LocalNotifierLike> = {}): LocalNotifierLike => ({ schedule: vi.fn(async () => {}), cancelAll: vi.fn(async () => {}), ...over })

  it('schedule_calls_notifier_with_the_plan', async () => {
    const n = notifier()
    await scheduleCheckpoints(n, plan)
    expect(n.schedule).toHaveBeenCalledWith(plan)
  })
  it('does not call the notifier for an empty plan', async () => {
    const n = notifier()
    await scheduleCheckpoints(n, [])
    expect(n.schedule).not.toHaveBeenCalled()
  })
  it('cancel_calls_cancelAll', async () => {
    const n = notifier()
    await cancelCheckpoints(n)
    expect(n.cancelAll).toHaveBeenCalledTimes(1)
  })
  it('schedule_swallows_notifier_failure_and_resolves', async () => {
    const n = notifier({ schedule: vi.fn(async () => { throw new Error('denied') }), cancelAll: vi.fn(async () => { throw new Error('x') }) })
    await expect(scheduleCheckpoints(n, plan)).resolves.toBeUndefined()
    await expect(cancelCheckpoints(n)).resolves.toBeUndefined()
  })
  it('keepCheckpointsScheduled schedules, and its stop function cancels', async () => {
    const n = notifier()
    const stop = keepCheckpointsScheduled(n, plan)
    stop()
    await vi.waitFor(() => expect(n.cancelAll).toHaveBeenCalledTimes(1))
    expect(n.schedule).toHaveBeenCalledWith(plan)
  })
  it('a stop before the schedule finished still cancels afterwards', async () => {
    let release!: () => void
    const order: string[] = []
    const n = notifier({
      schedule: vi.fn(() => new Promise<void>((r) => (release = () => { order.push('scheduled'); r() }))),
      cancelAll: vi.fn(async () => { order.push('cancelled') }),
    })
    const stop = keepCheckpointsScheduled(n, plan)
    stop()
    await vi.waitFor(() => expect(n.schedule).toHaveBeenCalled())
    expect(n.cancelAll).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(order).toEqual(['scheduled', 'cancelled']))
  })
  it('stop twice cancels once', async () => {
    const n = notifier()
    const stop = keepCheckpointsScheduled(n, plan)
    stop()
    stop()
    await vi.waitFor(() => expect(n.cancelAll).toHaveBeenCalled())
    expect(n.cancelAll).toHaveBeenCalledTimes(1)
  })
})

describe('serialised native operations', () => {
  const plan = [{ id: 1, atMs: 5, place: 'A' }]
  const deferred = () => {
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    return { p, resolve }
  }

  it('successive_keepers_cancel_before_the_next_schedule', async () => {
    const log: string[] = []
    const gates: Record<string, ReturnType<typeof deferred>> = {}
    let s = 0
    let c = 0
    const n: LocalNotifierLike = {
      schedule: vi.fn(() => {
        const k = `schedule#${++s}`
        log.push(`start ${k}`)
        gates[k] = deferred()
        return gates[k].p.then(() => void log.push(`end ${k}`))
      }),
      cancelAll: vi.fn(() => {
        const k = `cancel#${++c}`
        log.push(`start ${k}`)
        gates[k] = deferred()
        return gates[k].p.then(() => void log.push(`end ${k}`))
      }),
    }
    const stop1 = keepCheckpointsScheduled(n, plan)
    stop1()
    keepCheckpointsScheduled(n, plan) // the effect re-ran: cleanup, then a new schedule
    await new Promise((r) => setTimeout(r, 5))
    expect(log).toEqual(['start schedule#1']) // the first schedule resolves late; nothing else may start
    gates['schedule#1'].resolve()
    await vi.waitFor(() => expect(log).toContain('start cancel#1'))
    expect(log).not.toContain('start schedule#2')
    gates['cancel#1'].resolve()
    await vi.waitFor(() => expect(log).toContain('start schedule#2'))
    gates['schedule#2'].resolve()
    await vi.waitFor(() => expect(log.at(-1)).toBe('end schedule#2'))
    expect(log).toEqual(['start schedule#1', 'end schedule#1', 'start cancel#1', 'end cancel#1', 'start schedule#2', 'end schedule#2'])
  })

  it('a_rejected_operation_does_not_block_later_operations', async () => {
    const n: LocalNotifierLike = {
      schedule: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
      cancelAll: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
    }
    const stop1 = keepCheckpointsScheduled(n, plan)
    stop1()
    const stop2 = keepCheckpointsScheduled(n, plan)
    stop2()
    await vi.waitFor(() => expect(n.cancelAll).toHaveBeenCalledTimes(2))
    expect(n.schedule).toHaveBeenCalledTimes(2)
  })
})
