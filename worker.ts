/**
 * App Worker — Hono-based Cloudflare Worker for DeepSpace apps.
 *
 * Each app owns its RecordRoom DOs. Schemas are baked in at deploy time.
 *
 * Handles:
 *   - WebSocket → app's own RecordRoom DO (real-time data)
 *   - Auth proxy → auth-worker (same-origin cookies)
 *   - Integration proxy → api-worker (LLM, search, etc.)
 *   - AI chat (Vercel AI SDK + DeepSpace proxy)
 *   - Server actions (app-defined, bypass user RBAC)
 *   - Scoped R2 file storage
 *   - Scheduled tasks (self-scheduling AppCronRoom DO)
 *   - Static asset serving with SPA fallback
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  verifyJwt,
  createDeepSpaceAI,
  buildCronContext,
  authWorkerFetch,
  authenticatedRoomRequest,
  resolveAppRole as sdkResolveAppRole,
} from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import {
  RecordRoom,
  YjsRoom,
  CanvasRoom,
  CronRoom,
  PresenceRoom,
} from 'deepspace/worker'
import type { ActionResult, DOManifest, DOBindings } from 'deepspace/worker'
import type { ActionTools } from './src/lib/action-types.js'
import { streamText, stepCountIs } from 'ai'
import { actions, PUBLIC_ACTIONS } from './src/actions/index.js'
import { handler as cronTaskHandler, tasks as cronTasks } from './src/cron.js'
import { schemas } from './src/schemas.js'
import { integrations } from './src/integrations.js'
import { buildSystemPrompt, buildReadOnlyTools } from './src/ai/tools.js'
import { BOOKING_ASSISTANT_MODEL_ID, CHAT_MAX_OUTPUT_TOKENS } from './src/ai/models.js'
import { reachesUserNamespace } from './src/lib/file-proxy-scope.js'
import { cronRoomName, createCronArmer } from './src/lib/cron-arm.js'

// =============================================================================
// DO Manifest — declares all Durable Objects for dynamic deploy bindings
// =============================================================================

export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
] as const satisfies DOManifest

// =============================================================================
// Durable Objects — extend to customize behavior
// =============================================================================

export class AppRecordRoom extends RecordRoom {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppYjsRoom extends YjsRoom {}
export class AppCanvasRoom extends CanvasRoom {}
export class AppPresenceRoom extends PresenceRoom {}

/**
 * Per-app scheduled task DO. Reads `tasks` from `src/cron.ts` at construction
 * (validated by CronRoom) and self-schedules alarms. Each fire calls `onTask`,
 * which builds a CronContext and dispatches to the BookMe cron handler.
 * Replaces the old HMAC-authenticated `/internal/cron` HTTP route.
 */
export class AppCronRoom extends CronRoom<Env> {
  private appEnv: Env
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
    this.appEnv = env
  }

  protected async onTask(taskName: string): Promise<void> {
    const roomId = `app:${this.appEnv.APP_NAME}`
    const ctx = buildCronContext(this.appEnv as any, this.appEnv.OWNER_USER_ID, roomId)
    await cronTaskHandler(taskName, ctx)
  }
}

// =============================================================================
// Types
// =============================================================================

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /** Production service binding; local dev uses `PLATFORM_WORKER_URL` in `.dev.vars` instead. */
  PLATFORM_WORKER?: Fetcher
  /** HTTPS base for the DeepSpace platform worker (injected by `deepspace dev` or set manually). */
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN?: string
  /** Production service binding; local dev uses `API_WORKER_URL` from `.dev.vars` instead. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  APP_NAME: string
  ALLOW_DEBUG_ROUTES?: string
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived JWT minted for the app owner at deploy time. Server-side
   * code (actions, cron, AI helpers) uses this to authenticate to the
   * api-worker for developer-billed calls — the owner is billed because
   * they are the JWT subject.
   */
  APP_OWNER_JWT: string
  INTERNAL_STORAGE_HMAC_SECRET: string
  /** Default From: for `email/send` when the body omits `from` (verified domain in Resend). */
  BOOKING_EMAIL_FROM?: string
  /**
   * When `true` / `1` / `yes`, skip `email/send` (Resend) — no outbound call to api-worker.
   * Set in [vars] or `.dev.vars` while testing other features; remove or set false for real mail.
   */
  DISABLE_BOOKING_EMAIL?: string
}

