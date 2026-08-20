import type { CollectionSchema } from 'deepspace/worker'
import { USERS_COLUMNS } from 'deepspace/worker'

const extraColumns: CollectionSchema['columns'] = [
  { name: 'username', storage: 'text', interpretation: 'plain' },
  { name: 'bio', storage: 'text', interpretation: 'plain' },
  { name: 'calendarConnected', storage: 'text', interpretation: { kind: 'boolean' } },
  { name: 'emailConnected', storage: 'text', interpretation: { kind: 'boolean' } },
  { name: 'branding', storage: 'text', interpretation: { kind: 'json' } },
]

/**
 * `read: true` for viewer and member is deliberate and was re-reviewed against the
 * 0.23.2 `users-schema-member-visibility` advisory: the PUBLIC booking page resolves
 * a host by username out of this collection (useProfile().getProfileByUsername, read
 * by anonymous visitors), so narrowing either role to 'own' blanks the booking page.
 * Email is kept OUT of these rows instead — worker.ts never forwards the verified
 * email to the room, and host email lives in the private `host-contacts` collection.
 */
export const usersSchema: CollectionSchema = {
  name: 'users',
  columns: [...USERS_COLUMNS, ...extraColumns],
  permissions: {
    viewer: {
      read: true,
      create: false,
      update: 'own',
      delete: false,
      writableFields: ['username', 'bio', 'calendarConnected', 'emailConnected', 'branding'],
    },
    member: {
      read: true,
      create: false,
      update: 'own',
      delete: false,
      writableFields: ['username', 'bio', 'calendarConnected', 'emailConnected', 'branding'],
    },
    admin: { read: true, create: false, update: true, delete: true },
  },
}
