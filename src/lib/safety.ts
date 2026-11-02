import { api } from './api'
import { send } from './outbox'
import { getState, setState, type Letter } from './store'
import type { ReportInput } from './types'

/** Sign-in stays disabled until the age and the terms boxes are both ticked. */
export function canContinueSignIn(s: { ageConfirmed: boolean; termsAccepted: boolean }): boolean {
  return s.ageConfirmed === true && s.termsAccepted === true
}

/** Letters to or from a blocked user are hidden everywhere letters are listed. */
export function visibleLetters(letters: Letter[], blockedIds: readonly string[]): Letter[] {
  if (!blockedIds.length) return letters
  const blocked = new Set(blockedIds)
  return letters.filter((l) => !blocked.has(l.fromId) && !blocked.has(l.toId))
}

/** Blocks at once locally (the friendship ends too), then tells the server through the outbox (queued when offline). */
export async function blockUser(id: string): Promise<void> {
  setState((st) => ({
    blockedIds: st.blockedIds.includes(id) ? st.blockedIds : [...st.blockedIds, id],
    friends: st.friends.filter((f) => f.id !== id),
  }))
  await send({ id: `block:${id}`, method: 'POST', path: `/blocks/${id}`, touches: ['blocks', 'friends'] })
}

export async function unblockUser(id: string): Promise<void> {
  setState((st) => ({ blockedIds: st.blockedIds.filter((x) => x !== id) }))
  await send({ id: `block:${id}`, method: 'DELETE', path: `/blocks/${id}`, touches: ['blocks'] })
}

/** Sends a report; if the call fails for a transient reason the outbox keeps it and retries, so it is not lost. */
export async function reportContent(r: ReportInput): Promise<void> {
  await send({ id: `report:${crypto.randomUUID()}`, method: 'POST', path: '/reports', body: r, touches: ['reports'] })
}

/** Replaces `blockedIds` with `GET /blocks` unless a block change is pending. No-op without Cognito (the send/api layer throws). */
export async function refreshBlocks(held: ReadonlySet<string> = new Set()): Promise<void> {
  if (held.has('blocks')) return
  const r = await api<{ ids?: string[] }>('/blocks')
  if (Array.isArray(r?.ids) && !held.has('blocks')) setState({ blockedIds: r.ids })
}

export const isBlocked = (id: string) => getState().blockedIds.includes(id)