function isBookingEmailDisabled(env: Env): boolean {
  const v = env.DISABLE_BOOKING_EMAIL?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

type AppContext = { Bindings: Env }

/**
 * API worker: production uses the `API_WORKER` service binding (dummy host `https://api-worker/...`);
 * local dev uses `API_WORKER_URL` + pathname (see deepspace `resolveTransport`).
 */
async function apiWorkerFetch(env: Env, dummyUrl: string, init?: RequestInit): Promise<Response> {
  if (env.API_WORKER) {
    return env.API_WORKER.fetch(dummyUrl, init)
  }
  if (env.API_WORKER_URL) {
    const u = new URL(dummyUrl)
    const target = `${env.API_WORKER_URL.replace(/\/$/, '')}${u.pathname}${u.search}`
    return fetch(target, init)
  }
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'API worker not configured (API_WORKER or API_WORKER_URL)' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/**
 * Platform worker: binding or `PLATFORM_WORKER_URL` (same pattern as API worker).
 */
async function platformWorkerFetch(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathAndQuery = url.pathname + url.search
  const dummy = `https://platform-worker${pathAndQuery}`

  if (env.PLATFORM_WORKER) {
    return env.PLATFORM_WORKER.fetch(new Request(dummy, req))
  }
  if (env.PLATFORM_WORKER_URL) {
    const target = `${env.PLATFORM_WORKER_URL.replace(/\/$/, '')}${pathAndQuery}`
    return fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
    })
  }
  return new Response(
    JSON.stringify({
      error: 'Platform worker not configured (PLATFORM_WORKER binding or PLATFORM_WORKER_URL)',
    }),
    { status: 502, headers: { 'Content-Type': 'application/json' } },
  )
}

// =============================================================================
// App
// =============================================================================

const app = new Hono<AppContext>()
app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Arm the cron room
//
// Without this the send-reminders task in src/cron.ts never runs: CronRoom only
// schedules its first alarm when the DO is first touched, and nothing else in
// BookMe ever touches it. See src/lib/cron-arm.ts for the full why.
//
// Mounted on /api/* rather than * on purpose. Arming is a one-shot event that
// self-perpetuates once it lands, so it does not need the widest possible
// request surface — it needs the requests that mean somebody is actually using
// the app. Both audiences reach /api/* within the first second: a signed-in
// host's SPA asks for /api/auth/token on boot, and the public booking flow
// posts to /api/actions/* (schedule-event, or cancel/reschedule straight from
// a confirmation email, which a logged-out guest may call). Mounting on *
// instead would put the ping on the SPA-fallback route, firing it on the first
// favicon or stylesheet request of every new isolate — including a crawler's.
// ---------------------------------------------------------------------------

const armCron = createCronArmer()

app.use('/api/*', async (c, next) => {
  const arming = armCron(() => {
    const ns = c.env.CRON_ROOMS
    return ns.get(ns.idFromName(cronRoomName(c.env.APP_NAME))).fetch('https://cron-arm/ping')
  })
  // waitUntil, never await: arming must not sit in front of the response.
  // `c.executionCtx` throws when the app is driven without one (unit tests call
  // app.fetch(request, env) with two arguments); the ping is already in flight
  // by then, and a missing ExecutionContext must not turn a real route into a
  // 500 just because arming rode along on it.
  if (arming) {
    try {
      c.executionCtx.waitUntil(arming)
    } catch {
      /* no ExecutionContext to hand it to; the ping runs detached */
    }
  }
  await next()
})

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

