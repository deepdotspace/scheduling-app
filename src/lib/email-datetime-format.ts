/**
 * Timezone-aware email / DM formatting for BookMe.
 *
 * Kept separate from `constants.ts` so the Cloudflare worker bundle does not
 * load `__APP_ID__` (Vite injects it for the client only; worker esbuild does not).
 */

/** Formats a UTC instant for display in an IANA timezone (e.g. booker's selected zone). */
export function formatInstantInTimezone(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc)
  if (isNaN(d.getTime())) return isoUtc
  try {
    return d.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
}

/** Long date string for a UTC instant in an IANA timezone (transactional emails). */
export function formatDateInTimezone(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc)
  if (isNaN(d.getTime())) return isoUtc
  try {
    return d.toLocaleDateString('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

/** Start–end time range for a UTC interval in an IANA timezone. */
export function formatTimeRangeInTimezone(startIso: string, endIso: string, timeZone: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  try {
    const s = start.toLocaleTimeString('en-US', opts)
    const e = end.toLocaleTimeString('en-US', opts)
    return `${s} – ${e}`
  } catch {
    return `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  }
}

/** Short zone label (e.g. PDT, EST) for the instant in `timeZone`. */
export function formatTimeZoneShortName(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc)
  if (isNaN(d.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(d)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/**
 * Date + time range for emails, with optional short timezone suffix.
 * Uses `startIso` for the calendar date (same as previous BookMe behavior for same-day meetings).
 */
export function formatEmailDateAndTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string,
): { dateLine: string; timeLine: string } {
  const dateLine = formatDateInTimezone(startIso, timeZone)
  if (startIso === endIso) {
    const single = formatInstantInTimezone(startIso, timeZone)
    const z = formatTimeZoneShortName(startIso, timeZone)
    const timeLine = z ? `${single} (${z})` : single
    return { dateLine, timeLine }
  }
  const range = formatTimeRangeInTimezone(startIso, endIso, timeZone)
  const z = formatTimeZoneShortName(startIso, timeZone)
  let timeLine: string
  if (range) {
    timeLine = z ? `${range} (${z})` : range
  } else {
    const single = formatInstantInTimezone(startIso, timeZone)
    timeLine = z ? `${single} (${z})` : single
  }
  return { dateLine, timeLine }
}

/** Cancellation email: date + time range, or single start time when `endIso` is absent. */
export function formatEmailDateAndOptionalEndRange(
  startIso: string,
  endIso: string | undefined,
  timeZone: string,
): { dateLine: string; timeLine: string } {
  if (endIso && endIso !== startIso) {
    return formatEmailDateAndTimeRange(startIso, endIso, timeZone)
  }
  const dateLine = formatDateInTimezone(startIso, timeZone)
  const single = formatInstantInTimezone(startIso, timeZone)
  const z = formatTimeZoneShortName(startIso, timeZone)
  const timeLine = z ? `${single} (${z})` : single
  return { dateLine, timeLine }
}

/**
 * DeepSpace Mail DM (shared thread): guest vs host local times with zone labels.
 * When both use the same IANA zone, one compact block.
 */
export function formatDualPartyTimeRangeForDm(
  startIso: string,
  endIso: string,
  guestTz: string,
  hostTz: string,
): string {
  const g = guestTz.trim() || hostTz.trim() || 'UTC'
  const h = hostTz.trim() || 'UTC'
  const guestSlot = formatEmailDateAndTimeRange(startIso, endIso, g)
  const hostSlot = formatEmailDateAndTimeRange(startIso, endIso, h)

  if (g === h) {
    return [`Date: ${guestSlot.dateLine}`, `Time: ${guestSlot.timeLine}`].join('\n')
  }

  return [
    'Guest:',
    `  ${guestSlot.dateLine}`,
    `  ${guestSlot.timeLine}`,
    '',
    'Host:',
    `  ${hostSlot.dateLine}`,
    `  ${hostSlot.timeLine}`,
  ].join('\n')
}

/** Same as {@link formatDualPartyTimeRangeForDm} when end may be omitted (cancel DMs). */
export function formatDualPartyOptionalEndForDm(
  startIso: string,
  endIso: string | undefined,
  guestTz: string,
  hostTz: string,
): string {
  const g = guestTz.trim() || hostTz.trim() || 'UTC'
  const h = hostTz.trim() || 'UTC'
  const guestSlot = formatEmailDateAndOptionalEndRange(startIso, endIso, g)
  const hostSlot = formatEmailDateAndOptionalEndRange(startIso, endIso, h)

  if (g === h) {
    return [`Date: ${guestSlot.dateLine}`, `Time: ${guestSlot.timeLine}`].join('\n')
  }

  return [
    'Guest:',
    `  ${guestSlot.dateLine}`,
    `  ${guestSlot.timeLine}`,
    '',
    'Host:',
    `  ${hostSlot.dateLine}`,
    `  ${hostSlot.timeLine}`,
  ].join('\n')
}
