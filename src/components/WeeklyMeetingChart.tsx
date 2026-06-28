/**
 * Weekly Meeting Chart
 *
 * Line chart comparing current week vs last week.
 * Y-axis: total time in meetings (minutes per day).
 * X-axis: Mon–Sun.
 * Two lines with gradient shading: this week (black) and last week (grey).
 * Hover tooltip shows meeting count and time for both weeks on that day.
 */

import { useMemo, useState, useRef, useCallback } from 'react'
import { getMondayOf } from './ui/date-utils'
import type { BookingWithRole } from '../hooks/useBookings'

interface DayData {
  label: string
  /** total confirmed meeting minutes */
  minutes: number
  /** total confirmed meeting count */
  count: number
}

interface WeeklyMeetingChartProps {
  /** All bookings with role (host + guest) */
  allBookings: BookingWithRole[]
  /** Optional className for root element */
  className?: string
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Check if a booking falls on the given calendar day (local timezone). */
function isOnCalendarDay(startTime: string, year: number, month: number, date: number): boolean {
  const s = new Date(startTime)
  return s.getFullYear() === year && s.getMonth() === month && s.getDate() === date
}

function computeWeekData(bookings: BookingWithRole[], weekStart: Date): DayData[] {
  const wy = weekStart.getFullYear()
  const wm = weekStart.getMonth()
  const wd = weekStart.getDate()

  return DAY_LABELS.map((label, i) => {
    const dayDate = new Date(wy, wm, wd + i)

    const dayBookings = bookings.filter(b => {
      if (b.status === 'cancelled') return false
      return isOnCalendarDay(b.startTime, dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate())
    })

    const minutes = dayBookings.reduce((sum, b) => {
      const start = new Date(b.startTime).getTime()
      const end = new Date(b.endTime).getTime()
      return sum + Math.max(0, (end - start) / 60000)
    }, 0)

    return { label, minutes: Math.round(minutes), count: dayBookings.length }
  })
}

function formatMinutes(mins: number): string {
  if (mins === 0) return '0 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

const CHART_H = 180
const CHART_PADDING_Y = 16

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]
    const p1 = points[i]
    const cpX = ((p0.x + p1.x) / 2).toFixed(2)
    d += ` C ${cpX},${p0.y.toFixed(2)} ${cpX},${p1.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`
  }
  return d
}

function buildSmoothArea(points: { x: number; y: number }[], bottom: number): string {
  if (points.length === 0) return ''
  const line = buildSmoothPath(points)
  const first = points[0]
  const last = points[points.length - 1]
  return `${line} L ${last.x.toFixed(2)},${bottom.toFixed(2)} L ${first.x.toFixed(2)},${bottom.toFixed(2)} Z`
}