async function resolveAuth(req: Request, env: Env): Promise<VerifyResult | null> {
  const header = req.headers.get('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  return (await verifyJwt(jwtConfig(env), token)).result
}

/**
 * The SDK's resolveAppRole() addresses the RecordRoom as `app:${DEEPSPACE_APP_ID}`.
 * This app's room — the one holding the `users` rows this reads — is keyed
 * `app:${APP_NAME}` (SCOPE_ID in src/constants.ts, and every idFromName call in
 * this file). Hand the helper the name the room is actually stored under. Every
 * call site must go through this wrapper, never the raw export: a bare call
 * reads an empty room and returns 'viewer' for everyone but the owner. The
 * import is aliased so the raw export is unreachable by this name.
 */
function resolveAppRole(env: Env, userId: string) {
  return sdkResolveAppRole(
    {
      RECORD_ROOMS: env.RECORD_ROOMS,
      DEEPSPACE_APP_ID: env.APP_NAME,
      OWNER_USER_ID: env.OWNER_USER_ID,
    },
    userId,
  )
}

// ---------------------------------------------------------------------------
// Social OAuth redirect + code exchange
// ---------------------------------------------------------------------------

app.get('/api/auth/social-redirect', (c) => {
  const provider = c.req.query('provider')
  if (!provider) return c.json({ error: 'Missing provider' }, 400)

  const appOrigin = new URL(c.req.url).origin
  const authOrigin = new URL(c.env.AUTH_WORKER_URL).origin

  return c.redirect(
    `${authOrigin}/login/social?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent(appOrigin)}`,
  )
})

app.get('/api/auth/oauth-complete', async (c) => {
  const code = c.req.query('code')
  const appOrigin = new URL(c.req.url).origin

  if (!code) return c.redirect(appOrigin)

  const res = await fetch(`${c.env.AUTH_WORKER_URL}/api/auth/exchange-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })

  if (!res.ok) return c.redirect(appOrigin)
  const data = (await res.json()) as { sessionToken?: string }
  if (!data.sessionToken) return c.redirect(appOrigin)
  const sessionToken = data.sessionToken

  return new Response(null, {
    status: 302,
    headers: {
      Location: appOrigin,
      'Set-Cookie': `__Secure-better-auth.session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  })
})

// ---------------------------------------------------------------------------
app.all('/api/auth/sign-out', async (c) => {
  try {
    await authWorkerFetch(c.env, '/api/auth/sign-out', {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    })
  } catch {
    // Always expire the app-scoped cookie, even if auth-worker is unavailable.
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': '__Secure-better-auth.session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  })
})

// ---------------------------------------------------------------------------
// Auth proxy → auth-worker (same-origin cookies)
// ---------------------------------------------------------------------------

app.all('/api/auth/*', async (c) => {
  const url = new URL(c.req.url)
  const authUrl = new URL(url.pathname + url.search, c.env.AUTH_WORKER_URL)
  const res = await fetch(authUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  })
  const headers = new Headers(res.headers)
  const setCookie = headers.get('set-cookie')
  if (setCookie) {
    headers.set('set-cookie', setCookie.replace(/;\s*Domain=[^;]*/gi, ''))
  }
  return new Response(res.body, { status: res.status, headers })
})

// ---------------------------------------------------------------------------
// Debug routes are available only when explicitly enabled, so production stays
// closed by default. The DO's debug handlers are unauthenticated and read
// identity from REQUEST HEADERS, so forwarding c.req.raw unguarded would let
// any caller assert x-user-id / x-user-role. Require a verified admin first.
app.all('/api/debug/*', async (c) => {
  if (c.env.ALLOW_DEBUG_ROUTES !== 'true') return c.notFound()
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'unauthorized' }, 401)
  if ((await resolveAppRole(c.env, auth.userId)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.APP_NAME}`))
  return stub.fetch(c.req.raw)
})

// ---------------------------------------------------------------------------
// Integrations proxy → api-worker
// ---------------------------------------------------------------------------

app.get('/api/integrations', async (c) => {
  try {
    const res = await apiWorkerFetch(c.env, 'https://api-worker/api/integrations')
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Failed to fetch integration catalog' }, 502)
  }
})

// OAuth connection management is always user-billed.
app.get('/api/integrations/status', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  try {
    const res = await apiWorkerFetch(c.env, 'https://api-worker/api/integrations/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Status proxy failed' }, 502)
  }
})

app.delete('/api/integrations/oauth/:provider/disconnect', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Sign in required' }, 401)
  const token = c.req.header('Authorization')?.slice(7)
  const provider = c.req.param('provider')
  try {
    const res = await apiWorkerFetch(
      c.env,
      `https://api-worker/api/integrations/oauth/${encodeURIComponent(provider)}/disconnect`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json({ error: 'Disconnect proxy failed' }, 502)
  }
})

