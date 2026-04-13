import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Clock, ChevronDown } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './Popover'
import { cn } from './utils'
import { generateTimeSlots, formatTime12h, parseTimeString } from './date-utils'

export interface TimePickerProps {
  /** Value as "HH:mm" (24h internal) */
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  /** Interval between slots in minutes (default 30) */
  interval?: number
  /** Display format (default '12h') */
  format?: '12h' | '24h'
  /** Minimum time "HH:mm" */
  minTime?: string
  /** Maximum time "HH:mm" */
  maxTime?: string
  disabled?: boolean
  className?: string
}

export function TimePicker({
  value = '',
  onChange,
  placeholder = 'Pick a time',
  interval = 30,
  format = '12h',
  minTime,
  maxTime,
  disabled,
  className,
}: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const slots = useMemo(() => generateTimeSlots(interval, minTime, maxTime), [interval, minTime, maxTime])

  const displayValue = value
    ? (format === '12h' ? formatTime12h(value) : value)
    : ''

  // Auto-scroll to selected or nearest slot when dropdown opens
  useEffect(() => {
    if (!open || !listRef.current) return
    const raf = requestAnimationFrame(() => {
      if (selectedRef.current) {
        selectedRef.current.scrollIntoView({ block: 'center' })
      } else if (value && listRef.current) {
        // Scroll to nearest slot
        const { hours, minutes } = parseTimeString(value)
        const totalMin = hours * 60 + minutes
        const nearestIdx = slots.reduce((best, slot, i) => {
          const { hours: sh, minutes: sm } = parseTimeString(slot)
          const slotMin = sh * 60 + sm
          const bestSlot = parseTimeString(slots[best])
          const bestMin = bestSlot.hours * 60 + bestSlot.minutes
          return Math.abs(slotMin - totalMin) < Math.abs(bestMin - totalMin) ? i : best
        }, 0)
        const buttons = listRef.current.querySelectorAll('button')
        buttons[nearestIdx]?.scrollIntoView({ block: 'center' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [open, value, slots])

  const handleSelect = useCallback((slot: string) => {
    onChange?.(slot)
    setOpen(false)
  }, [onChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !value && 'text-muted-foreground',
            className,
          )}
          data-testid="time-picker-trigger"
        >
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            {displayValue || placeholder}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div ref={listRef} className="max-h-56 overflow-y-auto">
          {slots.map(slot => {
            const isSelected = slot === value
            return (
              <button
                key={slot}
                ref={isSelected ? selectedRef : undefined}
                type="button"
                onClick={() => handleSelect(slot)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-foreground hover:bg-accent',
                )}
              >
                {format === '12h' ? formatTime12h(slot) : slot}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
