import { useCallback } from 'react'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import { cn } from './utils'

export interface DateTimePickerProps {
  /** Value as "YYYY-MM-DDTHH:mm" or "" */
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  minDate?: Date
  maxDate?: Date
  /** Time slot interval in minutes (default 30) */
  interval?: number
  disabled?: boolean
  className?: string
}

export function DateTimePicker({
  value = '',
  onChange,
  placeholder = 'Pick date & time',
  minDate,
  maxDate,
  interval = 30,
  disabled,
  className,
}: DateTimePickerProps) {
  const [datePart, timePart] = value ? value.split('T') : ['', '']

  const handleDateChange = useCallback((dateStr: string) => {
    if (!dateStr) {
      onChange?.('')
      return
    }
    const time = timePart || '09:00'
    onChange?.(`${dateStr}T${time}`)
  }, [timePart, onChange])

  const handleTimeChange = useCallback((timeStr: string) => {
    if (!datePart) {
      // If no date yet, use today
      const now = new Date()
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, '0')
      const d = String(now.getDate()).padStart(2, '0')
      onChange?.(`${y}-${m}-${d}T${timeStr}`)
      return
    }
    onChange?.(`${datePart}T${timeStr}`)
  }, [datePart, onChange])

  return (
    <div className={cn('flex gap-2', className)}>
      <div className="flex-1">
        <DatePicker
          value={datePart}
          onChange={handleDateChange}
          placeholder={placeholder}
          minDate={minDate}
          maxDate={maxDate}
          disabled={disabled}
        />
      </div>
      <div className="w-36">
        <TimePicker
          value={timePart}
          onChange={handleTimeChange}
          interval={interval}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