app.all('/api/integrations/:path{.+}', async (c) => {
  const rest = c.req.param('path')
  if (rest === 'email/send' && isBookingEmailDisabled(c.env)) {
    console.log('[bookme] email/send skipped (DISABLE_BOOKING_EMAIL)')
    return c.json({ success: true, data: { skipped: true } })
  }
  const integrationName = rest.split('/')[0] ?? rest
  const billingMode = integrations[integrationName]?.billing ?? 'developer'

  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth && billingMode === 'user') {
    return c.json({ error: 'Sign in required for this integration' }, 401)
  }

  const target = `/api/integrations/${rest}`
  const url = new URL(c.req.url)
  const qs = url.search

  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') ?? 'application/json',
  }

  if (billingMode === 'developer') {
    headers['Authorization'] = `Bearer ${c.env.APP_OWNER_JWT}`
  } else {
    const token = c.req.header('Authorization')?.slice(7)
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  const body = hasBody ? await c.req.text() : undefined

  try {
    const res = await apiWorkerFetch(c.env, `https://api-worker${target}${qs}`, {
      method: c.req.method,
      headers,
      body,
    })
    // Log email-related integration calls to aid debugging (status only — never the response body,
    // which can echo recipient addresses and other PII).
    if (rest.includes('email')) {
      console.log(`[integration-proxy] ${c.req.method} ${rest} → HTTP ${res.status}`)
    }
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch (err) {
    console.error(`[integration-proxy] ${c.req.method} ${rest} → FAILED:`, err)
    return c.json({ error: 'Integration proxy failed' }, 502)
  }
})

// ---------------------------------------------------------------------------
// WebSocket routes
// ---------------------------------------------------------------------------

/**
 * Proxy a browser WebSocket to its room Durable Object.
 *
 * Identity crosses the worker → DO hop in HEADERS, never on the URL.
 * `authenticatedRoomRequest` strips `token`, the five legacy identity query
 * params and the five inbound identity headers before setting verified ones,
 * so a client can spoof neither channel. Three states: no token = anonymous
 * (the public booking page relies on this), invalid token = 401, valid token =
 * JWT identity.
 *
 * Name and avatar are forwarded because without a name the RecordRoom's
 * registerUser() seeds the shared `users` row with the "Anonymous" sentinel,
 * which is what guests would then see as the host's name on the booking page.
 *
 * The verified EMAIL is deliberately withheld from every room: this app's
 * `users` collection is world-readable (`read: true` — the public booking page
 * reads host name/avatar and the app room accepts anonymous connections), and
 * registerUser() persists whatever email it is handed into that row. Host email
 * lives in the private `host-contacts` collection instead (see
 * src/actions/schedule-event.ts). The SDK forwards `claims.email` when it is
 * present, so the claim is dropped here rather than unset downstream.
 */
function wsRoute(
  doNamespace: (env: Env) => DurableObjectNamespace,
  extraIdentity?: (auth: VerifyResult, env: Env) => { role?: string } | Promise<{ role?: string }>,
) {
  return async (c: any) => {
    const id = c.req.param('roomId') ?? c.req.param('docId') ?? c.req.param('scopeId')
    if (!id) return new Response('Not found', { status: 404 })
    const token = new URL(c.req.url).searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }

    const roomRequest = authenticatedRoomRequest(
      c.req.raw,
      auth && { userId: auth.userId, claims: { name: auth.claims.name, image: auth.claims.image } },
      auth ? await extraIdentity?.(auth, c.env) : undefined,
    )
    const ns = doNamespace(c.env)
    const stub = ns.get(ns.idFromName(id))
    return stub.fetch(roomRequest)
  }
}

// No extra identity: the RecordRoom derives the connection's role from the
// `users` row it maintains itself, and name/avatar already ride in the verified
// headers.
app.get('/ws/:roomId', wsRoute((env) => env.RECORD_ROOMS))

app.get('/ws/yjs/:docId', wsRoute(
  (env) => env.YJS_ROOMS,
  async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
))

app.get('/ws/canvas/:docId', wsRoute(
  (env) => env.CANVAS_ROOMS,
  async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
))

// Write access (trigger / pause / resume) follows the caller's real app role
// from the `users` collection instead of a constant 'member'. Anonymous
// connections carry no role header and become viewers, which CronRoom enforces
// as read-only.
app.get('/ws/cron/:roomId', wsRoute(
  (env) => env.CRON_ROOMS,
  async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
))

