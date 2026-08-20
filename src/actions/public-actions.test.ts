/**
 * The public-action allowlist, asserted on its own.
 *
 * `PUBLIC_ACTIONS` is the one place where a server action stops requiring a
 * verified JWT, so a name added here is a capability handed to the whole
 * internet. Nothing in the type system notices that, which is what these
 * assertions are for.
 */

import { describe, it, expect } from 'vitest'
import { actions, PUBLIC_ACTIONS } from './index'

/**
 * Every action that acts on a booking which already exists. All of them either
 * belong to the host (no-show, delete) or authorize the caller against a
 * booking-specific secret they were mailed (cancel, reschedule), and none may
 * be reachable on a bare unauthenticated POST.
 */
const AUTHENTICATED_ACTIONS = [
  'cancel-booking',
  'reschedule-booking',
  'get-calendar-events',
  'mark-booking-no-show',
  'undo-booking-no-show',
  'delete-booking',
]

describe('PUBLIC_ACTIONS', () => {
  it('opens exactly the two calls the public booking link makes', () => {
    expect([...PUBLIC_ACTIONS].sort()).toEqual(['get-busy-times', 'schedule-event'])
  })

  it('holds nothing that acts on an existing booking', () => {
    for (const name of AUTHENTICATED_ACTIONS) {
      expect(PUBLIC_ACTIONS.has(name), `${name} must require sign-in`).toBe(false)
    }
  })

  it('names only actions that exist', () => {
    // A typo fails open in the other direction: the real action keeps
    // answering 401 to guests and booking stays quietly broken.
    for (const name of PUBLIC_ACTIONS) {
      expect(actions[name], `${name} is not a registered action`).toBeTypeOf('function')
    }
  })

  it('leaves no action unclassified', () => {
    // Guards against a new action being added and belonging to neither list —
    // the moment to decide whether it is public is when it is written.
    const classified = new Set([...PUBLIC_ACTIONS, ...AUTHENTICATED_ACTIONS])
    expect(Object.keys(actions).filter((name) => !classified.has(name))).toEqual([])
  })
})
