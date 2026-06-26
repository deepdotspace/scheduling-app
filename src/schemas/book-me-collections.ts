import type { CollectionSchema } from 'deepspace/worker'

const json = { kind: 'json' as const }

export const eventTypesSchema: CollectionSchema = {
  name: 'event-types',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'description', storage: 'text', interpretation: 'plain' },
    { name: 'duration', storage: 'number', interpretation: 'plain' },
    { name: 'location', storage: 'text', interpretation: 'plain' },
    { name: 'isActive', storage: 'text', interpretation: { kind: 'boolean' } },
    { name: 'color', storage: 'text', interpretation: 'plain' },
    { name: 'sendGcalInvite', storage: 'text', interpretation: { kind: 'boolean' } },
    { name: 'sendDeepSpaceMail', storage: 'text', interpretation: { kind: 'boolean' } },
    { name: 'sendExternalEmail', storage: 'text', interpretation: { kind: 'boolean' } },
    { name: 'bufferBefore', storage: 'number', interpretation: 'plain' },
    { name: 'bufferAfter', storage: 'number', interpretation: 'plain' },
    { name: 'durations', storage: 'text', interpretation: json },
    { name: 'availabilityScheduleId', storage: 'text', interpretation: 'plain' },
    { name: 'bookingQuestions', storage: 'text', interpretation: json },
    { name: 'maxAttendees', storage: 'number', interpretation: 'plain' },
    { name: 'isRoundRobin', storage: 'text', interpretation: { kind: 'boolean' } },
    { name: 'teamMemberIds', storage: 'text', interpretation: json },
  ],
  permissions: {
    viewer: { read: true, create: true, update: 'own', delete: 'own' },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const availabilitySchema: CollectionSchema = {
  name: 'availability',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'monday', storage: 'text', interpretation: json },
    { name: 'tuesday', storage: 'text', interpretation: json },
    { name: 'wednesday', storage: 'text', interpretation: json },
    { name: 'thursday', storage: 'text', interpretation: json },
    { name: 'friday', storage: 'text', interpretation: json },
    { name: 'saturday', storage: 'text', interpretation: json },
    { name: 'sunday', storage: 'text', interpretation: json },
    { name: 'timeGap', storage: 'number', interpretation: 'plain' },
    { name: 'maxBookingsPerDay', storage: 'number', interpretation: 'plain' },
    { name: 'timezone', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: true, update: 'own', delete: 'own' },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const bookingsSchema: CollectionSchema = {
  name: 'bookings',
  ownerField: 'hostUserId',
  columns: [
    { name: 'eventTypeId', storage: 'text', interpretation: 'plain' },
    { name: 'eventTitle', storage: 'text', interpretation: 'plain' },
    { name: 'hostUserId', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'hostName', storage: 'text', interpretation: 'plain' },
    { name: 'hostEmail', storage: 'text', interpretation: 'plain' },
    { name: 'guestName', storage: 'text', interpretation: 'plain' },
    { name: 'guestEmail', storage: 'text', interpretation: 'plain' },
    { name: 'guestUserId', storage: 'text', interpretation: 'plain' },
    { name: 'startTime', storage: 'text', interpretation: 'plain' },
    { name: 'endTime', storage: 'text', interpretation: 'plain' },
    { name: 'meetingLink', storage: 'text', interpretation: 'plain' },
    { name: 'additionalInfo', storage: 'text', interpretation: 'plain' },
    { name: 'answers', storage: 'text', interpretation: json },
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'cancelToken', storage: 'text', interpretation: 'plain' },
    { name: 'calendarEventId', storage: 'text', interpretation: 'plain' },
    { name: 'remindersSent', storage: 'text', interpretation: json },
    { name: 'seriesId', storage: 'text', interpretation: 'plain' },
    { name: 'recurrence', storage: 'text', interpretation: 'plain' },
    { name: 'rescheduleEmail', storage: 'text', interpretation: 'plain' },
    { name: 'reasonForChange', storage: 'text', interpretation: 'plain' },
    { name: 'guestTimezone', storage: 'text', interpretation: 'plain' },
    { name: 'hostTimezone', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: true, update: 'own', delete: false },
    member: { read: true, create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * Private per-user contact info (host email) for sending booking notifications.
 *
 * Unlike `users` (world-readable so the public booking page can show host name/avatar), this is
 * owner-only: guests/anonymous visitors cannot read it, so host emails stay out of the bulk
 * `users` listing. Server actions (schedule-event) read it via the x-app-action RBAC bypass and
 * MUST query by `userId` (never trust a caller-chosen recordId). `userId` is userBound, so the DO
 * stamps it to the connecting user — a client cannot write a contact for someone else's id.
 */
export const hostContactsSchema: CollectionSchema = {
  name: 'host-contacts',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'email', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: 'own', create: true, update: 'own', delete: false },
    member: { read: 'own', create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * Per-user calendar rows (DeepSpace calendar) stored in user:{id} RecordRoom scope.
 * Field names match schedule-event / get-busy-times / reschedule-booking.
 */
export const eventsSchema: CollectionSchema = {
  name: 'events',
  columns: [
    { name: 'Title', storage: 'text', interpretation: 'plain' },
    { name: 'Description', storage: 'text', interpretation: 'plain' },
    { name: 'StartTime', storage: 'text', interpretation: 'plain' },
    { name: 'EndTime', storage: 'text', interpretation: 'plain' },
    { name: 'AllDay', storage: 'number', interpretation: 'plain' },
    { name: 'Visibility', storage: 'text', interpretation: 'plain' },
    { name: 'SourceRef', storage: 'text', interpretation: 'plain' },
    { name: 'Metadata', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: true, update: true, delete: true },
    member: { read: true, create: true, update: true, delete: true },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const availabilityOverridesSchema: CollectionSchema = {
  name: 'availability-overrides',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'date', storage: 'text', interpretation: 'plain' },
    { name: 'type', storage: 'text', interpretation: 'plain' },
    { name: 'startTime', storage: 'text', interpretation: 'plain' },
    { name: 'endTime', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: true, update: 'own', delete: 'own' },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