// v0.19.0 dropped email and avatar from ephemeral presence — PresencePeer now
// carries only userId/userName, and the name rides in the verified headers, so
// there is no extra identity to forward here.
app.get('/ws/presence/:scopeId', wsRoute((env) => env.PRESENCE_ROOMS))

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

// Guest self-service actions: a logged-out guest can invoke these from a confirmation-email link
// WITHOUT a JWT, authorized solely by the per-booking cancelToken they carry (the action verifies the
// SHA-256 token match before mutating anything). The 401 gate is bypassed only for this exact set and
// only when a cancelToken is actually present.
const GUEST_TOKEN_ACTIONS = new Set(['cancel-booking', 'reschedule-booking'])

app.post('/api/actions/:name', async (c) => {
  const name = c.req.param('name')
  const action = actions[name]
  if (!action) return c.json({ error: 'Action not found' }, 404)

  const params = await c.req.json<Record<string, unknown>>()
  const auth = await resolveAuth(c.req.raw, c.env)

  const hasGuestToken =
    GUEST_TOKEN_ACTIONS.has(name) &&
    typeof params.cancelToken === 'string' &&
    params.cancelToken.trim().length > 0

  // Three ways past this gate, and only three:
  //  - a verified JWT (every authoring action needs one),
  //  - a per-booking cancelToken for the two guest self-service actions above,
  //  - membership of PUBLIC_ACTIONS, which is the booking link itself: a first-time booker holds
  //    no secret at all, so those actions authorize on what they can verify server-side (the event
  //    type is active and belongs to the named host, the slot passes the host's own availability
  //    and conflict rules) rather than on who is asking. See src/actions/index.ts.
  if (!auth && !hasGuestToken && !PUBLIC_ACTIONS.has(name)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // The confirmation email's manage/cancel link is built from `origin`. Take it from the request
  // the browser actually made, never from the body: schedule-event is reachable without a JWT and
  // mails an arbitrary address, so a caller-chosen origin would put an attacker's URL in front of
  // a stranger, in a message sent from this app's own sender. Set unconditionally, so the guest's
  // cancel link is also present when a client omits the field.
  params.origin = new URL(c.req.url).origin

  // Empty userId for both no-JWT paths: cancel/reschedule self-authorize via hasValidToken, the
  // public actions never key anything off the caller's identity, and the x-app-action header in
  // createActionTools bypasses per-user RBAC for the writes they do make.
  const userId = auth?.userId ?? ''
  const authHeader = c.req.header('Authorization')
  const callerJwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const tools = createActionTools(c.env, userId, callerJwt)
  const result = await action({ userId, params, tools })
  return c.json(result as unknown as Record<string, unknown>)
})

// ---------------------------------------------------------------------------
// AI chat — multi-turn tool-use via Vercel AI SDK + DeepSpace proxy
// ---------------------------------------------------------------------------

app.post('/api/ai/chat', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const { messages } = await c.req.json<{ messages: Array<{ role: string; content: string }> }>()
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'messages array is required' }, 400)
  }

  const jwt = c.req.header('Authorization')!.slice(7)

  const anthropic = createDeepSpaceAI(c.env, 'anthropic', { authToken: jwt })

  // Read-only tools that execute against the app's RecordRoom DO
  const scopeId = `app:${c.env.APP_NAME}`
  const tools = buildReadOnlyTools(async (toolName, params) => {
    const doId = c.env.RECORD_ROOMS.idFromName(scopeId)
    const stub = c.env.RECORD_ROOMS.get(doId)
    const res = await stub.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': auth.userId },
      body: JSON.stringify({ tool: toolName, params }),
    }))
    return res.json()
  })

  // The model id and the output budget both come from `src/ai/models.ts`.
  // Never inline either here: a retired literal is a provider 404 that only
  // shows up when a user opens the assistant, and an unset budget makes the
  // proxy reserve credit against the model's 128k ceiling.
  const result = streamText({
    model: anthropic(BOOKING_ASSISTANT_MODEL_ID) as Parameters<typeof streamText>[0]['model'],
    system: buildSystemPrompt(c.env.APP_NAME, schemas),
    messages: messages as NonNullable<Parameters<typeof streamText>[0]['messages']>,
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    stopWhen: stepCountIs(5),
    onError: ({ error }) => {
      console.error('[ai-chat] streamText error:', error)
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('[ai-chat] response error:', error)
      return error instanceof Error ? error.message : String(error)
    },
  })
})

