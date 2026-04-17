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
 *   - HMAC-authenticated cron
 *   - Static asset serving with SPA fallback
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  verifyJwt,
  verifyInternalSignature,
  buildInternalPayload,
  createDeepSpaceAI,
  buildCronContext,
} from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import {
  RecordRoom,
  YjsRoom,
  CanvasRoom,
  MediaRoom,
  PresenceRoom,
} from 'deepspace/worker'
import type { ActionTools, ActionResult, DOManifest, DOBindings } from 'deepspace/worker'
import { streamText } from 'ai'
import { actions } from './src/actions/index.js'
import { handler as cronTaskHandler } from './src/cron.js'
import { schemas } from './src/schemas.js'
import { integrations } from './src/integrations.js'
import { buildSystemPrompt, buildReadOnlyTools } from './src/ai/tools.js'
import type { BookMeActionTools } from './src/types/book-me-tools.js'

// =============================================================================
// DO Manifest — declares all Durable Objects for dynamic deploy bindings
// =============================================================================

export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'MEDIA_ROOMS', className: 'AppMediaRoom', sqlite: true },
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
export class AppMediaRoom extends MediaRoom {}
export class AppPresenceRoom extends PresenceRoom {}

// =============================================================================
// Types
// =============================================================================

interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  FILES: R2Bucket
  /** Production service binding; local dev uses `PLATFORM_WORKER_URL` in `.dev.vars` instead. */
  PLATFORM_WORKER?: Fetcher
  /** HTTPS base for the DeepSpace platform worker (injected by `deepspace dev` or set manually). */
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN?: string
  /** Production service binding; local dev uses `API_WORKER_URL` from `.dev.vars` instead. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  /** Service binding to the deepspace calendar worker; absent in local dev. */
  CALENDAR_WORKER?: Fetcher
  /** HTTP base URL for the calendar worker; used in local dev when CALENDAR_WORKER binding is absent. */
  CALENDAR_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  APP_NAME: string
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
 * Calendar worker: production uses the `CALENDAR_WORKER` service binding.
 * Local dev falls back to `CALENDAR_WORKER_URL` (set in .dev.vars).
 * Returns null when neither is configured.
 */
async function calendarWorkerFetch(env: Env, path: string, body: unknown): Promise<Response | null> {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-identity-token': env.APP_IDENTITY_TOKEN ?? '',
    },
    body: JSON.stringify(body),
  }
  if (env.CALENDAR_WORKER) {
    return env.CALENDAR_WORKER.fetch(new Request(`https://calendar-worker${path}`, init))
  }
  if (env.CALENDAR_WORKER_URL) {
    const target = `${env.CALENDAR_WORKER_URL.replace(/\/$/, '')}${path}`
    return fetch(target, init)
  }
  return null
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
    // Log email-related integration calls to aid debugging
    if (rest.includes('send-email') || rest.includes('email') || rest.includes('email/send')) {
      const responseText = await res.clone().text()
      console.log(`[integration-proxy] ${c.req.method} ${rest} → HTTP ${res.status}`, responseText.slice(0, 300))
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

function wsRoute(
  doNamespace: (env: Env) => DurableObjectNamespace,
  extraParams?: (auth: VerifyResult) => Record<string, string>,
) {
  return async (c: any) => {
    const id = c.req.param('roomId') ?? c.req.param('docId') ?? c.req.param('scopeId')
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')
    const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null

    const doUrl = new URL(c.req.url)
    if (auth) {
      doUrl.searchParams.set('userId', auth.userId)
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams(auth))) {
          doUrl.searchParams.set(k, v)
        }
      }
    }
    doUrl.searchParams.delete('token')

    const ns = doNamespace(c.env)
    const stub = ns.get(ns.idFromName(id))
    return stub.fetch(new Request(doUrl.toString(), c.req.raw))
  }
}

app.get('/ws/:roomId', wsRoute((env) => env.RECORD_ROOMS))

app.get('/ws/yjs/:docId', wsRoute((env) => env.YJS_ROOMS, () => ({ role: 'member' })))

app.get('/ws/canvas/:docId', wsRoute((env) => env.CANVAS_ROOMS, () => ({ role: 'member' })))

