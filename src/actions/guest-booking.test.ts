/**
 * Regression tests for booking without an account.
 *
 * A booking link exists so people WITHOUT a DeepSpace account can book time,
 * yet `POST /api/actions/:name` required a verified JWT for everything except
 * `cancel-booking` / `reschedule-booking` — and those two are only reachable
 * because the caller presents a `cancelToken` they were already mailed. A
 * first-time booker holds no such secret, so every signed-out booking answered
 * `{"error":"Unauthorized"}` with 401 and the app's entire purpose was closed
 * to the people it exists for.
 *
 * What is asserted here is the whole authorization story of the fix:
 *  - a signed-out `schedule-event` succeeds, and the guest gets back a
 *    cancelToken that really does open the booking it stored (hash compared),
 *  - the row is attributed to the host and to nobody else — an anonymous
 *    caller cannot nominate a `guestUserId` and write into that account,
 *  - the confirmation email is sent on the app owner's identity (a guest has
 *    no credits to bill) and its manage link is built from the request origin,
 *    never from the caller-supplied one,
 *  - every action that is NOT on the public allowlist still answers 401
 *    without a JWT, and the cancelToken path still works,
 *  - a signed-in booking keeps its real identity and its existing behaviour.
 *
 * These run in plain vitest against `app.fetch()` with the RecordRoom DO
 * namespace and the api-worker binding stubbed, and a real ES256 keypair. What
 * that buys is the real Hono routing, the real JWT verification and the real
 * action code end to end; what it does not cover is the DO's own RBAC, which
 * the action deliberately bypasses via `x-app-action`.
 *
 * JWTs are minted with WebCrypto rather than `jose`: `jose` is an undeclared
 * hoisted transitive here and resolves inconsistently.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import app from '../../worker.js'
import type { Env } from '../../worker.js'

const ISSUER = 'https://auth.deep.space'
const ORIGIN = 'https://bookwithme.app.space'
const OWNER_JWT = 'owner-jwt-token'

const HOST = 'user_host'
const HOST_EMAIL = 'ada@host.example'
const BOOKER = 'user_booker'
const STRANGER = 'user_stranger'
const EVENT_TYPE_ID = 'et_intro'
const GUEST_EMAIL = 'gus@guest.example'

// ── JWT, on WebCrypto ───────────────────────────────────────────────────────

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function exportSpkiPem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('spki', key))
  const lines = (b64url(der).replace(/-/g, '+').replace(/_/g, '/') + '==').match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

async function mintJwt(privateKey: CryptoKey, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })))
  const payload = b64url(
    enc.encode(JSON.stringify({ sub: subject, iss: ISSUER, iat: now, exp: now + 3600 })),
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      enc.encode(`${header}.${payload}`),
    ),
  )
  // WebCrypto already emits the raw r||s form JWS wants — no DER unwrapping.
  return `${header}.${payload}.${b64url(signature)}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Room fixture ────────────────────────────────────────────────────────────

const OPEN_DAY = { isAvailable: true, blocks: [{ startTime: '00:00', endTime: '23:59' }] }

const AVAILABILITY = {
  userId: HOST,
  name: 'Standard Hours',
  timezone: 'UTC',
  timeGap: 0,
  maxBookingsPerDay: 0,
  sunday: OPEN_DAY,
  monday: OPEN_DAY,
  tuesday: OPEN_DAY,
  wednesday: OPEN_DAY,
  thursday: OPEN_DAY,
  friday: OPEN_DAY,
  saturday: OPEN_DAY,
}

const EVENT_TYPE = {
  userId: HOST,
  title: 'Intro call',
  description: '',
  duration: 30,
  location: 'deepspace-meets',
  isActive: true,
  sendExternalEmail: true,
  sendDeepSpaceMail: false,
  sendGcalInvite: false,
  bufferBefore: 0,
  bufferAfter: 0,
  durations: [],
  availabilityScheduleId: '',
  bookingQuestions: [],
  maxAttendees: 0,
}

/** An existing booking, so `cancel-booking` has something to read. */
const STORED_BOOKING = {
  eventTypeId: EVENT_TYPE_ID,
  eventTitle: 'Intro call',
  hostUserId: HOST,
  guestName: 'Someone Else',
  guestEmail: 'someone@guest.example',
  guestUserId: '',
  startTime: new Date(Date.now() + 86_400_000).toISOString(),
  endTime: new Date(Date.now() + 88_200_000).toISOString(),
  status: 'confirmed',
  cancelToken: 'a'.repeat(64),
}