// ---------------------------------------------------------------------------
// Platform worker proxy (inbox WS, platformFetch, etc.) — same-origin `/platform/*`
// ---------------------------------------------------------------------------

app.all('/platform/:path{.+}', async (c) => {
  return platformWorkerFetch(c.env, c.req.raw)
})

// ---------------------------------------------------------------------------
// Scoped R2 files → platform-worker
// ---------------------------------------------------------------------------

app.all('/api/files/*', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)

  // Nothing in this app stores or reads a scoped R2 file — no useR2Files, no
  // upload, no stored file URL rendered anywhere — so there is no public read
  // to serve and the whole mount requires a verified JWT: reads, listing,
  // uploads and deletes alike.
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const url = new URL(c.req.url)

  // A verified identity is not enough on its own: the platform resolves
  // scope 'app' to `apps/<resourceId>/`, scope 'self' to a strict descendant
  // of it, and admits keys with `key.startsWith(prefix)`. See
  // src/lib/file-proxy-scope.ts for why that lets one signed-in user reach
  // another's files and what this refuses.
  if (reachesUserNamespace(url.pathname, url.searchParams)) {
    return c.json({ error: 'Access denied: key belongs to a private scope' }, 403)
  }

  const platformUrl = new URL(c.req.url)
  platformUrl.pathname = url.pathname.replace('/api/files', '/internal/files')

  const headers = new Headers(c.req.raw.headers)
  // Strip any caller-supplied identity before setting our own. Only a
  // JWT-derived userId may reach the platform-worker — otherwise an
  // unauthenticated caller could send `x-user-id: <victim>` with `?scope=self`
  // and the platform would resolve, and let it mutate, the victim's prefix.
  headers.delete('x-user-id')
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN ?? '')
  headers.set('x-app-id', c.env.DEEPSPACE_APP_ID)
  headers.set('x-user-id', auth.userId)

  const resp = await platformWorkerFetch(
    c.env,
    new Request(platformUrl.toString(), {
      method: c.req.method,
      headers,
      body: c.req.raw.body,
    }),
  )

  // Rewrite URLs in JSON responses to use the app's origin
  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await resp.json()) as Record<string, unknown>
    const rewriteUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, url.origin)
    if (typeof body.url === 'string') body.url = rewriteUrl(body.url)
    if (Array.isArray(body.files)) {
      for (const f of body.files as Array<Record<string, unknown>>) {
        if (typeof f.url === 'string') f.url = rewriteUrl(f.url)
      }
    }
    return c.json(body, resp.status as any)
  }

  return new Response(resp.body, { status: resp.status, headers: resp.headers })
})

// Cron runs in the per-app AppCronRoom DO (see top of file). The old
// HMAC-authenticated `/internal/cron` HTTP route was removed in the
// deepspace 0.4.3 migration — the DO self-schedules via alarms.

// ---------------------------------------------------------------------------
// Same-origin browser proxy for authenticated DeepSpace billing hooks.
const BROWSER_PROXY_ROUTES = [
  ['GET', '/_deepspace/subscriptions/me'],
  ['POST', '/_deepspace/subscriptions/checkout'],
  ['POST', '/_deepspace/subscriptions/portal'],
  ['POST', '/_deepspace/charges/create'],
  ['GET', '/_deepspace/charges/me'],
] as const

app.all('/_deepspace/*', async (c) => {
  const url = new URL(c.req.url)
  const method = c.req.method
  const allowed = BROWSER_PROXY_ROUTES.some(
    ([allowedMethod, path]) => allowedMethod === method && path === url.pathname,
  )
  if (!allowed) return c.json({ error: 'not_found' }, 404)

  const auth = await resolveAuth(c.req.raw, c.env)
  const userId = auth?.userId
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const forwardedParams = new URLSearchParams(url.search)
  forwardedParams.set('appId', c.env.DEEPSPACE_APP_ID)
  const queryString = forwardedParams.toString()
  const apiPath =
    url.pathname.replace('/_deepspace/', '/api/') + (queryString ? `?${queryString}` : '')

  const headers = new Headers(c.req.raw.headers)
  headers.delete('x-user-id')
  headers.delete('x-app-identity-token')
  headers.delete('x-app-id')
  if (c.env.APP_IDENTITY_TOKEN) {
    headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN)
    headers.set('x-app-id', c.env.DEEPSPACE_APP_ID)
  }
  headers.set('x-user-id', userId)

  return apiWorkerFetch(c.env, `https://api-worker${apiPath}`, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : c.req.raw.body,
  })
})