export function WeeklyMeetingChart({ allBookings, className }: WeeklyMeetingChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltipX, setTooltipX] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)

  const today = new Date()
  const thisWeekStart = useMemo(() => getMondayOf(today), [])
  const lastWeekStart = useMemo(() => {
    const d = new Date(thisWeekStart)
    d.setDate(d.getDate() - 7)
    return d
  }, [thisWeekStart])

  const thisWeekEnd = useMemo(() => {
    const d = new Date(thisWeekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [thisWeekStart])
  const lastWeekEnd = useMemo(() => {
    const d = new Date(lastWeekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [lastWeekStart])

  const thisWeek = useMemo(
    () => computeWeekData(allBookings, thisWeekStart),
    [allBookings, thisWeekStart],
  )
  const lastWeek = useMemo(
    () => computeWeekData(allBookings, lastWeekStart),
    [allBookings, lastWeekStart],
  )

  // Max value across both weeks for Y scaling (minimum 60 so chart doesn't look flat when empty)
  const maxMinutes = useMemo(() => {
    const all = [...thisWeek, ...lastWeek].map(d => d.minutes)
    return Math.max(60, ...all)
  }, [thisWeek, lastWeek])

  // Compute SVG points — will be positioned relative to the SVG viewBox width
  // We use a 600-unit wide viewBox for consistent math
  const VIEWBOX_W = 600

  const getPoints = useCallback(
    (data: DayData[]): { x: number; y: number }[] => {
      const n = data.length
      return data.map((d, i) => {
        // Center each point within its day column so it aligns with the x-axis labels
        const x = ((i + 0.5) / n) * VIEWBOX_W
        const y = CHART_PADDING_Y + (1 - d.minutes / maxMinutes) * (CHART_H - CHART_PADDING_Y * 2)
        return { x, y }
      })
    },
    [maxMinutes],
  )

  const thisWeekPoints = useMemo(() => getPoints(thisWeek), [getPoints, thisWeek])
  const lastWeekPoints = useMemo(() => getPoints(lastWeek), [getPoints, lastWeek])

  const bottom = CHART_H - CHART_PADDING_Y

  const thisPath = buildSmoothPath(thisWeekPoints)
  const thisArea = buildSmoothArea(thisWeekPoints, bottom)
  const lastPath = buildSmoothPath(lastWeekPoints)
  const lastArea = buildSmoothArea(lastWeekPoints, bottom)

  // Y-axis tick values
  const yTicks = useMemo(() => {
    const step = maxMinutes <= 60 ? 30 : maxMinutes <= 180 ? 60 : maxMinutes <= 480 ? 120 : 240
    const ticks: number[] = []
    for (let v = 0; v <= maxMinutes; v += step) ticks.push(v)
    if (ticks[ticks.length - 1] < maxMinutes) ticks.push(ticks[ticks.length - 1] + step)
    return ticks
  }, [maxMinutes])

  const yTickToSvgY = (v: number) =>
    CHART_PADDING_Y + (1 - v / maxMinutes) * (CHART_H - CHART_PADDING_Y * 2)

  // Hovering
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const relX = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W
      // Find nearest day index
      let closest = 0
      let minDist = Infinity
      thisWeekPoints.forEach((p, i) => {
        const d = Math.abs(p.x - relX)
        if (d < minDist) { minDist = d; closest = i }
      })
      setHoveredIdx(closest)
      setTooltipX(thisWeekPoints[closest].x)
    },
    [thisWeekPoints],
  )

  const todayDayOfWeek = today.getDay()
  // 0=Sun→6, 1=Mon→0 ... map to index in Mon–Sun array
  const todayIdx = todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1

  return (
    <div className={`app-card overflow-hidden flex flex-col ${className ?? ''}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100 shrink-0 flex items-center justify-between">
        <div>
          <h3 className="text-[12px] font-bold text-[#111827]">Weekly Meeting Time</h3>
          <p className="text-[12px] text-gray-500 font-medium mt-0.5">
            Last week: {formatDateRange(lastWeekStart, lastWeekEnd)} · This week: {formatDateRange(thisWeekStart, thisWeekEnd)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-0.5 rounded bg-[#111827] inline-block" />
            <span className="text-[12px] text-gray-500 font-medium">This week</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-0.5 rounded bg-gray-300 inline-block" />
            <span className="text-[12px] text-gray-500 font-medium">Last week</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 p-4 min-h-0 relative">
        {/* Y-axis labels */}
        <div className="flex">
          {/* Y labels column */}
          <div className="flex flex-col justify-between shrink-0 pr-2" style={{ height: CHART_H }}>
            {[...yTicks].reverse().map(v => (
              <span key={v} className="text-[11px] text-gray-400 font-medium leading-none">
                {formatMinutes(v)}
              </span>
            ))}
          </div>

          {/* SVG chart */}
          <div className="flex-1 relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEWBOX_W} ${CHART_H}`}
              preserveAspectRatio="none"
              className="w-full"
              style={{ height: CHART_H, display: 'block', cursor: 'crosshair' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <defs>
                {/* Black gradient for this week */}
                <linearGradient id="grad-black" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#111827" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#111827" stopOpacity="0.01" />
                </linearGradient>
                {/* Grey gradient for last week */}
                <linearGradient id="grad-grey" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#9ca3af" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#9ca3af" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Y-axis grid lines */}
              {yTicks.map(v => {
                const y = yTickToSvgY(v)
                return (
                  <line
                    key={v}
                    x1={0} y1={y} x2={VIEWBOX_W} y2={y}
                    stroke="#f3f4f6" strokeWidth="1"
                  />
                )
              })}

              {/* Today vertical marker */}
              {todayIdx >= 0 && todayIdx < 7 && (
                <line
                  x1={thisWeekPoints[todayIdx]?.x} y1={CHART_PADDING_Y}
                  x2={thisWeekPoints[todayIdx]?.x} y2={bottom}
                  stroke="#e5e7eb" strokeWidth="1.5" strokeDasharray="4 3"
                />
              )}

              {/* Hover vertical line */}
              {hoveredIdx !== null && (
                <line
                  x1={tooltipX} y1={CHART_PADDING_Y}
                  x2={tooltipX} y2={bottom}
                  stroke="#d1d5db" strokeWidth="1" strokeDasharray="4 3"
                />
              )}

              {/* Last week area + line (render first so this week is on top) */}
              <path d={lastArea} fill="url(#grad-grey)" />
              <path d={lastPath} fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" />

              {/* This week area + line */}
              <path d={thisArea} fill="url(#grad-black)" />
              <path d={thisPath} fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
            </svg>

            {/* Tooltip */}
            {hoveredIdx !== null && (() => {
              const tw = thisWeek[hoveredIdx]
              const lw = lastWeek[hoveredIdx]
              const isRight = tooltipX > VIEWBOX_W * 0.65
              // Convert viewBox x to percentage for positioning
              const xPct = (tooltipX / VIEWBOX_W) * 100
              return (
                <div
                  className="absolute top-2 z-20 pointer-events-none"
                  style={{
                    left: isRight ? 'auto' : `${xPct}%`,
                    right: isRight ? `${100 - xPct}%` : 'auto',
                    transform: isRight ? 'translateX(8px)' : 'translateX(-50%)',
                    minWidth: 160,
                  }}
                >
                  <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-left">
                    <p className="text-[12px] font-bold text-[#111827] mb-2">{tw.label}</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#111827] shrink-0" />
                        <div>
                          <span className="text-[12px] font-bold text-[#111827]">{formatMinutes(tw.minutes)}</span>
                          <span className="text-[11px] text-gray-500 ml-1">· {tw.count} {tw.count === 1 ? 'meeting' : 'meetings'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
                        <div>
                          <span className="text-[12px] font-bold text-gray-500">{formatMinutes(lw.minutes)}</span>
                          <span className="text-[11px] text-gray-400 ml-1">· {lw.count} {lw.count === 1 ? 'meeting' : 'meetings'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* X-axis labels — absolutely positioned at the same x as the SVG points */}
            <div className="relative mt-1" style={{ height: '1.125rem' }}>
              {DAY_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={`absolute text-[12px] font-medium transition-colors -translate-x-1/2 ${
                    hoveredIdx === i
                      ? 'text-[#111827] font-bold'
                      : i === todayIdx
                        ? 'text-[#111827] font-bold'
                        : 'text-gray-400'
                  }`}
                  style={{ left: `${((i + 0.5) / DAY_LABELS.length) * 100}%` }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