/** A slot three days out at noon UTC — inside the always-open fixture window. */
function futureSlotIso(): string {
  const d = new Date(Date.now() + 3 * 86_400_000)
  d.setUTCHours(12, 0, 0, 0)
  return d.toISOString()
}

interface RoomCall {
  scope: string
  tool: string
  params: Record<string, any>
  userId: string | null
  appAction: string | null
}

interface ApiCall {
  url: string
  auth: string
  body: any
}

describe('POST /api/actions/:name', () => {
  let env: Env
  let roomCalls: RoomCall[]
  let apiCalls: ApiCall[]
  let bookerToken: string

  beforeEach(async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    bookerToken = await mintJwt(privateKey, BOOKER)

    roomCalls = []
    apiCalls = []
    let created = 0

    const respond = (tool: string, params: Record<string, any>) => {
      const collection = params.collection
      if (tool === 'records.get' && collection === 'event-types') {
        return { success: true, data: { record: { recordId: params.recordId, data: EVENT_TYPE } } }
      }
      if (tool === 'records.get' && collection === 'users') {
        return {
          success: true,
          data: { record: { recordId: params.recordId, data: { name: 'Ada Host' } } },
        }
      }
      if (tool === 'records.get' && collection === 'bookings') {
        return {
          success: true,
          data: { record: { recordId: params.recordId, data: STORED_BOOKING } },
        }
      }
      if (tool === 'records.query' && collection === 'host-contacts') {
        return {
          success: true,
          data: { records: [{ recordId: 'hc_1', data: { userId: HOST, email: HOST_EMAIL } }] },
        }
      }
      if (tool === 'records.query' && collection === 'availability') {
        return { success: true, data: { records: [{ recordId: 'av_1', data: AVAILABILITY }] } }
      }
      if (tool === 'records.create') {
        const recordId = `${collection}_${++created}`
        return { success: true, data: { recordId, record: { recordId, data: params.data } } }
      }
      if (tool === 'records.query') return { success: true, data: { records: [] } }
      return { success: true, data: {} }
    }

    env = {
      APP_NAME: 'bookwithme',
      DEEPSPACE_APP_ID: 'app_01TEST',
      OWNER_USER_ID: HOST,
      APP_OWNER_JWT: OWNER_JWT,
      AUTH_JWT_PUBLIC_KEY: await exportSpkiPem(publicKey),
      AUTH_JWT_ISSUER: ISSUER,
      RECORD_ROOMS: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          fetch: async (req: Request) => {
            const { tool, params } = (await req.json()) as {
              tool: string
              params: Record<string, any>
            }
            roomCalls.push({
              scope: id.name,
              tool,
              params,
              userId: req.headers.get('x-user-id'),
              appAction: req.headers.get('x-app-action'),
            })
            return Response.json(respond(tool, params))
          },
        }),
      },
      API_WORKER: {
        fetch: async (url: string, init?: RequestInit) => {
          apiCalls.push({
            url: String(url),
            auth: new Headers(init?.headers).get('authorization') ?? '',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          })
          if (String(url).includes('booking-host-freebusy')) {
            return Response.json({ success: true, data: { busyTimes: [] } })
          }
          return Response.json({ success: true, data: { id: 'email_1' } })
        },
      },
    } as unknown as Env

    // The room stub is addressed per scope, so an idFromName cache in the SDK
    // would defeat it; nothing here caches, but reset state is cheap insurance.
    roomCalls.length = 0
    apiCalls.length = 0
  })

  const post = (name: string, body: unknown, token?: string) =>
    app.fetch(
      new Request(`${ORIGIN}/api/actions/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      env,
    )

  const bookingBody = (extra: Record<string, unknown> = {}) => ({
    hostUserId: HOST,
    eventTypeId: EVENT_TYPE_ID,
    startTime: futureSlotIso(),
    guestEmail: GUEST_EMAIL,
    guestName: 'Gus Guest',
    meetingLink: 'https://meet.app.space/call/room-1',
    ...extra,
  })

  const bookingCreate = () =>
    roomCalls.find((c) => c.tool === 'records.create' && c.params.collection === 'bookings')

  const emailSends = () => apiCalls.filter((c) => c.url.includes('email/send'))

  // ── The bug: a signed-out visitor could not book ──────────────────────────

  it('books a meeting for a visitor with no account', async () => {
    // Pre-fix this is the reported failure verbatim: 401 {"error":"Unauthorized"},
    // surfaced in the browser as `[BookMePlatform] schedule-event FAILED: Unauthorized`.
    const res = await post('schedule-event', bookingBody())
    expect(res.status).toBe(200)

    const body = (await res.json()) as { success: boolean; data?: any; error?: string }
    expect(body.error).toBeUndefined()
    expect(body.success).toBe(true)
    expect(body.data.bookingId).toBeTruthy()
    expect(bookingCreate()).toBeDefined()
  })

  it('hands the guest a cancelToken that opens the booking it just stored', async () => {
    // Booking but never being able to cancel would be a second bug: the guest
    // has no account to come back to, so this token is their only way in.
    const res = await post('schedule-event', bookingBody())
    const { data } = (await res.json()) as { data: { cancelToken: string } }

    expect(data.cancelToken).toMatch(/^[0-9a-f-]{36}$/)
    const stored = bookingCreate()!.params.data.cancelToken
    expect(stored).not.toBe(data.cancelToken) // only the digest is persisted
    expect(stored).toBe(await sha256Hex(data.cancelToken))
  })

  it('runs the write as an app action with no user identity', async () => {
    await post('schedule-event', bookingBody())
    const create = bookingCreate()!
    expect(create.userId).toBe('')
    expect(create.appAction).toBe('true')
  })

  // ── Attribution: the caller may not nominate anyone ───────────────────────

  it('attributes the booking to the host and to no platform account', async () => {
    await post('schedule-event', bookingBody())
    const data = bookingCreate()!.params.data
    expect(data.hostUserId).toBe(HOST)
    expect(data.guestUserId).toBe('') // "booked by someone with no account"
    expect(data.guestEmail).toBe(GUEST_EMAIL)
    expect(data.status).toBe('confirmed')
  })

  it('ignores a guestUserId an anonymous caller nominates', async () => {
    // Believing it would let anyone holding the public link write a calendar
    // row into a stranger's user room and pin the booking to their account.
    await post('schedule-event', bookingBody({ guestUserId: STRANGER }))

    expect(bookingCreate()!.params.data.guestUserId).toBe('')
    expect(roomCalls.filter((c) => c.scope === `user:${STRANGER}`)).toEqual([])
  })

  it('writes only to the host room the booking link names', async () => {
    await post('schedule-event', bookingBody({ guestUserId: STRANGER }))
    const userScopes = new Set(
      roomCalls.filter((c) => c.scope.startsWith('user:')).map((c) => c.scope),
    )
    expect([...userScopes]).toEqual([`user:${HOST}`])
  })

  it('refuses an event type that does not belong to the named host', async () => {
    // The only binding between the link and the host: without it a signed-out
    // caller could book any host's slot against someone else's event type.
    const res = await post('schedule-event', bookingBody({ hostUserId: STRANGER }))
    const body = (await res.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Event type does not belong to this host')
    expect(bookingCreate()).toBeUndefined()
  })

  // ── Confirmation email ────────────────────────────────────────────────────

  it('sends the guest confirmation on the app owner identity', async () => {
    // A guest has no JWT and so no credits: billing the caller sends
    // `Bearer ` to the api-worker, which 401s, and the guest silently gets no
    // mail and therefore no cancel link.
    await post('schedule-event', bookingBody())
    const sends = emailSends()
    expect(sends.length).toBeGreaterThan(0)
    for (const send of sends) expect(send.auth).toBe(`Bearer ${OWNER_JWT}`)
    expect(sends.map((s) => s.body.to)).toContain(GUEST_EMAIL)
  })

  it('builds the manage link from the request origin, not the body', async () => {
    const res = await post(
      'schedule-event',
      bookingBody({ origin: 'https://evil.example' }),
    )
    const { data } = (await res.json()) as { data: { bookingId: string; cancelToken: string } }

    const guestMail = emailSends().find((s) => s.body.to === GUEST_EMAIL)!
    expect(guestMail.body.html).toContain(
      `${ORIGIN}/manage/${data.bookingId}/${data.cancelToken}`,
    )
    expect(guestMail.body.html).not.toContain('evil.example')
  })

  // ── Everything else still needs a JWT ─────────────────────────────────────

  it.each([
    ['delete-booking', { bookingId: 'bk_1' }],
    ['mark-booking-no-show', { bookingId: 'bk_1' }],
    ['undo-booking-no-show', { bookingId: 'bk_1' }],
    ['get-calendar-events', { userId: HOST, dateStart: '2026-01-01', dateEnd: '2026-01-02' }],
  ])('refuses %s without a JWT, and touches nothing', async (name, body) => {
    const res = await post(name, body)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(roomCalls).toEqual([])
  })

  it.each(['cancel-booking', 'reschedule-booking'])(
    'still refuses %s when no cancelToken is presented',
    async (name) => {
      // These two are reachable signed-out only *with* the per-booking secret.
      // Opening schedule-event must not have loosened that.
      const res = await post(name, { bookingId: 'bk_1', newStartTime: futureSlotIso() })
      expect(res.status).toBe(401)
      expect(roomCalls).toEqual([])
    },
  )

  it('keeps the cancelToken path working for a guest holding one', async () => {
    const res = await post('cancel-booking', { bookingId: 'bk_1', cancelToken: 'wrong-token' })
    // Admitted by the route, then rejected by the action on the token itself.
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: false,
      error: 'Not authorized to cancel this booking',
    })
  })

  it('serves the host busy intervals to a signed-out picker', async () => {
    // Without this the public picker offers slots the host's calendar blocks,
    // and every one of them fails on submit.
    const res = await post('get-busy-times', {
      hostUserId: HOST,
      dateStart: new Date().toISOString(),
      dateEnd: futureSlotIso(),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { busyTimes: [] } })
  })

  it('answers 404 for an unknown action rather than leaking the gate', async () => {
    expect((await post('no-such-action', {})).status).toBe(404)
  })

  // ── The authenticated path is unchanged ───────────────────────────────────

  it('keeps a signed-in booking on the caller identity', async () => {
    await post('schedule-event', bookingBody({ guestUserId: BOOKER }), bookerToken)

    const create = bookingCreate()!
    expect(create.userId).toBe(BOOKER)
    expect(create.params.data.guestUserId).toBe(BOOKER)
    // The booker's own calendar still gets the meeting mirrored into it.
    expect(roomCalls.some((c) => c.scope === `user:${BOOKER}`)).toBe(true)
  })

  it('still bills a signed-in booker for their own confirmation email', async () => {
    await post('schedule-event', bookingBody(), bookerToken)
    for (const send of emailSends()) expect(send.auth).toBe(`Bearer ${bookerToken}`)
  })

  it('treats an unverifiable JWT as anonymous, never as its claimed subject', async () => {
    const impostor = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    const forged = await mintJwt(impostor.privateKey, HOST)

    // A public action still runs — it never keyed off identity — but as nobody.
    await post('schedule-event', bookingBody({ guestUserId: HOST }), forged)
    expect(bookingCreate()!.userId).toBe('')
    expect(bookingCreate()!.params.data.guestUserId).toBe('')

    // A non-public one is refused outright.
    const res = await post('delete-booking', { bookingId: 'bk_1' }, forged)
    expect(res.status).toBe(401)
  })
})
