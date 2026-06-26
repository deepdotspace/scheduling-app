/**
 * Scoped action types — BookMe's superset of the SDK's ActionTools.
 *
 * deepspace 0.4.3's built-in `ActionTools` is single-scope: every record
 * method operates on the app's own RecordRoom. BookMe needs more — server
 * actions reach the app scope, per-user `user:{id}` scopes (for calendar
 * `events`), the `dir:mail` directory, and `conv:{id}` rooms. So every
 * record method here takes a leading `scopeId`. The implementation lives in
 * `createActionTools` (worker.ts), which routes each call to the matching
 * RecordRoom DO instance.
 */
import type { ActionResult } from 'deepspace/worker'

export type { ActionResult }

export interface QueryOptions {
  where?: Record<string, unknown>
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  limit?: number
}

export interface ActionTools {
  create(scopeId: string, collection: string, data: Record<string, unknown>): Promise<ActionResult>
  update(
    scopeId: string,
    collection: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<ActionResult>
  remove(scopeId: string, collection: string, recordId: string): Promise<ActionResult>
  get(scopeId: string, collection: string, recordId: string): Promise<ActionResult>
  query(scopeId: string, collection: string, options?: QueryOptions): Promise<ActionResult>
  integration(endpoint: string, data?: unknown): Promise<ActionResult>
}

export interface ActionContext {
  userId: string
  params: Record<string, unknown>
  tools: ActionTools
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>