app.get('/ws/media/:roomId', wsRoute((env) => env.MEDIA_ROOMS, () => ({ role: 'member' })))

app.get('/ws/presence/:scopeId', wsRoute(
  (env) => env.PRESENCE_ROOMS,
  (auth) => ({
    ...(auth.claims.name ? { userName: auth.claims.name } : {}),
    ...(auth.claims.email ? { userEmail: auth.claims.email } : {}),
    ...(auth.claims.image ? { userImageUrl: auth.claims.image } : {}),
  }),
))

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

app.post('/api/actions/:name', async (c) => {
  const auth = await resolveAuth(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const name = c.req.param('name')
  const action = actions[name]
  if (!action) return c.json({ error: 'Action not found' }, 404)
  const params = await c.req.json<Record<string, unknown>>()
  const callerJwt = c.req.header('Authorization')!.slice(7)
  const tools = createActionTools(c.env, auth.userId, callerJwt)
  const result = await action({ userId: auth.userId, params, tools })
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

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514') as Parameters<typeof streamText>[0]['model'],
    system: buildSystemPrompt(c.env.APP_NAME, schemas),
    messages: messages as Parameters<typeof streamText>[0]['messages'],
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    maxSteps: 5,
    onError: ({ error }) => {
      console.error('[ai-chat] streamText error:', error)
    },
  })

  return result.toDataStreamResponse({
    getErrorMessage: (error) => {
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
  const userId = auth?.userId ?? null

  const url = new URL(c.req.url)
  const platformUrl = new URL(c.req.url)
  platformUrl.pathname = url.pathname.replace('/api/files', '/internal/files')

  const headers = new Headers(c.req.raw.headers)
  headers.set('x-app-identity-token', c.env.APP_IDENTITY_TOKEN ?? '')
  headers.set('x-app-name', c.env.APP_NAME)
  if (userId) headers.set('x-user-id', userId)

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

// ---------------------------------------------------------------------------
// Internal cron (HMAC-authenticated)
// ---------------------------------------------------------------------------

app.post('/internal/cron', async (c) => {
  const body = await c.req.text()
  const valid = await verifyInternalSignature({
    secret: c.env.INTERNAL_STORAGE_HMAC_SECRET,
    payload: buildInternalPayload(body),
    signature: c.req.header('x-internal-signature') ?? '',
    timestamp: c.req.header('x-internal-timestamp') ?? '',
  })
  if (!valid) return c.json({ error: 'Forbidden' }, 403)
  const payload = JSON.parse(body) as { taskName: string; ownerUserId: string }
  const roomId = `app:${c.env.APP_NAME}`
  const ctx = buildCronContext(c.env as any, payload.ownerUserId, roomId)
  await cronTaskHandler(payload.taskName, ctx)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Static assets (SPA fallback)
// ---------------------------------------------------------------------------

app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw)
  if (response.status === 404) {
    const url = new URL(c.req.url)
    url.pathname = '/index.html'
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
  }
  return response
})

// =============================================================================
// Action Tools — route to app's own RecordRoom DO
// =============================================================================

function createActionTools(env: Env, userId: string, callerJwt: string): BookMeActionTools {
  async function execTool(tool: string, params: Record<string, unknown>): Promise<ActionResult> {
    // Route to the correct DO instance based on scopeId (e.g. user:{id} vs app:{name}).
    const targetScope = (params.scopeId as string) || `app:${env.APP_NAME}`
    const doId = env.RECORD_ROOMS.idFromName(targetScope)
    const stub = env.RECORD_ROOMS.get(doId)
    // RecordRoom tool handler enables RBAC bypass only when appAction=true is on the URL and
    // userId is in the JSON body (see deepspace handleToolExecute). Without both, updates hit
    // "UPDATE DENIED" for bookings (ownerField=hostUserId) even when the server action already
    // authorized the caller (e.g. guest cancel/reschedule).
    const executeUrl = new URL('https://internal/api/tools/execute')
    executeUrl.searchParams.set('appAction', 'true')
    const res = await stub.fetch(
      new Request(executeUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, params, userId }),
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
    const jwt = billingMode === 'developer' ? env.APP_OWNER_JWT : callerJwt

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
    calendarApp: (path, body) => calendarWorkerFetch(env, path, body),
  }
}

export default app
