// Lets code outside React (the native deep-link listener) navigate inside the router without a page reload.
let navigateFn: ((to: string) => void) | undefined

export function setNavigate(fn: ((to: string) => void) | undefined): void {
  navigateFn = fn
}

/** Router navigation if the router is mounted; otherwise a full load so the target is still reached. */
export function goTo(to: string): void {
  if (navigateFn) navigateFn(to)
  else location.assign(to)
}
