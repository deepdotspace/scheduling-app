import type { CollectionSchema } from 'deepspace/worker'
import { USERS_COLUMNS } from 'deepspace/worker'

const extraColumns: CollectionSchema['columns'] = [
  { name: 'username', storage: 'text', interpretation: 'plain' },
  { name: 'bio', storage: 'text', interpretation: 'plain' },
  { name: 'calendarConnected', storage: 'text', interpretation: { kind: 'boolean' } },
  { name: 'emailConnected', storage: 'text', interpretation: { kind: 'boolean' } },
  { name: 'branding', storage: 'text', interpretation: { kind: 'json' } },
]

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
