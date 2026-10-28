/**
 * Host half of dsh-workspace-session-link.
 *
 * The plugin is deliberately browser-only: it inserts the canonical
 * `dsh-session:` mention that the shipped session-reference Host service
 * already understands. Keeping this entry empty gives the Web client a
 * mounted roster row (and therefore a served /client bundle) without adding
 * a second context provider or duplicating Host logic.
 */
export const name = 'dsh-workspace-session-link'

/** No host-side behavior. */
export function apply() {}
