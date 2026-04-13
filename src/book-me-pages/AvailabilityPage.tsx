/**
 * Availability Page
 *
 * Set weekly availability for bookings.
 * Schedule tab: weekly hours, timezone, notice, limits, overrides.
 * Advance Settings: holidays (auto-block selected dates).
 */

import { useState, useMemo, useCallback, useRef } from 'react'

type AvailabilityTabType = 'schedule' | 'advance-settings'
import { useAvailability, useAvailabilityOverrides, showToast } from '../hooks'
import { Input, Select, ConfirmDialog } from '../components/ui'
import { PageHeader } from '../components/PageHeader'
import { DAYS_OF_WEEK, TIME_SLOTS, normalizeDaySettings } from '../constants'
import type { DayOfWeek } from '../constants'
import type { AvailabilityOverride } from '../constants'

/** Holiday definition: returns YYYY-MM-DD dates for a given year */
interface HolidayDef {
  id: string
  name: string
  getDates: (year: number) => string[]
}

/** Compute Easter Sunday for a given year (Anonymous Gregorian algorithm) */
function getEasterDate(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const mStr = String(month).padStart(2, '0')
  const dStr = String(day).padStart(2, '0')
  return `${year}-${mStr}-${dStr}`
}

const HOLIDAYS: HolidayDef[] = [
  { id: 'new-year', name: "New Year's Day", getDates: y => [`${y}-01-01`] },
  { id: 'mlk-day', name: 'Martin Luther King, Jr. Day', getDates: y => [getNthWeekdayOfMonth(y, 0, 1, 3)] },
  { id: 'presidents-day', name: "Presidents' Day", getDates: y => [getNthWeekdayOfMonth(y, 1, 1, 3)] },
  { id: 'easter', name: 'Easter Sunday', getDates: y => [getEasterDate(y)] },
  { id: 'memorial-day', name: 'Memorial Day', getDates: y => [getLastWeekdayOfMonth(y, 4, 1)] },
  { id: 'juneteenth', name: 'Juneteenth National Independence Day', getDates: y => [`${y}-06-19`] },
  { id: 'independence-day', name: 'Independence Day', getDates: y => [`${y}-07-04`] },
  { id: 'labor-day', name: 'Labor Day', getDates: y => [getNthWeekdayOfMonth(y, 8, 1, 1)] },
  { id: 'columbus-day', name: "Columbus Day", getDates: y => [getNthWeekdayOfMonth(y, 9, 1, 2)] }, // 2nd Mon Oct
  { id: 'veterans-day', name: 'Veterans Day', getDates: y => [`${y}-11-11`] },
  { id: 'thanksgiving', name: 'Thanksgiving', getDates: y => [getNthWeekdayOfMonth(y, 10, 4, 1)] },
  { id: 'black-friday', name: 'Day after Thanksgiving (Black Friday)', getDates: y => {
    const thx = getNthWeekdayOfMonth(y, 10, 4, 1)
    if (!thx) return []
    const d = new Date(thx + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    return [d.toISOString().slice(0, 10)]
  }},
  { id: 'christmas-eve', name: 'Christmas Eve', getDates: y => [`${y}-12-24`] },
  { id: 'christmas', name: 'Christmas Day', getDates: y => [`${y}-12-25`] },
  { id: 'new-years-eve', name: "New Year's Eve", getDates: y => [`${y}-12-31`] },
]

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d)
    if (date.getMonth() !== month) break
    if (date.getDay() === weekday) {
      count++
      if (count === n) {
        const m = String(month + 1).padStart(2, '0')
        const day = String(d).padStart(2, '0')
        return `${year}-${m}-${day}`
      }
    }
  }
  return ''
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  for (let d = 31; d >= 1; d--) {
    const date = new Date(year, month, d)
    if (date.getMonth() !== month) continue
    if (date.getDay() === weekday) {
      const m = String(month + 1).padStart(2, '0')
      const day = String(d).padStart(2, '0')
      return `${year}-${m}-${day}`
    }
  }
  return ''
}

