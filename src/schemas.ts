/**
 * Collection schemas — single source of truth for worker + client.
 */

import type { CollectionSchema } from 'deepspace/worker'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import {
  eventTypesSchema,
  availabilitySchema,
  bookingsSchema,
  availabilityOverridesSchema,
  eventsSchema,
} from './schemas/book-me-collections'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  eventTypesSchema,
  availabilitySchema,
  availabilityOverridesSchema,
  bookingsSchema,
  eventsSchema,
]

/**
 * Schemas for {@link RecordScope} in the browser. The `events` collection is
 * only used from server actions against `user:{id}` RecordRooms — it is not
 * queried via client hooks on the app scope, and registering it here can break
 * DeepSpace’s scope registry / subscriptions.
 */
export const recordScopeSchemas: CollectionSchema[] = schemas.filter((s) => s.name !== 'events')