// ---------------------------------------------------------------------------
// Static assets (SPA fallback)
// ---------------------------------------------------------------------------

app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw)
  if (response.status === 404) {
    const url = new URL(c.req.url)
    // A FILE, not a client route: a miss must 404. Returning the shell here
    // is HTML parsed as JavaScript, which is a blank page.
    if (url.pathname.slice(url.pathname.lastIndexOf('/') + 1).includes('.')) {
      return c.json({ error: 'not_found' }, 404)
    }
    url.pathname = '/'
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
  }
  return response
})

// =============================================================================
// Action Tools — route to app's own RecordRoom DO
// =============================================================================

function createActionTools(env: Env, userId: string, callerJwt: string): ActionTools {
  async function execTool(tool: string, params: Record<string, unknown>): Promise<ActionResult> {
    // Route to the correct DO instance based on scopeId (e.g. user:{id} vs app:{name}).
    const targetScope = (params.scopeId as string) || `app:${env.APP_NAME}`
    const doId = env.RECORD_ROOMS.idFromName(targetScope)
    const stub = env.RECORD_ROOMS.get(doId)
    // deepspace 0.4.3 handleToolExecute reads identity + RBAC-bypass from REQUEST HEADERS:
    // x-user-id and x-app-action (see node_modules/deepspace/dist/worker.js:2163-2164). It does
    // NOT read the appAction query param or a userId field in the body. Sending them there left
    // every write running as an anonymous viewer, so bookings updates/deletes hit "UPDATE/DELETE
    // DENIED" (ownerField=hostUserId) even though the server action already authorized the caller.
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          'x-app-action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return res.json() as Promise<ActionResult>
  }

  async function callIntegration(endpoint: string, data?: unknown): Promise<ActionResult> {
    if (endpoint === 'email/send' && isBookingEmailDisabled(env)) {
      console.log('[bookme] email/send skipped in action tools (DISABLE_BOOKING_EMAIL)')
      return { success: true, data: { skipped: true } }
    }
    const integrationName = endpoint.split('/')[0]
    const billingMode = integrations[integrationName]?.billing ?? 'developer'

    // Use the owner JWT for developer-billed calls, the caller's JWT otherwise.
    // The api-worker bills the JWT subject — no client-supplied override.
    //
    // A user-billed call with no caller JWT only happens on a no-JWT action path (a guest booking,
    // or a guest cancelling from their email link). There is no user to bill there, and sending
    // `Bearer ` just 401s at the api-worker — which is how a guest's confirmation email, and with
    // it their only cancel link, silently went missing. Those sends fall back to the app owner,
    // the identity cron reminders already send under. schedule-event's per-guest-email throttle
    // (EMAIL_RL_MAX) is what bounds the cost of that.
    const jwt = billingMode === 'developer' || !callerJwt ? env.APP_OWNER_JWT : callerJwt

    let body = data
    if (endpoint === 'email/send' && body && typeof body === 'object' && body !== null) {
      const o = body as Record<string, unknown>
      const from = o.from
      if (typeof from !== 'string' || !from.trim()) {
        const fallback =
          env.BOOKING_EMAIL_FROM?.trim() || 'BookMe <onboarding@resend.dev>'
        body = { ...o, from: fallback }
      }
    }

    const res = await apiWorkerFetch(env, `https://api-worker/api/integrations/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    })
    return res.json() as Promise<ActionResult>
  }

  return {
    create: (sid, collection, data) => execTool('records.create', { scopeId: sid, collection, data }),
    update: (sid, collection, recordId, data) => execTool('records.update', { scopeId: sid, collection, recordId, data }),
    remove: (sid, collection, recordId) => execTool('records.delete', { scopeId: sid, collection, recordId }),
    get: (sid, collection, recordId) => execTool('records.get', { scopeId: sid, collection, recordId }),
    query: (sid, collection, options) => execTool('records.query', { scopeId: sid, collection, ...options }),
    integration: callIntegration,
  }
}

export default app
