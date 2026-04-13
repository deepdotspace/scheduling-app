/**
 * Event Date Range Picker
 *
 * Dropdown with preset options (Last 7/30/60/90/365 days), custom date inputs,
 * and dual calendar for range selection.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/Popover'
import { Calendar } from './ui/Calendar'
import { formatDate, parseDateString, isSameDay, getMonthName } from './ui/date-utils'
import { cn } from './ui/utils'

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 60 days', days: 60 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 365 days', days: 365 },
] as const

const MS_PER_DAY = 24 * 60 * 60 * 1000

function getRangeForPreset(days: number): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - days * MS_PER_DAY)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

export interface EventDateRangePickerProps {
  value: { start: Date; end: Date }
  onChange: (range: { start: Date; end: Date }) => void
  /** When set, disables dates after this (e.g. today for analytics). */
  maxDate?: Date
  className?: string
}

export function EventDateRangePicker({ value, onChange, maxDate, className }: EventDateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState<Date>(value.start)
  const [draftEnd, setDraftEnd] = useState<Date>(value.end)
  const [presetLabel, setPresetLabel] = useState<string | null>(null)
  const [startInput, setStartInput] = useState(formatDate(value.start))
  const [endInput, setEndInput] = useState(formatDate(value.end))

  const syncDraftFromValue = useCallback(() => {
    setDraftStart(value.start)
    setDraftEnd(value.end)
    setStartInput(formatDate(value.start))
    setEndInput(formatDate(value.end))
  }, [value.start, value.end])

  const handleOpenChange = (next: boolean) => {
    syncDraftFromValue()
    setOpen(next)
  }

  const applyPreset = (days: number) => {
    const { start, end } = getRangeForPreset(days)
    setDraftStart(start)
    setDraftEnd(end)
    setStartInput(formatDate(start))
    setEndInput(formatDate(end))
    setPresetLabel(PRESETS.find(p => p.days === days)?.label ?? null)
  }

  const handlePresetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === 'custom') {
      setPresetLabel(null)
      return
    }
    const days = parseInt(val, 10)
    if (!isNaN(days)) applyPreset(days)
  }

  const clampToMaxDate = useCallback((d: Date): Date => {
    if (!maxDate) return d
    const max = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    return day > max ? max : d
  }, [maxDate])

  const handleStartInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setStartInput(v)
    setPresetLabel(null)
    const parsed = parseDateFromFlexible(v)
    if (parsed) setDraftStart(clampToMaxDate(parsed))
  }

  const handleEndInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setEndInput(v)
    setPresetLabel(null)
    const parsed = parseDateFromFlexible(v)
    if (parsed) setDraftEnd(clampToMaxDate(parsed))
  }

  function parseDateFromFlexible(str: string): Date | null {
    if (!str.trim()) return null
    const fromIso = parseDateString(str)
    if (fromIso) return fromIso
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d
    return null
  }

  const handleCalendarSelect = (date: Date) => {
    if (maxDate) {
      const max = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      if (day > max) return
    }
    setPresetLabel(null)
    if (!draftStart || (draftStart && draftEnd && !isSameDay(draftStart, draftEnd))) {
      setDraftStart(date)
      setDraftEnd(date)
      setStartInput(formatDate(date))
      setEndInput(formatDate(date))
    } else {
      if (date < draftStart) {
        setDraftEnd(draftStart)
        setDraftStart(date)
        setStartInput(formatDate(date))
        setEndInput(formatDate(draftStart))
      } else {
        setDraftEnd(date)
        setEndInput(formatDate(date))
      }
    }
  }

  const isInRange = (date: Date) => {
    if (!draftStart || !draftEnd) return false
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const s = new Date(draftStart.getFullYear(), draftStart.getMonth(), draftStart.getDate())
    const e = new Date(draftEnd.getFullYear(), draftEnd.getMonth(), draftEnd.getDate())
    return d >= s && d <= e
  }

  const isRangeStart = (date: Date) =>
    draftStart && isSameDay(date, draftStart)

  const isRangeEnd = (date: Date) =>
    draftEnd && isSameDay(date, draftEnd)

  const handleApply = () => {
    let start = new Date(draftStart.getFullYear(), draftStart.getMonth(), draftStart.getDate())
    let end = new Date(draftEnd.getFullYear(), draftEnd.getMonth(), draftEnd.getDate())
    if (maxDate) {
      const max = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())
      if (end > max) end = max
      if (start > end) start = end
    }
    end.setHours(23, 59, 59, 999)
    if (start > end) {
      onChange({ start: end, end: start })
    } else {
      onChange({ start, end })
    }
    setOpen(false)
  }

  const handleCancel = () => {
    syncDraftFromValue()
    setOpen(false)
  }

  const [leftMonth, setLeftMonth] = useState(() => new Date(draftStart.getFullYear(), draftStart.getMonth(), 1))

  useEffect(() => {
    if (open) {
      setLeftMonth(new Date(draftStart.getFullYear(), draftStart.getMonth(), 1))
    }
  }, [open, draftStart])

  const rightMonth = useMemo(() => {
    const next = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1)
    return next
  }, [leftMonth])

  const currentPresetValue = useMemo(() => {
    const days = Math.round((value.end.getTime() - value.start.getTime()) / MS_PER_DAY)
    const p = PRESETS.find(x => x.days === days)
    return p ? String(p.days) : 'custom'
  }, [value])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-bold text-[#111827]',
            'hover:bg-gray-50 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300',
            className,
          )}
        >
          <CalendarDays className="w-4 h-4 text-gray-500" />
          Custom
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[800px] min-w-[800px] max-w-[95vw] p-0 overflow-visible rounded-xl border border-gray-200 bg-white shadow-lg" sideOffset={8}>
        <div className="flex flex-nowrap overflow-visible">
          {/* Left: Date range controls */}
          <div className="w-[240px] shrink-0 p-4 border-r border-gray-100 space-y-4">
            <p className="text-[12px] font-bold text-[#111827] uppercase tracking-wider">Date range</p>
            <select
              value={currentPresetValue}
              onChange={handlePresetSelect}
              className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-bold text-[#111827] focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <option value="custom">Custom...</option>
              {PRESETS.map(p => (
                <option key={p.days} value={p.days}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="space-y-2">
              <input
                type="text"
                value={startInput}
                onChange={handleStartInputChange}
                onBlur={() => setStartInput(formatDate(draftStart))}
                placeholder="Start date"
                className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-medium text-[#111827] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <span className="text-gray-500 text-[12px] font-medium block">to</span>
              <input
                type="text"
                value={endInput}
                onChange={handleEndInputChange}
                onBlur={() => setEndInput(formatDate(draftEnd))}
                placeholder="End date"
                className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-medium text-[#111827] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
          </div>
          {/* Right: Two calendars with shared nav */}
          <div className="flex flex-nowrap shrink-0 px-5 pb-2">
            <div className="flex flex-col">
              {/* Shared header: one < on left, one > on right */}
              <div className="flex items-center justify-between gap-4 px-3 pt-3 pb-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() - 1, 1))}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] font-bold text-[#111827] shrink-0 whitespace-nowrap">
                  {getMonthName(leftMonth.getMonth())} {leftMonth.getFullYear()} — {getMonthName(rightMonth.getMonth())} {rightMonth.getFullYear()}
                </span>
                <button
                  type="button"
                  onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1))}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex">
            <Calendar
              className="shrink-0"
              hideMonthNav
              currentMonthOnly
              month={leftMonth}
              onMonthChange={setLeftMonth}
              onSelect={handleCalendarSelect}
              maxDate={maxDate}
              renderDay={(date, defaultEl) => {
                const inRange = isInRange(date)
                const start = isRangeStart(date)
                const end = isRangeEnd(date)
                return (
                    <span className="inline-block w-full">
                    {React.cloneElement(defaultEl as React.ReactElement<{ className?: string }>, {
                      className: cn(
                        (defaultEl as React.ReactElement<{ className?: string }>).props.className,
                        inRange && !start && !end && 'bg-gray-100 rounded-none',
                        inRange && (start || end) && 'bg-[#111827] text-white',
                      ),
                    })}
                  </span>
                )
              }}
            />
            <Calendar
              className="shrink-0"
              hideMonthNav
              currentMonthOnly
              month={rightMonth}
              onMonthChange={m => setLeftMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              onSelect={handleCalendarSelect}
              maxDate={maxDate}
              renderDay={(date, defaultEl) => {
                const inRange = isInRange(date)
                const start = isRangeStart(date)
                const end = isRangeEnd(date)
                return (
                    <span className="inline-block w-full">
                    {React.cloneElement(defaultEl as React.ReactElement<{ className?: string }>, {
                      className: cn(
                        (defaultEl as React.ReactElement<{ className?: string }>).props.className,
                        inRange && !start && !end && 'bg-gray-100 rounded-none',
                        inRange && (start || end) && 'bg-[#111827] text-white',
                      ),
                    })}
                  </span>
                )
              }}
            />
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all"
          >
            Apply
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
