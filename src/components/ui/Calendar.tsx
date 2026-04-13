import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from './utils'
import { getMonthGrid, getMonthGridCurrentMonthOnly, getMonthName, isSameDay, isToday, toDateString } from './date-utils'

export interface CalendarProps {
  selected?: Date | null
  onSelect?: (date: Date) => void
  /** Controlled month view */
  month?: Date
  onMonthChange?: (date: Date) => void
  minDate?: Date
  maxDate?: Date
  disabledDates?: (date: Date) => boolean
  /** Custom day rendering — receives the date, default element, and display context */
  renderDay?: (date: Date, defaultEl: ReactNode, context?: { month: number; year: number; disabled: boolean }) => ReactNode
  /** When true, hide the month header (prev/next + title). Used for dual-calendar with shared nav. */
  hideMonthNav?: boolean
  /** When true, show only days of the current month (no greyed-out adjacent month days). */
  currentMonthOnly?: boolean
  /** When true, use a more compact layout (smaller text and cells). */
  compact?: boolean
  className?: string
}

export function Calendar({
  selected,
  onSelect,
  month: controlledMonth,
  onMonthChange,
  minDate,
  maxDate,
  disabledDates,
  renderDay,
  hideMonthNav,
  currentMonthOnly,
  compact,
  className,
}: CalendarProps) {
  const [internalMonth, setInternalMonth] = useState(() => {
    if (controlledMonth) return controlledMonth
    if (selected) return new Date(selected.getFullYear(), selected.getMonth(), 1)
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const displayMonth = controlledMonth ?? internalMonth
  const year = displayMonth.getFullYear()
  const monthIdx = displayMonth.getMonth()

  const setMonth = useCallback((d: Date) => {
    if (onMonthChange) onMonthChange(d)
    else setInternalMonth(d)
  }, [onMonthChange])

  const days = useMemo(
    () => (currentMonthOnly ? getMonthGridCurrentMonthOnly(year, monthIdx) : getMonthGrid(year, monthIdx)),
    [year, monthIdx, currentMonthOnly],
  )

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Sync internal month when controlledMonth changes
  useEffect(() => {
    if (controlledMonth) setInternalMonth(controlledMonth)
  }, [controlledMonth])

  const isDisabled = useCallback((date: Date): boolean => {
    if (minDate) {
      const min = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
      if (date < min) return true
    }
    if (maxDate) {
      const max = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())
      if (date > max) return true
    }
    if (disabledDates) return disabledDates(date)
    return false
  }, [minDate, maxDate, disabledDates])

  function prevMonth() {
    setMonth(new Date(year, monthIdx - 1, 1))
  }

  function nextMonth() {
    setMonth(new Date(year, monthIdx + 1, 1))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const idx = focusedIndex ?? days.findIndex((d): d is Date => d !== null && !!selected && isSameDay(d, selected))
    if (idx === -1) return

    let next = idx
    const maxIdx = days.length - 1
    switch (e.key) {
      case 'ArrowRight': next = Math.min(idx + 1, maxIdx); break
      case 'ArrowLeft': next = Math.max(idx - 1, 0); break
      case 'ArrowDown': next = Math.min(idx + 7, maxIdx); break
      case 'ArrowUp': next = Math.max(idx - 7, 0); break
      case 'Enter':
      case ' ':
        e.preventDefault()
        const dayAtIdx = days[idx]
        if (dayAtIdx && !isDisabled(dayAtIdx)) onSelect?.(dayAtIdx)
        return
      default: return
    }
    e.preventDefault()
    setFocusedIndex(next)

    // If moved to a different month, navigate (skip when currentMonthOnly or null cell)
    const nextDate = days[next]
    if (nextDate && nextDate.getMonth() !== monthIdx) {
      setMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1))
    }
  }

  const headerTextClass = compact ? 'text-xs' : 'text-sm'
  const dayHeaderClass = compact ? 'text-[10px] py-0.5' : 'text-[13px] py-1'
  const cellSizeClass = compact ? 'w-7 h-7' : 'w-8 h-8'
  const dayTextClass = compact ? 'text-[13px]' : 'text-sm'

  return (
    <div className={cn(compact ? 'p-2' : 'p-3', className)} data-testid="calendar">
      {/* Month/Year header — hidden when hideMonthNav (shared nav in parent) */}
      {!hideMonthNav && (
        <div className={cn('flex items-center justify-between', compact ? 'mb-1' : 'mb-2')}>
          <button
            type="button"
            onClick={prevMonth}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className={cn(compact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
          </button>
          <span className={cn('font-semibold text-foreground', headerTextClass)}>
            {getMonthName(monthIdx)} {year}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className={cn(compact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
          </button>
        </div>
      )}

      {/* Day-of-week headers */}
      <div className={cn('grid grid-cols-7', compact ? 'mb-0.5' : 'mb-1')}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className={cn('text-center font-medium text-muted-foreground', dayHeaderClass)}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        ref={gridRef}
        className="grid grid-cols-7"
        role="grid"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {days.map((dayOrNull, i) => {
          if (dayOrNull === null) {
            return <div key={`empty-${i}`} className={cn(cellSizeClass)} aria-hidden />
          }
          const day = dayOrNull
          const inMonth = currentMonthOnly || day.getMonth() === monthIdx
          const sel = selected ? isSameDay(day, selected) : false
          const today = isToday(day)
          const disabled = isDisabled(day)
          const focused = focusedIndex === i

          const defaultEl = (
            <button
              key={toDateString(day)}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  onSelect?.(day)
                  setFocusedIndex(i)
                }
              }}
              className={cn(
                'relative rounded-md flex items-center justify-center transition-colors mx-auto',
                cellSizeClass,
                dayTextClass,
                sel && 'bg-primary text-primary-foreground font-semibold',
                !sel && today && 'ring-1 ring-primary text-primary font-semibold',
                !sel && !today && inMonth && !disabled && 'text-foreground hover:bg-accent',
                !inMonth && 'text-muted-foreground/40',
                disabled && inMonth && 'text-muted-foreground/40 cursor-not-allowed',
                focused && !sel && 'ring-1 ring-ring',
              )}
              aria-selected={sel}
              aria-disabled={disabled}
              data-date={toDateString(day)}
            >
              {day.getDate()}
            </button>
          )

          return renderDay ? (
            <span key={toDateString(day)}>{renderDay(day, defaultEl, { month: monthIdx, year, disabled })}</span>
          ) : (
            defaultEl
          )
        })}
      </div>
    </div>
  )
}
