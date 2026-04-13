/**
 * Analytics Page
 *
 * Booking statistics: counts, popular times, cancellation rate.
 * Derived from existing bookings data — no new schema needed.
 */

import { useMemo, useState, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useBookings, useEventTypes } from '../hooks'
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/Popover'
import { EventDateRangePicker } from '../components/EventDateRangePicker'
import { PageHeader } from '../components/PageHeader'
import { EVENT_DURATIONS } from '../constants'

/** Time window boundaries for analytics comparisons */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Past meeting that counts as “completed” for stats: ended, confirmed or legacy completed, not no-show. */
function bookingCountsAsCompleted(
  b: { status: string; endTime: string },
  now: Date,
): boolean {
  if (b.status === 'cancelled' || b.status === 'no_show') return false
  const end = new Date(b.endTime)
  if (isNaN(end.getTime()) || end.getTime() > now.getTime()) return false
  return b.status === 'confirmed' || b.status === 'completed'
}

function getDefaultDateRange(): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - 30 * MS_PER_DAY)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

export default function AnalyticsPage() {
  const { hostedBookings } = useBookings()
  const { eventTypes } = useEventTypes()
  const [dateRange, setDateRange] = useState(getDefaultDateRange)

  // Clamp date range to today so prior-period comparisons work correctly
  useEffect(() => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    if (dateRange.end > today) {
      const clampedEnd = new Date(today)
      clampedEnd.setHours(23, 59, 59, 999)
      const start = dateRange.start
      if (start > clampedEnd) {
        const clampedStart = new Date(clampedEnd)
        clampedStart.setDate(clampedStart.getDate() - 30)
        clampedStart.setHours(0, 0, 0, 0)
        setDateRange({ start: clampedStart, end: clampedEnd })
      } else {
        setDateRange({ start, end: clampedEnd })
      }
    }
  }, [dateRange])

  const stats = useMemo(() => {
    const rangeStart = dateRange.start
    const rangeEnd = dateRange.end
    const rangeMs = rangeEnd.getTime() - rangeStart.getTime()
    const rangeDays = Math.ceil(rangeMs / MS_PER_DAY)
    const priorStart = new Date(rangeStart.getTime() - rangeDays * MS_PER_DAY)
    priorStart.setHours(0, 0, 0, 0)
    const priorEnd = new Date(rangeStart.getTime() - 1)
    priorEnd.setHours(23, 59, 59, 999)

    const allHostBookings = hostedBookings
    const inRange = (d: Date) => d >= rangeStart && d <= rangeEnd
    const inPriorRange = (d: Date) => d >= priorStart && d <= priorEnd

    const cancelled = allHostBookings.filter(b => b.status === 'cancelled')

    const now = new Date()

    // Top 4 blocks: Created, Completed, Avg/Week, Canceled (vs prior period of same length)
    const createdCurrent = allHostBookings.filter(b => inRange(new Date(b.createdAt))).length
    const createdPrior = allHostBookings.filter(b => inPriorRange(new Date(b.createdAt))).length

    const completedCurrent = allHostBookings.filter(
      b =>
        bookingCountsAsCompleted(b, now) &&
        inRange(new Date(b.startTime)),
    ).length
    const completedPrior = allHostBookings.filter(
      b =>
        bookingCountsAsCompleted(b, now) &&
        inPriorRange(new Date(b.startTime)),
    ).length

    const canceledCurrent = cancelled.filter(b => inRange(new Date(b.createdAt))).length
    const canceledPrior = cancelled.filter(b => inPriorRange(new Date(b.createdAt))).length

    // Popular hours: within selected date range (non-cancelled bookings)
    const hourCounts: Record<number, number> = {}
    for (let h = 0; h < 24; h++) hourCounts[h] = 0
    for (const b of allHostBookings.filter(b => b.status !== 'cancelled')) {
      const start = new Date(b.startTime)
      if (inRange(start)) {
        const hour = start.getHours()
        hourCounts[hour] = (hourCounts[hour] || 0) + 1
      }
    }
    const popularHours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourCounts[h] ?? 0 }))

    // Popular days of week within selected date range
    const dayCounts: Record<string, number> = {}
    const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    for (const d of dayOrder) dayCounts[d] = 0
    for (const b of allHostBookings.filter(b => b.status !== 'cancelled')) {
      const start = new Date(b.startTime)
      if (inRange(start)) {
        const dayIdx = start.getDay()
        const dayName = dayOrder[dayIdx]
        dayCounts[dayName] = (dayCounts[dayName] ?? 0) + 1
      }
    }

    // Bookings by event type
    const eventTypeCounts: Record<string, { title: string; count: number; color: string }> = {}
    for (const b of allHostBookings) {
      const et = eventTypes.find(e => e.id === b.eventTypeId)
      const key = b.eventTypeId
      if (!eventTypeCounts[key]) {
        eventTypeCounts[key] = { title: et?.title ?? b.eventTitle, count: 0, color: et?.color ?? '#8b5cf6' }
      }
      eventTypeCounts[key].count++
    }
    const topEventTypes = Object.values(eventTypeCounts).sort((a, b) => b.count - a.count)

    // Bookings by duration (horizontal histogram) — within date range
    const durationBuckets = [15, 20, 30, 45, 60, 90, 120]
    const durationCounts: Record<number, number> = {}
    for (const d of durationBuckets) durationCounts[d] = 0
    let otherCount = 0
    for (const b of allHostBookings.filter(b => b.status !== 'cancelled')) {
      const start = new Date(b.startTime)
      if (!inRange(start)) continue
      const end = new Date(b.endTime)
      const mins = Math.round((end.getTime() - start.getTime()) / 60000)
      const nearest = durationBuckets.reduce((a, c) => (Math.abs(c - mins) < Math.abs(a - mins) ? c : a))
      if (Math.abs(nearest - mins) <= 15) {
        durationCounts[nearest] = (durationCounts[nearest] ?? 0) + 1
      } else {
        otherCount++
      }
    }
    const durationData = durationBuckets.map(d => ({
      duration: d,
      label: EVENT_DURATIONS.find(e => e.value === d)?.label ?? `${d} min`,
      count: durationCounts[d] ?? 0,
    }))
    if (otherCount > 0) durationData.push({ duration: 0, label: 'Other' as (typeof EVENT_DURATIONS)[number]['label'] | `${number} min`, count: otherCount })

    const recentBookings = allHostBookings.filter(b => inRange(new Date(b.createdAt)))
    const recentPriorBookings = allHostBookings.filter(b => inPriorRange(new Date(b.createdAt)))
    const weeksInRange = Math.max(1, Math.ceil(rangeDays / 7))
    const avgPerWeekCurrent = recentBookings.length / weeksInRange
    const avgPerWeekPrior = recentPriorBookings.length / weeksInRange

    return {
      popularHours,
      dayCounts,
      topEventTypes,
      durationData,
      created: { current: createdCurrent, prior: createdPrior },
      completedEvents: { current: completedCurrent, prior: completedPrior },
      avgPerWeek: { current: avgPerWeekCurrent, prior: avgPerWeekPrior },
      canceled: { current: canceledCurrent, prior: canceledPrior },
      dateRangeStart: rangeStart,
      dateRangeEnd: rangeEnd,
      rangeDays,
    }
  }, [hostedBookings, eventTypes, dateRange])

  const formatDateRange = (start: Date, end: Date) => {
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${fmt(start)} – ${fmt(end)}`
  }

  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM'
    if (hour < 12) return `${hour} AM`
    if (hour === 12) return '12 PM'
    return `${hour - 12} PM`
  }

  const formatDayShort = (day: string) => day.charAt(0).toUpperCase() + day.slice(1, 3)

  const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
  const maxDayCount = Math.max(1, ...dayOrder.map(d => stats.dayCounts[d] ?? 0))
  const maxHourCount = Math.max(2, ...stats.popularHours.map(h => h.count))

  return (
    <div data-testid="analytics-page" className="flex-1 flex flex-col min-h-0 bg-[#F3F4F6]">
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="max-w-[1600px] mx-auto mb-6 px-2">
          <PageHeader
            title={<h1 className="text-3xl font-bold text-[#111827] tracking-tight">Analytics</h1>}
            subtitle={<p className="text-sm text-gray-500 font-medium">Your booking statistics at a glance</p>}
            actions={
              <div className="flex items-center gap-3">
                <p className="text-[12px] font-bold text-[#111827] uppercase tracking-wider">Event Date</p>
                <EventDateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  maxDate={new Date()}
                />
              </div>
            }
          />
          <div className="space-y-4">
          <p className="text-sm text-gray-500 font-medium">Event Data</p>

          {/* Top 4 Analytics Blocks */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AnalyticsStatBlock
          title="Created Events"
          infoContent="Bookings created in the selected date range. Includes all new bookings regardless of status."
          value={stats.created.current}
          priorValue={stats.created.prior}
          vsLabel={`vs prior ${stats.rangeDays} days`}
        />
        <AnalyticsStatBlock
          title="Completed Events"
          infoContent="Meetings that ended in the selected range and count as completed: confirmed bookings after their end time, excluding no-shows. Compared to the prior period of the same length."
          value={stats.completedEvents.current}
          priorValue={stats.completedEvents.prior}
          vsLabel={`vs prior ${stats.rangeDays} days`}
        />
        <AnalyticsStatBlock
          title="Canceled Events"
          infoContent="Cancelled bookings created in the selected date range. Tracks cancellations within your booking period."
          value={stats.canceled.current}
          priorValue={stats.canceled.prior}
          vsLabel={`vs prior ${stats.rangeDays} days`}
          deltaAlwaysRed
        />
        <AnalyticsStatBlock
          title="Avg / Week"
          infoContent="Average bookings created per week over the selected date range. Weeks are counted from the range length (partial weeks count as one). Compared to the prior period of the same length."
          value={stats.avgPerWeek.current}
          priorValue={stats.avgPerWeek.prior}
          vsLabel={`vs prior ${stats.rangeDays} days`}
          numberFormat="decimal1"
        />
      </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Bookings by Day — left of Popular Times */}
            <div className="app-card overflow-hidden p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[12px] font-bold text-[#111827]">Bookings by Day</h2>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-0.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label="Info about Bookings by Day"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="max-w-[260px] text-[12px] font-medium">
                  Distribution of bookings by day of week over the last 30 days. Use this to see which
                  days are most popular. Based on all non-cancelled bookings in range.
                </PopoverContent>
              </Popover>
            </div>
            <span className="text-[11px] text-gray-500 font-medium shrink-0">
              {formatDateRange(stats.dateRangeStart, stats.dateRangeEnd)}
            </span>
          </div>
          <BookingsByDayChart
            dayCounts={stats.dayCounts}
            dayOrder={dayOrder}
            maxCount={maxDayCount}
            formatDayShort={formatDayShort}
          />
            </div>

            {/* Popular Times — right of Bookings by Day */}
            <div className="app-card overflow-hidden p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[12px] font-bold text-[#111827]">Popular Times</h2>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-0.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label="Info about Popular Times"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="max-w-[260px] text-[12px] font-medium">
                  Distribution of bookings by hour of day. Use this to identify peak times and adjust
                  availability. Based on all non-cancelled bookings in range.
                </PopoverContent>
              </Popover>
            </div>
            <span className="text-[11px] text-gray-500 font-medium shrink-0">
              {formatDateRange(stats.dateRangeStart, stats.dateRangeEnd)}
            </span>
          </div>
          <PopularTimesLineChart
            data={stats.popularHours}
            maxCount={maxHourCount}
            formatHour={formatHour}
          />
            </div>

            {/* Event by Duration — under Bookings by Day */}
            <div className="app-card overflow-hidden p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[12px] font-bold text-[#111827]">Event by Duration</h2>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-0.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                    aria-label="Info about Event by Duration"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="max-w-[260px] text-[12px] font-medium">
                  Distribution of bookings by event length. Shows which duration is most common.
                  Based on all non-cancelled bookings in range.
                </PopoverContent>
              </Popover>
            </div>
            <span className="text-[11px] text-gray-500 font-medium shrink-0">
              {formatDateRange(stats.dateRangeStart, stats.dateRangeEnd)}
            </span>
          </div>
          <EventByDurationChart data={stats.durationData} />
            </div>

            {/* Bookings by Event Type — under Popular Times, top 6 */}
            <div className="app-card overflow-hidden p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h2 className="text-[12px] font-bold text-[#111827]">Bookings by Event Type</h2>
                <span className="text-[11px] text-gray-500 font-medium shrink-0">
                  {formatDateRange(stats.dateRangeStart, stats.dateRangeEnd)}
                </span>
              </div>
              {stats.topEventTypes.length === 0 ? (
                <div className="h-[180px] flex items-center">
                  <p className="text-[12px] text-gray-500 font-medium">No booking data yet</p>
                </div>
              ) : (
                <div className="space-y-3 min-h-[180px]">
                  {stats.topEventTypes.slice(0, 6).map((et, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: et.color }} />
                      <span className="text-[12px] font-medium text-[#111827] flex-1 truncate">{et.title}</span>
                      <span className="text-[12px] font-medium text-gray-500">{et.count} booking{et.count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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

interface PopularTimesLineChartProps {
  data: { hour: number; count: number }[]
  maxCount: number
  formatHour: (hour: number) => string
}

function PopularTimesLineChart({ data, maxCount, formatHour }: PopularTimesLineChartProps) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)

  const width = 400
  const height = 180
  const padding = { top: 12, right: 12, bottom: 28, left: 44 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const bottom = padding.top + chartHeight

  const xScale = (hour: number) => padding.left + (hour / 23) * chartWidth
  const yScale = (count: number) =>
    padding.top + chartHeight - (count / maxCount) * chartHeight

  const points = data.map(d => ({ x: xScale(d.hour), y: yScale(d.count), ...d }))
  const smoothPath = buildSmoothPath(points)
  const smoothArea = buildSmoothArea(points, bottom)

  const xTicks = [0, 6, 12, 18, 23]
  const yTicks = Array.from({ length: maxCount + 1 }, (_, i) => i)
  const hoveredPoint =
    hoveredHour !== null ? { x: xScale(hoveredHour), hour: hoveredHour, count: data[hoveredHour]?.count ?? 0 } : null

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgPt = pt.matrixTransform(ctm.inverse())
    if (svgPt.x >= padding.left && svgPt.x <= width - padding.right && svgPt.y >= padding.top && svgPt.y <= padding.top + chartHeight) {
      const hour = Math.min(23, Math.max(0, Math.floor(((svgPt.x - padding.left) / chartWidth) * 24)))
      setHoveredHour(hour)
    } else {
      setHoveredHour(null)
    }
  }

  return (
    <div className="w-full overflow-hidden relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[280px] h-[180px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Booking distribution by hour of day"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredHour(null)}
      >
        <defs>
          <linearGradient id="popular-times-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#111827" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#111827" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {/* Y-axis label — rotated, positioned left of chart */}
        <text
          x={12}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          className="fill-gray-500 text-[12px] font-medium"
          transform={`rotate(-90, 12, ${padding.top + chartHeight / 2})`}
        >
          Bookings
        </text>
        {/* Grid lines — chart area only, aligned with y ticks, don't cut through numbers */}
        {yTicks.map((count, i) => (
          <line
            key={i}
            x1={padding.left}
            y1={yScale(count)}
            x2={width - padding.right}
            y2={yScale(count)}
            stroke="#f3f4f6"
            strokeOpacity="1"
          />
        ))}
        {/* Hover vertical line — full height of chart */}
        {hoveredPoint !== null && (
          <line
            x1={hoveredPoint.x}
            y1={padding.top}
            x2={hoveredPoint.x}
            y2={padding.top + chartHeight}
            stroke="#111827"
            strokeWidth="1.5"
            strokeOpacity="0.6"
            strokeDasharray="4 4"
          />
        )}
        {/* Shaded area under smooth line */}
        <path d={smoothArea} fill="url(#popular-times-grad)" />
        {/* Smooth line */}
        <path
          d={smoothPath}
          fill="none"
          stroke="#111827"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none"
        />
        {/* X axis labels */}
        {xTicks.map(hour => (
          <text
            key={hour}
            x={xScale(hour)}
            y={height - 6}
            textAnchor="middle"
            className="fill-gray-500 text-[12px] font-medium"
          >
            {formatHour(hour)}
          </text>
        ))}
        {/* Y axis labels — positioned left of grid so lines don't cut through */}
        {yTicks.map((count, i) => (
          <text
            key={i}
            x={padding.left - 10}
            y={yScale(count) + 4}
            textAnchor="end"
            className="fill-gray-500 text-[12px] font-medium"
          >
            {count}
          </text>
        ))}
      </svg>
      {/* Hover tooltip — positioned above chart, centered on hovered point */}
      {hoveredPoint !== null && (
        <div
          className="absolute top-0 px-3 py-2 rounded-lg bg-white border border-gray-200 shadow-md text-center pointer-events-none z-10 min-w-[100px]"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-[12px] font-bold text-[#111827]">{formatHour(hoveredPoint.hour)}</p>
          <p className="text-[11px] text-gray-500 font-medium">
            {hoveredPoint.count} meeting{hoveredPoint.count !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}

interface BookingsByDayChartProps {
  dayCounts: Record<string, number>
  dayOrder: readonly string[]
  maxCount: number
  formatDayShort: (day: string) => string
}

function BookingsByDayChart({ dayCounts, dayOrder, maxCount, formatDayShort }: BookingsByDayChartProps) {
  const width = 400
  const height = 180
  const padding = { top: 12, right: 12, bottom: 28, left: 44 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const barCount = dayOrder.length
  const barWidth = chartWidth / barCount
  const barGap = 4
  const barInnerWidth = Math.max(4, barWidth - barGap)

  const yScale = (count: number) =>
    padding.top + chartHeight - (count / maxCount) * chartHeight

  const yTicks = Array.from({ length: maxCount + 1 }, (_, i) => i)

  const bars = dayOrder.map((day, i) => {
    const count = dayCounts[day] ?? 0
    const x = padding.left + i * barWidth + (barWidth - barInnerWidth) / 2
    const barHeight = maxCount > 0 ? (count / maxCount) * chartHeight : 0
    const y = padding.top + chartHeight - barHeight
    return { day, count, x, y, barWidth: barInnerWidth, barHeight }
  })

  return (
    <div className="w-full overflow-hidden relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[280px] h-[180px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Booking distribution by day of week"
      >
        {/* Y-axis label — rotated, positioned left of chart */}
        <text
          x={12}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          className="fill-gray-500 text-[12px] font-medium"
          transform={`rotate(-90, 12, ${padding.top + chartHeight / 2})`}
        >
          Bookings
        </text>
        {/* Grid lines — chart area only, aligned with y ticks, don't cut through numbers */}
        {yTicks.map((count, i) => (
          <line
            key={i}
            x1={padding.left}
            y1={yScale(count)}
            x2={width - padding.right}
            y2={yScale(count)}
            stroke="#f3f4f6"
            strokeOpacity="1"
          />
        ))}
        {/* Bars */}
        {bars.map((bar, i) => (
          <rect
            key={bar.day}
            x={bar.x}
            y={bar.y}
            width={bar.barWidth}
            height={bar.barHeight}
            rx={2}
            ry={2}
            fill="#111827"
            className="opacity-90"
          />
        ))}
        {/* X axis labels */}
        {bars.map((bar, i) => (
          <text
            key={bar.day}
            x={bar.x + bar.barWidth / 2}
            y={height - 6}
            textAnchor="middle"
            className="fill-gray-500 text-[12px] font-medium"
          >
            {formatDayShort(bar.day)}
          </text>
        ))}
        {/* Y axis labels — positioned left of grid so lines don't cut through */}
        {yTicks.map((count, i) => (
          <text
            key={i}
            x={padding.left - 10}
            y={yScale(count) + 4}
            textAnchor="end"
            className="fill-gray-500 text-[12px] font-medium"
          >
            {count}
          </text>
        ))}
      </svg>
    </div>
  )
}

interface EventByDurationChartProps {
  data: { duration: number; label: string; count: number }[]
}

function EventByDurationChart({ data }: EventByDurationChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const width = 400
  const height = 180
  /** Left inset fits longest duration labels (e.g. “15 minutes”) without overlapping bars or grid. */
  const padding = { top: 12, right: 12, bottom: 28, left: 108 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const barHeight = 20
  const barGap = 8
  const totalBarHeight = barHeight + barGap

  const filteredData = data.filter(d => d.count > 0).sort((a, b) => b.count - a.count)
  const maxCountVal = Math.max(2, ...filteredData.map(d => d.count))
  if (filteredData.length === 0) {
    return (
      <div className="w-full overflow-hidden relative h-[180px] flex items-center justify-center">
        <p className="text-[12px] text-gray-500 font-medium">No duration data yet</p>
      </div>
    )
  }

  const xScale = (count: number) => padding.left + (count / maxCountVal) * chartWidth
  const xTicks = Array.from({ length: maxCountVal + 1 }, (_, i) => i)
  const chartTop = padding.top
  const chartBottom = padding.top + chartHeight


  return (
    <div className="w-full overflow-hidden relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[280px] h-[180px]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Booking distribution by event duration"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* No rotated “Duration” title here — it overlapped long row labels; section header names the chart. */}
        {/* Grid lines — vertical, aligned with count values */}
        {xTicks.map((count, i) => (
          <line
            key={i}
            x1={xScale(count)}
            y1={chartTop}
            x2={xScale(count)}
            y2={chartBottom}
            stroke="#f3f4f6"
            strokeOpacity="1"
          />
        ))}
        {/* X-axis labels — count values at bottom */}
        {xTicks.map((count, i) => (
          <text
            key={i}
            x={xScale(count)}
            y={height - 6}
            textAnchor="middle"
            className="fill-gray-500 text-[12px] font-medium"
          >
            {count}
          </text>
        ))}
        {/* Y-axis labels — duration labels on left */}
        {filteredData.map((d, i) => {
          const y = padding.top + i * totalBarHeight + barGap / 2
          return (
            <text
              key={`label-${d.label}`}
              x={padding.left - 12}
              y={y + barHeight / 2 + 4}
              textAnchor="end"
              className="fill-gray-500 text-[12px] font-medium"
            >
              {d.label}
            </text>
          )
        })}
        {/* Bars */}
        {filteredData.map((d, i) => {
          const y = padding.top + i * totalBarHeight + barGap / 2
          const barWidth = maxCountVal > 0 ? (d.count / maxCountVal) * chartWidth : 0
          const isHovered = hoveredIdx === i
          return (
            <g key={d.label}>
              <rect
                x={padding.left}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={2}
                ry={2}
                fill="#111827"
                className="opacity-90 cursor-pointer"
                style={{ opacity: isHovered ? 0.85 : 0.9 }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseMove={() => setHoveredIdx(i)}
              />
            </g>
          )
        })}
      </svg>
      {/* Hover tooltip — positioned at top like Popular Times, not clipped by overflow */}
      {hoveredIdx !== null && filteredData[hoveredIdx] && (() => {
        const d = filteredData[hoveredIdx]
        const barWidth = maxCountVal > 0 ? (d.count / maxCountVal) * chartWidth : 0
        const barCenterX = padding.left + barWidth / 2
        return (
        <div
          className="absolute top-0 z-20 pointer-events-none px-3 py-2 rounded-lg bg-white border border-gray-200 shadow-md text-left min-w-[120px]"
          style={{
            left: `${(barCenterX / width) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-[12px] font-bold text-[#111827]">
            {d.label}
          </p>
          <p className="text-[11px] text-gray-500 font-medium">
            {d.count} booking{d.count !== 1 ? 's' : ''}
          </p>
        </div>
        )
      })()}
    </div>
  )
}

