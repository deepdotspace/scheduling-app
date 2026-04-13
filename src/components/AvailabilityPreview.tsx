/**
 * AvailabilityPreview — Compact 7-column weekly schedule grid.
 *
 * Shows day abbreviations (MON–SUN) with time ranges.
 * Available days highlighted, unavailable days grayed.
 * Links to /availability for full editing.
 */

import { Link } from 'react-router-dom'
import type { AvailabilitySettings } from '../constants'
import { DAYS_OF_WEEK, normalizeDaySettings } from '../constants'

const DAY_LABELS: Record<string, string> = {
  monday: 'MON',
  tuesday: 'TUE',
  wednesday: 'WED',
  thursday: 'THU',
  friday: 'FRI',
  saturday: 'SAT',
  sunday: 'SUN',
}

function formatTimeShort(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'p' : 'a'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${m.toString().padStart(2, '0')}${suffix}`
}

interface AvailabilityPreviewProps {
  availability: AvailabilitySettings
  /** Name of the schedule being previewed (for display purposes) */
  scheduleName?: string
  /** When true, hide the Customize link (read-only preview) */
  readOnly?: boolean
}

export function AvailabilityPreview({ availability, scheduleName, readOnly }: AvailabilityPreviewProps) {
  return (
    <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-card)] p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-app-text)]">Availability Preview</h4>
          {scheduleName && (
            <p className="text-xs text-[var(--color-app-text-muted)] mt-0.5">{scheduleName}</p>
          )}
        </div>
        {!readOnly && (
          <Link
            to="/availability"
            className="text-xs text-[var(--color-app-text)] font-medium hover:underline transition-colors"
          >
            Customize &rarr;
          </Link>
        )}
      </div>

      {/* Responsive day grid: list on mobile, 7-column on desktop */}
      <div className="hidden sm:grid grid-cols-7 gap-1.5">
        {DAYS_OF_WEEK.map((day) => {
          const settings = normalizeDaySettings(availability[day])
          const active = settings.isAvailable
          return (
            <div
              key={day}
              className={`rounded-lg px-1 py-2 text-center transition-colors border ${
                active
                  ? 'bg-[var(--color-muted)] border-[var(--color-app-border)]'
                  : 'bg-[var(--color-muted)] border-[var(--color-app-border)] opacity-50'
              }`}
            >
              <div
                className={`text-[12px] font-semibold tracking-wide ${
                  active ? 'text-[var(--color-app-text)]' : 'text-[var(--color-app-text-muted)]'
                }`}
              >
                {DAY_LABELS[day]}
              </div>
              {active ? (
                <div className="text-[12px] text-[var(--color-app-text-muted)] mt-0.5 leading-tight">
                  {settings.blocks.map(b => `${formatTimeShort(b.startTime)}–${formatTimeShort(b.endTime)}`).join(', ')}
                </div>
              ) : (
                <div className="text-[12px] text-[var(--color-app-text-muted)] mt-0.5">Off</div>
              )}
            </div>
          )
        })}
      </div>
      {/* Mobile: compact list */}
      <div className="sm:hidden space-y-1">
        {DAYS_OF_WEEK.map((day) => {
          const settings = normalizeDaySettings(availability[day])
          const active = settings.isAvailable
          return (
            <div
              key={day}
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 border ${
                active
                  ? 'bg-[var(--color-muted)] border-[var(--color-app-border)]'
                  : 'bg-[var(--color-muted)] border-[var(--color-app-border)] opacity-50'
              }`}
            >
              <span className={`text-xs font-semibold ${active ? 'text-[var(--color-app-text)]' : 'text-[var(--color-app-text-muted)]'}`}>
                {DAY_LABELS[day]}
              </span>
              <span className={`text-xs ${active ? 'text-[var(--color-app-text-muted)]' : 'text-[var(--color-app-text-muted)]'}`}>
                {active ? settings.blocks.map(b => `${formatTimeShort(b.startTime)}–${formatTimeShort(b.endTime)}`).join(', ') : 'Off'}
              </span>
            </div>
          )
        })}
      </div>

      {!readOnly && (
        <p className="text-[12px] text-[var(--color-app-text-muted)]">
          {scheduleName ? `Using schedule: ${scheduleName}` : 'This schedule applies to your event types.'}
        </p>
      )}
    </div>
  )
}
