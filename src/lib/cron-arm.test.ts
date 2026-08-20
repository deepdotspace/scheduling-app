import { describe, it, expect, vi, afterEach } from 'vitest'
import { cronRoomName, createCronArmer } from './cron-arm'
import { APP_NAME, SCOPE_ID } from '../constants'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cronRoomName (the id that decides whether arming hits the real room)', () => {
  it('addresses the room as app:<APP_NAME>', () => {
    expect(cronRoomName('bookwithme')).toBe('app:bookwithme')
  })

  // The footgun: this app keys its rooms by APP_NAME while DEEPSPACE_APP_ID is a
  // completely different string. Arming `app:<DEEPSPACE_APP_ID>` would create a
  // second, empty CronRoom, return a perfectly happy response, and leave every
  // reminder dead. Pin the id to the key the rest of the app already uses — the
  // same one `/ws/cron/:roomId` resolves through idFromName.
  it('matches SCOPE_ID, the key every other server-side room uses', () => {
    expect(cronRoomName(APP_NAME)).toBe(SCOPE_ID)
  })

  it('is not derived from a DeepSpace app id', () => {
    expect(cronRoomName(APP_NAME)).not.toBe('app:app_01KZ4FHFZZBV5QMZ5PGZF33HSM')
  })
})

describe('createCronArmer (one ping per isolate, retried on failure)', () => {
  it('pings on the first call and returns something to wait on', async () => {
    const ping = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const arm = createCronArmer()

    const first = arm(ping)
    expect(first).not.toBeNull()
    await first
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('does not ping again once armed — the alarm self-perpetuates', async () => {
    const ping = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const arm = createCronArmer()

    await arm(ping)
    expect(arm(ping)).toBeNull()
    expect(arm(ping)).toBeNull()
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('latches immediately, so concurrent requests in one isolate ping once', () => {
    const ping = vi.fn().mockReturnValue(new Promise(() => {}))
    const arm = createCronArmer()

    arm(ping)
    arm(ping)
    arm(ping)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  // A CronRoom that arms and then answers 404 (BaseRoom has no route for a bare
  // path) has still armed. Only a rejection means the DO was never reached.
  it('treats a resolved 404 as a successful arming', async () => {
    const ping = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
    const arm = createCronArmer()

    await arm(ping)
    expect(arm(ping)).toBeNull()
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('un-latches after a failed ping so a later request retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ping = vi.fn().mockRejectedValueOnce(new Error('DO unreachable')).mockResolvedValue(undefined)
    const arm = createCronArmer()

    await arm(ping)
    const retry = arm(ping)
    expect(retry).not.toBeNull()
    await retry
    expect(ping).toHaveBeenCalledTimes(2)
  })

  it('never rejects — a dead cron room must not fail the request it rode in on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const arm = createCronArmer()
    await expect(arm(() => Promise.reject(new Error('boom')))).resolves.toBeUndefined()
  })

  // Building the ping can throw before any promise exists: an unbound
  // CRON_ROOMS makes `env.CRON_ROOMS.get(...)` a TypeError on the spot. That
  // must not escape into the request the middleware is wrapping, and it must
  // not leave the latch closed — otherwise one bad request permanently
  // disarms the isolate, which is the failure mode this whole file exists to
  // prevent.
  it('swallows a synchronous throw from building the ping', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const arm = createCronArmer()
    expect(() =>
      arm(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'get')")
      }),
    ).not.toThrow()
  })

  it('un-latches after a synchronous throw so a later request retries', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ping = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('no binding')
      })
      .mockReturnValue(Promise.resolve(undefined))
    const arm = createCronArmer()

    expect(arm(ping)).toBeNull() // nothing in flight to wait on
    expect(arm(ping)).not.toBeNull()
    expect(ping).toHaveBeenCalledTimes(2)
  })

  it('gives each isolate its own latch', async () => {
    const ping = vi.fn().mockResolvedValue(undefined)
    await createCronArmer()(ping)
    await createCronArmer()(ping)
    expect(ping).toHaveBeenCalledTimes(2)
  })
})