/**
 * Props for the analytics stat block.
 *
 * @property accent - Optional. Only used when the block needs a semantic color (e.g. red for
 *   canceled). Omitted blocks use default foreground. Both branches handled: accent present
 *   maps to Tailwind class; absent falls back to text-foreground.
 * @property deltaAlwaysRed - When true, the vs-prior delta line (+/- and number) is always red
 *   when there is a change (e.g. cancellations — any move is highlighted as adverse).
 */
interface AnalyticsStatBlockProps {
  title: string
  infoContent: string
  value: number
  priorValue: number
  vsLabel: string
  accent?: 'violet' | 'cyan' | 'emerald' | 'red'
  /** Whole integers (default) or one decimal for averages */
  numberFormat?: 'integer' | 'decimal1'
  deltaAlwaysRed?: boolean
}

function AnalyticsStatBlock({
  title,
  infoContent,
  value,
  priorValue,
  vsLabel,
  accent,
  numberFormat = 'integer',
  deltaAlwaysRed = false,
}: AnalyticsStatBlockProps) {
  const delta = value - priorValue
  const deltaText =
    numberFormat === 'decimal1'
      ? delta > 0
        ? `+${delta.toFixed(1)}`
        : delta < 0
          ? delta.toFixed(1)
          : 'no change'
      : delta > 0
        ? `+${delta} (new)`
        : delta < 0
          ? `${delta}`
          : 'no change'
  const deltaColor =
    delta === 0
      ? 'text-gray-500'
      : deltaAlwaysRed
        ? 'text-red-500'
        : delta > 0
          ? 'text-emerald-500'
          : 'text-red-500'

  const accentMap: Record<string, string> = {
    violet: 'text-violet-500',
    cyan: 'text-cyan-500',
    emerald: 'text-emerald-500',
    red: 'text-red-500',
  }
  const valueColor = accent ? accentMap[accent] ?? 'text-[#111827]' : 'text-[#111827]'

  return (
    <div className="app-card p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-[12px] font-bold text-[#111827] uppercase tracking-wider">{title}</p>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="p-0.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#111827] transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
              aria-label={`Info about ${title}`}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="max-w-[240px] text-[12px] font-medium">
            {infoContent}
          </PopoverContent>
        </Popover>
      </div>
      <p className={`text-2xl font-bold tracking-tight mt-1 ${valueColor}`}>
        {numberFormat === 'decimal1' ? value.toFixed(1) : value}
      </p>
      <p className={`text-[12px] mt-0.5 font-bold ${deltaColor}`}>{deltaText}</p>
      <p className="text-[12px] text-gray-500 font-medium mt-0.5">{vsLabel}</p>
    </div>
  )
}

