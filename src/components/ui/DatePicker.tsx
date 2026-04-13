import { useState, useCallback } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './Popover'
import { Calendar } from './Calendar'
import { cn } from './utils'
import { parseDateString, formatDate, toDateString } from './date-utils'

export interface DatePickerProps {
  /** Value as "YYYY-MM-DD" or "" */
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  minDate?: Date
  maxDate?: Date
  disabledDates?: (date: Date) => boolean
  disabled?: boolean
  className?: string
}

export function DatePicker({
  value = '',
  onChange,
  placeholder = 'Pick a date',
  minDate,
  maxDate,
  disabledDates,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseDateString(value)

  const handleSelect = useCallback((date: Date) => {
    onChange?.(toDateString(date))
    setOpen(false)
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange?.('')
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
          data-testid="date-picker-trigger"
        >
          <span className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            {selected ? formatDate(selected) : placeholder}
          </span>
          {value && !disabled && (
            <X
              className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          selected={selected}
          onSelect={handleSelect}
          minDate={minDate}
          maxDate={maxDate}
          disabledDates={disabledDates}
        />
      </PopoverContent>
    </Popover>
  )
}
