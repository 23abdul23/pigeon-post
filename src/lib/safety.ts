import { api } from './api'
import { S } from './strings'
import { send } from './outbox'
import { getState, setState, type Letter, type State } from './store'
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

const nameOf = (st: State, id: string): Record<string, string> => {
  const name = st.friends.find((f) => f.id === id)?.name ?? st.letters.find((l) => l.fromId === id)?.fromName
  return name ? { [id]: name } : {}
}

/** Blocks at once locally (the friendship ends too), then tells the server through the outbox (queued when offline). */
export async function blockUser(id: string): Promise<void> {
  setState((st) => ({
    blockedIds: st.blockedIds.includes(id) ? st.blockedIds : [...st.blockedIds, id],
    blockedNames: { ...st.blockedNames, ...nameOf(st, id) },
    friends: st.friends.filter((f) => f.id !== id),
  }))
  await send({ id: `block:${id}`, method: 'POST', path: `/blocks/${id}`, touches: ['blocks', 'friends'] })
}

export async function unblockUser(id: string): Promise<void> {
  setState((st) => ({
    blockedIds: st.blockedIds.filter((x) => x !== id),
    blockedNames: Object.fromEntries(Object.entries(st.blockedNames).filter(([k]) => k !== id)),
  }))
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

/** Whether a letter came from (or goes to) a blocked user and must not be shown or opened. */
export const isHiddenLetter = (l: Letter, blockedIds: readonly string[]): boolean => blockedIds.includes(l.fromId) || blockedIds.includes(l.toId)

/** Delivered, unopened letters to me that are not hidden by a block (the badge and "waiting" counts). */
export const unreadCount = (letters: Letter[], blockedIds: readonly string[]): number =>
  visibleLetters(letters, blockedIds).filter((l) => l.toId === 'me' && l.status === 'DELIVERED').length

/** Rows for the Blocked people list: the stored name, else a generic label. */
export const blockedPeople = (ids: readonly string[], names: Record<string, string>): { id: string; name: string }[] =>
  ids.map((id) => ({ id, name: names[id] ?? S.blockedFallbackName }))