const CUSTOM_HOLIDAYS_STORAGE_KEY = 'book-me-custom-holidays'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Recurring date (month/day) for birthdays, anniversaries, etc. */
interface CustomHoliday {
  id: string
  name: string
  month: number
  day: number
}

interface HolidaysBlockProps {
  overrides: AvailabilityOverride[]
  addOverride: (o: Omit<AvailabilityOverride, 'id' | 'userId'>) => void
  removeOverride: (id: string) => void
}

function getDaysInMonth(month: number): number {
  const d = new Date(2024, month - 1, 1)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Returns YYYY-MM-DD for this year and next 2 years (only valid dates, e.g. Feb 29 only in leap years) */
function getDatesForMonthDay(month: number, day: number): string[] {
  const today = new Date()
  const years = [today.getFullYear(), today.getFullYear() + 1, today.getFullYear() + 2]
  const out: string[] = []
  for (const y of years) {
    const d = new Date(y, month - 1, day)
    if (d.getMonth() === month - 1 && d.getDate() === day) {
      out.push(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
  }
  return out
}

function formatMonthDay(month: number, day: number): string {
  return `${MONTH_NAMES[month - 1]} ${day}`
}

function getNextOccurrenceForMonthDay(month: number, day: number): string {
  const today = new Date()
  const thisYear = today.getFullYear()
  for (let y = thisYear; y <= thisYear + 2; y++) {
    const d = new Date(y, month - 1, day)
    if (d.getMonth() === month - 1 && d.getDate() === day) {
      const date = new Date(y, month - 1, day, 12, 0, 0)
      if (date >= today) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return ''
}

function loadCustomHolidays(): CustomHoliday[] {
  try {
    const raw = localStorage.getItem(CUSTOM_HOLIDAYS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<{ id?: string; name?: string; date?: string; month?: number; day?: number }>
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(h => {
        if (h.id && h.name && h.month != null && h.day != null) return { id: h.id, name: h.name, month: h.month, day: h.day }
        if (h.id && h.name && h.date) {
          const [y, m, d] = h.date.split('-').map(Number)
          if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { id: h.id, name: h.name, month: m, day: d }
        }
        return null
      })
      .filter((x): x is CustomHoliday => x != null)
  } catch {
    return []
  }
}

function saveCustomHolidays(items: CustomHoliday[]) {
  localStorage.setItem(CUSTOM_HOLIDAYS_STORAGE_KEY, JSON.stringify(items))
}

function formatNextDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getNextOccurrence(holidayId: string): string {
  const h = HOLIDAYS.find(x => x.id === holidayId)
  if (!h) return ''
  const today = new Date()
  const thisYear = today.getFullYear()
  for (let y = thisYear; y <= thisYear + 2; y++) {
    const dates = h.getDates(y).filter(Boolean)
    for (const d of dates) {
      const date = new Date(d + 'T12:00:00')
      if (date >= today) return formatNextDate(d)
    }
  }
  return ''
}

function HolidaysBlock({ overrides, addOverride, removeOverride }: HolidaysBlockProps) {
  const [justToggledId, setJustToggledId] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>(loadCustomHolidays)
  const [isAddingCustom, setIsAddingCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customMonth, setCustomMonth] = useState<number>(1)
  const [customDay, setCustomDay] = useState<number>(1)

  const thisYear = new Date().getFullYear()
  const holidayDatesForYears = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const h of HOLIDAYS) {
      const dates = [...h.getDates(thisYear), ...h.getDates(thisYear + 1)].filter(Boolean)
      map.set(h.id, dates)
    }
    return map
  }, [thisYear])

  const isHolidayEnabled = useCallback((holidayId: string) => {
    const dates = holidayDatesForYears.get(holidayId) ?? []
    return dates.length > 0 && dates.every(d => overrides.some(o => o.type === 'blocked' && o.date === d))
  }, [overrides, holidayDatesForYears])

  const allEnabled = useMemo(() =>
    HOLIDAYS.every(h => {
      const dates = holidayDatesForYears.get(h.id) ?? []
      return dates.length > 0 && dates.every(d => overrides.some(o => o.type === 'blocked' && o.date === d))
    }),
  [overrides, holidayDatesForYears])

  const triggerFeedback = useCallback((id: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setJustToggledId(id)
    timeoutRef.current = setTimeout(() => {
      setJustToggledId(null)
      timeoutRef.current = null
    }, 500)
  }, [])

  const toggleHoliday = (holidayId: string, enable: boolean, showNotification = true) => {
    const h = HOLIDAYS.find(x => x.id === holidayId)
    const dates = holidayDatesForYears.get(holidayId) ?? []
    if (enable) {
      for (const date of dates) {
        if (!overrides.some(o => o.date === date)) {
          addOverride({ date, type: 'blocked' })
        }
      }
      if (showNotification) showToast(`${h?.name ?? 'Holiday'} marked as unavailable`, 'success', 3000, true)
    } else {
      for (const date of dates) {
        const ov = overrides.find(o => o.date === date && o.type === 'blocked')
        if (ov) removeOverride(ov.id)
      }
      if (showNotification) showToast(`${h?.name ?? 'Holiday'} removed from unavailable dates`, 'success', 3000, true)
    }
    triggerFeedback(holidayId)
  }

  const toggleAll = (enable: boolean) => {
    for (const h of HOLIDAYS) {
      toggleHoliday(h.id, enable, false)
    }
    triggerFeedback('__all__')
    showToast(
      enable ? 'All holidays marked as unavailable' : 'All holidays removed from unavailable dates',
      'success',
      3000,
      true,
    )
  }

  const isCustomHolidayEnabled = useCallback((custom: CustomHoliday) => {
    const dates = getDatesForMonthDay(custom.month, custom.day)
    return dates.length > 0 && dates.every(d => overrides.some(o => o.type === 'blocked' && o.date === d))
  }, [overrides])

  const toggleCustomHoliday = (custom: CustomHoliday, enable: boolean) => {
    const dates = getDatesForMonthDay(custom.month, custom.day)
    if (enable) {
      for (const date of dates) {
        if (!overrides.some(o => o.date === date)) addOverride({ date, type: 'blocked' })
      }
      showToast(`${custom.name} marked as unavailable`, 'success', 3000, true)
    } else {
      for (const date of dates) {
        const ov = overrides.find(o => o.date === date && o.type === 'blocked')
        if (ov) removeOverride(ov.id)
      }
      showToast(`${custom.name} removed from unavailable dates`, 'success', 3000, true)
    }
    triggerFeedback(`custom-${custom.id}`)
  }

  const handleAddCustomHoliday = () => {
    const name = customName.trim()
    if (!name) return
    const maxDay = getDaysInMonth(customMonth)
    if (customDay < 1 || customDay > maxDay) return
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newItem: CustomHoliday = { id, name, month: customMonth, day: customDay }
    const updated = [...customHolidays, newItem]
    setCustomHolidays(updated)
    saveCustomHolidays(updated)
    setCustomName('')
    setCustomMonth(1)
    setCustomDay(1)
    setIsAddingCustom(false)
    showToast(`"${name}" added to holidays`, 'success', 3000, true)
  }

  const handleRemoveCustomHoliday = (custom: CustomHoliday) => {
    for (const date of getDatesForMonthDay(custom.month, custom.day)) {
      const ov = overrides.find(o => o.date === date && o.type === 'blocked')
      if (ov) removeOverride(ov.id)
    }
    const updated = customHolidays.filter(c => c.id !== custom.id)
    setCustomHolidays(updated)
    saveCustomHolidays(updated)
    showToast(`"${custom.name}" removed`, 'success', 3000, true)
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-3 transition-all duration-300 md:flex-row md:items-start md:justify-between md:gap-4 md:p-4">
        <div className="min-w-0">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#111827] md:text-[12px]">Holidays</h2>
          <p className="mt-1 text-[11px] font-medium text-gray-500 md:text-[12px]">
            Automatically mark selected holidays as unavailable for bookings
          </p>
        </div>
        <button
          onClick={() => toggleAll(!allEnabled)}
          className={`relative mt-0 h-6 w-10 shrink-0 rounded-full transition-colors self-start md:mt-0.5 md:w-11 ${
            allEnabled ? 'bg-black' : 'bg-gray-200'
          }`}
          title="Toggle all holidays"
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full shadow-sm transition-transform ${
              allEnabled ? 'left-5 bg-white md:left-6' : 'left-1 bg-white'
            }`}
          />
        </button>
      </div>
      <div className="space-y-2 p-3 md:p-4">
        {HOLIDAYS.map(h => {
          const enabled = isHolidayEnabled(h.id)
          const nextDate = getNextOccurrence(h.id)
          const justToggled = justToggledId === h.id
          return (
            <div
              key={h.id}
              className={`flex items-center justify-between gap-2 rounded-lg p-2 transition-all duration-300 md:gap-3 md:p-3 ${
                justToggled ? 'ring-2 ring-black/20' : ''
              }`}
            >
              <div className="min-w-0 flex flex-col gap-0.5 pr-1">
                <span className="text-[11px] font-bold leading-snug text-[#111827] md:text-[12px]">{h.name}</span>
                {nextDate && (
                  <span className="text-[10px] font-medium text-gray-500 md:text-[12px]">Next: {nextDate}</span>
                )}
              </div>
              <button
                onClick={() => toggleHoliday(h.id, !enabled)}
                className={`relative h-6 w-10 shrink-0 rounded-full transition-colors md:w-11 ${
                  enabled ? 'bg-black' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    enabled ? 'left-5 md:left-6' : 'left-1'
                  }`}
                />
              </button>
            </div>
          )
        })}

        {/* Custom holidays section - at bottom of holiday list */}
        <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 md:text-[12px]">Recurring dates (birthdays, anniversaries, etc.)</p>
          {customHolidays.length > 0 && (
            <div className="space-y-2">
              {customHolidays.map(custom => {
                const enabled = isCustomHolidayEnabled(custom)
                const justToggled = justToggledId === `custom-${custom.id}`
                const nextDate = getNextOccurrenceForMonthDay(custom.month, custom.day)
                return (
                  <div
                    key={custom.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors md:gap-3 md:px-3 ${
                      justToggled ? 'ring-2 ring-black/20' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-bold text-[#111827] md:text-[12px]">{custom.name}</p>
                      <p className="text-[10px] font-medium text-gray-500 md:text-[12px]">
                        {formatMonthDay(custom.month, custom.day)}
                        {nextDate ? ` · Next: ${nextDate}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleCustomHoliday(custom, !enabled)}
                        aria-label={enabled ? `Disable ${custom.name}` : `Enable ${custom.name}`}
                        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors md:w-11 ${
                          enabled ? 'bg-black' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            enabled ? 'left-5 md:left-6' : 'left-1'
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => handleRemoveCustomHoliday(custom)}
                        aria-label={`Remove ${custom.name}`}
                        className="rounded p-1 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 md:p-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!isAddingCustom ? (
            <button
              onClick={() => setIsAddingCustom(true)}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border-2 border-dashed border-gray-200 text-gray-500 hover:border-black hover:text-[#111827] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium">Add recurring date</span>
            </button>
          ) : (
            <div className="p-3 rounded-lg space-y-3">
              <Input
                label="Name"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g., Birthday"
                className="w-full bg-gray-50 border-gray-200"
                onKeyDown={e => e.key === 'Enter' && handleAddCustomHoliday()}
              />
              <div className="flex gap-2">
                <Select
                  label="Month"
                  options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))}
                  value={String(customMonth)}
                  onChange={e => {
                    const m = Number(e.target.value)
                    setCustomMonth(m)
                    const maxDay = getDaysInMonth(m)
                    if (customDay > maxDay) setCustomDay(maxDay)
                  }}
                  className="flex-1 bg-gray-50 border-gray-200"
                />
                <Select
                  label="Day"
                  options={Array.from({ length: getDaysInMonth(customMonth) }, (_, i) => ({
                    value: String(i + 1),
                    label: String(i + 1),
                  }))}
                  value={String(customDay)}
                  onChange={e => setCustomDay(Number(e.target.value))}
                  className="flex-1 bg-gray-50 border-gray-200"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddCustomHoliday} disabled={!customName.trim()} className="px-3 py-1.5 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all disabled:opacity-50">
                  Add
                </button>
                <button onClick={() => { setIsAddingCustom(false); setCustomName(''); setCustomMonth(1); setCustomDay(1) }} className="px-3 py-1.5 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AvailabilityPage() {
  const {
    availability, schedules, activeScheduleId, setActiveScheduleId,
    updateDayAvailability, addDayBlock, removeDayBlock, updateDayBlock,
    setTimeGap, setMaxBookingsPerDay,
    setScheduleName, createSchedule, deleteSchedule, resetToDefault,
  } = useAvailability()
  const { overrides, addOverride, removeOverride } = useAvailabilityOverrides()

  const [activeTab, setActiveTab] = useState<AvailabilityTabType>('schedule')
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideType, setOverrideType] = useState<'blocked' | 'custom'>('blocked')
  const [overrideStart, setOverrideStart] = useState('09:00')
  const [overrideEnd, setOverrideEnd] = useState('17:00')
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false)
  const [newScheduleName, setNewScheduleName] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null)

  const handleAddOverride = () => {
    if (!overrideDate) return
    addOverride({
      date: overrideDate,
      type: overrideType,
      startTime: overrideType === 'custom' ? overrideStart : undefined,
      endTime: overrideType === 'custom' ? overrideEnd : undefined,
    })
    setOverrideDate('')
  }

  const handleCreateSchedule = () => {
    if (!newScheduleName.trim()) return
    createSchedule(newScheduleName.trim())
    setNewScheduleName('')
    setIsCreatingSchedule(false)
  }

  const handleConfirmDelete = () => {
    if (deleteScheduleId) {
      deleteSchedule(deleteScheduleId)
      setDeleteScheduleId(null)
    }
  }

  const handleSaveName = () => {
    if (editNameValue.trim()) {
      setScheduleName(editNameValue.trim())
    }
    setIsEditingName(false)
  }

  const formatDayName = (day: string) => {
    return day.charAt(0).toUpperCase() + day.slice(1)
  }

  return (
    <div data-testid="availability-page" className="flex min-h-0 flex-1 flex-col bg-[#F3F4F6]">
      <div className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4">
        <div className="mx-auto mb-4 max-w-[1600px] space-y-4 px-1 md:mb-6 md:space-y-6 md:px-2">
      <PageHeader
        title={<h1 className="text-2xl font-bold tracking-tight text-[#111827] md:text-3xl">Availability</h1>}
        subtitle={<p className="text-xs font-medium text-gray-500 md:text-sm">Set your weekly hours when you're available for meetings</p>}
        actions={activeTab === 'schedule' ? (
          <div className="flex w-full flex-col gap-2 max-md:items-stretch md:w-auto md:flex-row md:items-center">
            <button onClick={resetToDefault} className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-bold transition-all hover:bg-gray-50 max-md:w-full md:py-1.5 md:text-[12px]">
              Reset to Default
            </button>
            <button
              onClick={() => setIsCreatingSchedule(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-bold transition-all hover:bg-gray-50 max-md:w-full md:py-1.5 md:text-[12px]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Schedule
            </button>
          </div>
        ) : undefined}
      />

      {/* Tabs — dashboard style */}
      <div className="flex gap-4 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] md:gap-6 md:pb-4 [&::-webkit-scrollbar]:hidden">
        {(['schedule', 'advance-settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`-mb-px shrink-0 border-b-2 pb-1 text-sm font-bold transition-all md:text-[15px] ${
              activeTab === tab
                ? 'border-black text-[#111827]'
                : 'border-transparent text-gray-500 hover:text-[#111827]'
            }`}
          >
            {tab === 'schedule' ? 'Schedule' : 'Advance Settings'}
          </button>
        ))}
      </div>

      {/* Schedule Tab Content */}
      {activeTab === 'schedule' && (
        <>
      {/* New Schedule Form */}
      {isCreatingSchedule && (
        <div className="app-card p-3 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <Input
              label="Schedule Name"
              value={newScheduleName}
              onChange={e => setNewScheduleName(e.target.value)}
              placeholder="e.g., Sales Calls, Mentoring"
              className="min-w-0 flex-1 bg-gray-50 border-gray-200"
              onKeyDown={e => e.key === 'Enter' && handleCreateSchedule()}
            />
            <div className="flex gap-2">
              <button onClick={handleCreateSchedule} disabled={!newScheduleName.trim()} className="flex-1 rounded-lg bg-black px-3 py-2 text-[11px] font-bold text-white transition-all hover:bg-gray-800 disabled:opacity-50 md:flex-none md:py-1.5 md:text-[12px]">
                Create
              </button>
              <button onClick={() => { setIsCreatingSchedule(false); setNewScheduleName('') }} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-bold transition-all hover:bg-gray-50 md:flex-none md:py-1.5 md:text-[12px]">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Tabs */}
      {schedules.length > 1 && (
        <div className="flex flex-wrap gap-1.5 md:gap-2">
          {schedules.map(schedule => (
            <button
              key={schedule.id}
              onClick={() => setActiveScheduleId(schedule.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-colors md:px-4 md:py-2 md:text-[12px] ${
                activeScheduleId === schedule.id
                  ? 'bg-black border-black text-white'
                  : 'bg-white border-gray-200 text-[#111827] hover:bg-gray-50'
              }`}
            >
              {schedule.name}
            </button>
          ))}
        </div>
      )}

      {/* Active Schedule Name + Actions */}
      {schedules.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {isEditingName ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={editNameValue}
                onChange={e => setEditNameValue(e.target.value)}
                className="min-w-0 max-w-full bg-gray-50 border-gray-200 sm:max-w-xs"
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setIsEditingName(false) }}
                autoFocus
              />
              <div className="flex shrink-0 gap-2">
                <button onClick={handleSaveName} className="rounded-lg bg-black px-3 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-gray-800 md:text-[12px]">Save</button>
                <button onClick={() => setIsEditingName(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold transition-all hover:bg-gray-50 md:text-[12px]">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="min-w-0 truncate text-base font-semibold text-[#111827] md:text-lg">{availability.name}</h2>
              <button
                onClick={() => { setIsEditingName(true); setEditNameValue(availability.name) }}
                className="p-1 text-gray-500 hover:text-[#111827] transition-colors"
                title="Rename schedule"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {schedules.length > 1 && (
                <button
                  onClick={() => setDeleteScheduleId(activeScheduleId ?? '')}
                  className="p-1 text-gray-500 hover:text-red-600 transition-colors"
                  title="Delete schedule"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}
      
      {/* Main two-column layout: Weekly Schedule (left) + Summary (right) */}
      <div className="grid grid-cols-1 items-stretch gap-4 md:gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column: Weekly Schedule */}
        <div className="app-card overflow-hidden">
          <div className="border-b border-gray-100 p-3 md:p-4">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#111827] md:text-[12px]">Weekly Hours</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {DAYS_OF_WEEK.map(day => {
              const daySettings = normalizeDaySettings(availability[day])
              return (
                <div key={day} className="p-3 md:p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
                    <div className="flex shrink-0 items-center gap-2 md:gap-3">
                      <button
                        onClick={() => updateDayAvailability(day as DayOfWeek, { isAvailable: !daySettings.isAvailable })}
                        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors md:w-11 ${
                          daySettings.isAvailable ? 'bg-black' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            daySettings.isAvailable ? 'left-5 md:left-6' : 'left-1'
                          }`}
                        />
                      </button>
                      <span className={`w-[4.5rem] font-medium text-[11px] sm:w-24 md:w-28 md:text-[12px] ${daySettings.isAvailable ? 'text-[#111827]' : 'text-gray-500'}`}>
                        {formatDayName(day)}
                      </span>
                    </div>
                    {daySettings.isAvailable ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pl-0 sm:gap-3 md:pl-0">
                        {daySettings.blocks.map((block, blockIdx) => (
                          <div key={blockIdx} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <Select
                              value={block.startTime}
                              onChange={e => updateDayBlock(day as DayOfWeek, blockIdx, { startTime: e.target.value })}
                              options={TIME_SLOTS.map(t => ({ value: t, label: t }))}
                              className="w-[5.25rem] bg-gray-50 border-gray-200 sm:w-24 md:w-28"
                            />
                            <span className="text-[11px] text-gray-500 md:text-[12px]">to</span>
                            <Select
                              value={block.endTime}
                              onChange={e => updateDayBlock(day as DayOfWeek, blockIdx, { endTime: e.target.value })}
                              options={TIME_SLOTS.map(t => ({ value: t, label: t }))}
                              className="w-[5.25rem] bg-gray-50 border-gray-200 sm:w-24 md:w-28"
                            />
                            {daySettings.blocks.length > 1 && (
                              <button
                                onClick={() => removeDayBlock(day as DayOfWeek, blockIdx)}
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Remove time block"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          onClick={() => addDayBlock(day as DayOfWeek)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-500 transition-colors hover:border-black hover:text-[#111827]"
                          title="Add time block"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-500 md:text-[12px]">Unavailable</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right column: Sidebar cards — flex so Summary aligns with Weekly Hours bottom */}
        <div className="flex min-h-0 flex-col gap-3 md:gap-4">
          {/* Timezone */}
          <div className="app-card shrink-0 p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 md:h-10 md:w-10">
                <svg className="h-4 w-4 text-[#111827] md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[#111827] md:text-[12px]">Your Timezone</p>
                <p className="break-words text-[10px] font-medium text-gray-500 md:text-[12px]">{availability.timezone}</p>
              </div>
            </div>
          </div>

          {/* Minimum Notice */}
          <div className="app-card shrink-0 space-y-2 p-3 md:space-y-3 md:p-4">
            <div>
              <h3 className="text-[11px] font-bold text-[#111827] md:text-[12px]">Minimum Notice</h3>
              <p className="text-[10px] font-medium text-gray-500 md:text-[12px]">Prevent same-day bookings without enough lead time</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={availability.timeGap}
                onChange={e => setTimeGap(parseInt(e.target.value) || 0)}
                className="w-20 text-center bg-gray-50 border-gray-200"
                min={0}
                step={15}
              />
              <span className="text-gray-500 text-[12px]">minutes</span>
            </div>
          </div>

          {/* Max Bookings Per Day */}
          <div className="app-card shrink-0 space-y-2 p-3 md:space-y-3 md:p-4">
            <div>
              <h3 className="text-[11px] font-bold text-[#111827] md:text-[12px]">Max Bookings Per Day</h3>
              <p className="text-[10px] font-medium text-gray-500 md:text-[12px]">Limit meetings per day (0 = unlimited)</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={availability.maxBookingsPerDay}
                onChange={e => setMaxBookingsPerDay(parseInt(e.target.value) || 0)}
                className="w-20 text-center bg-gray-50 border-gray-200"
                min={0}
                step={1}
              />
              <span className="text-gray-500 text-[12px]">per day</span>
            </div>
          </div>

          {/* Availability Summary — flex grows to match Weekly Hours bottom */}
          <div className="app-card flex min-h-0 flex-1 flex-col p-3 md:p-4">
            <h3 className="mb-2 shrink-0 text-[11px] font-bold text-[#111827] md:mb-3 md:text-[12px]">Summary</h3>
            <div className="grid grid-cols-7 gap-0.5 md:gap-1">
              {DAYS_OF_WEEK.map(day => {
                const daySettings = normalizeDaySettings(availability[day])
                return (
                  <div
                    key={day}
                    className={`rounded-md px-0.5 py-1.5 text-center md:rounded-lg md:py-2 ${
                      daySettings.isAvailable
                        ? 'bg-indigo-50 text-[#111827]'
                        : 'bg-gray-50 text-gray-500'
                    }`}
                  >
                    <div className="text-[9px] font-semibold uppercase leading-none md:text-[12px]">{day.slice(0, 2)}</div>
                    {daySettings.isAvailable && (
                      <div className="mt-0.5 break-words text-[8px] leading-tight text-gray-500 md:text-[12px]">
                        {daySettings.blocks.map(b => `${b.startTime.replace(':00', '')}–${b.endTime.replace(':00', '')}`).join(', ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Date Overrides — full width below */}
      <div className="app-card overflow-hidden">
        <div className="border-b border-gray-100 p-3 md:p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#111827] md:text-[12px]">Date Overrides</h2>
          <p className="mt-1 text-[10px] font-medium text-gray-500 md:text-[12px]">Block specific dates or set custom hours</p>
        </div>

        <div className="space-y-3 p-3 md:space-y-4 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <Input
              label="Date"
              type="date"
              value={overrideDate}
              onChange={e => setOverrideDate(e.target.value)}
              className="w-full bg-gray-50 border-gray-200 md:w-44"
            />
            <Select
              label="Type"
              value={overrideType}
              onChange={e => setOverrideType(e.target.value as 'blocked' | 'custom')}
              options={[
                { value: 'blocked', label: 'Block entire day' },
                { value: 'custom', label: 'Custom hours' },
              ]}
              className="w-full bg-gray-50 border-gray-200 md:w-44"
            />
            {overrideType === 'custom' && (
              <>
                <Select
                  label="From"
                  value={overrideStart}
                  onChange={e => setOverrideStart(e.target.value)}
                  options={TIME_SLOTS.map(t => ({ value: t, label: t }))}
                  className="w-full bg-gray-50 border-gray-200 md:w-28"
                />
                <Select
                  label="To"
                  value={overrideEnd}
                  onChange={e => setOverrideEnd(e.target.value)}
                  options={TIME_SLOTS.map(t => ({ value: t, label: t }))}
                  className="w-full bg-gray-50 border-gray-200 md:w-28"
                />
              </>
            )}
            <button onClick={handleAddOverride} disabled={!overrideDate} className="w-full rounded-lg bg-black px-3 py-2 text-[11px] font-bold text-white transition-all hover:bg-gray-800 disabled:opacity-50 md:w-auto md:py-1.5 md:text-[12px]">
              Add
            </button>
          </div>

          {overrides.length > 0 && (
            <div className="space-y-2">
              {overrides.map(override => (
                <div
                  key={override.id}
                  className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 md:flex-row md:items-center md:justify-between md:p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <span className={`w-fit px-2 py-0.5 text-[10px] font-bold rounded-full md:text-[12px] ${
                      override.type === 'blocked'
                        ? 'bg-red-50 text-red-600 border border-red-200'
                        : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                    }`}>
                      {override.type === 'blocked' ? 'Blocked' : 'Custom'}
                    </span>
                    <span className="text-xs text-foreground md:text-sm">
                      {new Date(override.date + 'T12:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {override.type === 'custom' && override.startTime && override.endTime && (
                      <span className="text-[10px] text-gray-500 md:text-[12px]">
                        {override.startTime} – {override.endTime}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeOverride(override.id)}
                    className="self-end rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 md:self-auto"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Advance Settings Tab Content — Holidays */}
      {activeTab === 'advance-settings' && (
        <HolidaysBlock overrides={overrides} addOverride={addOverride} removeOverride={removeOverride} />
      )}

        </div>
      </div>

      {/* Delete Schedule Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteScheduleId}
        onClose={() => setDeleteScheduleId(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${schedules.find(s => s.id === deleteScheduleId)?.name ?? 'this schedule'}"? Event types using this schedule will fall back to your default schedule.`}
        confirmLabel="Delete"
        variant="danger"
        modalVariant="light"
      />
    </div>
  )
}

