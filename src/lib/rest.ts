import { landSession } from './flight'
import { setState, type Landing } from './store'

/**
 * A voluntary break: lands the bird where it is (the trip keeps its progress, as with End flight) and queues the
 * info card of that place, so the flight screen or popup pulls it out at once. Dismissing it opens the landing page.
 */
export async function restHere(): Promise<Landing | null> {
  const l = await landSession('ended')
  if (l) {
    setState((st) => ({
      stopCards: st.stopCards.some((c) => c.storyId === l.storyId) ? st.stopCards : [...st.stopCards, { tripId: l.tripId, storyId: l.storyId, km: l.km, gainedKm: l.gainedKm, newStampCc: l.newStampCc }],
    }))
  }
  return l
}
