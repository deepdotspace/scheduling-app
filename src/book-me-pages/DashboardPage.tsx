/**
 * Dashboard Page
 *
 * Aura-scheduling inspired overview: bento grid with next meeting, quick stats,
 * upcoming schedule, quick actions, plus calendar, and booking link.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Copy, Globe, Zap, Video, Check, ListChecks, TrendingUp, TrendingDown } from 'lucide-react'
import { useUser, useUserLookup } from 'deepspace'
import { useEventTypes, useBookings, useProfile, useIntegrations, useAvailability, showToast } from '../hooks'
import { getBookMeDisplayIdentity } from '../lib/book-me-identity'
import { ConfirmDialog, Calendar as CalendarComponent, Modal } from '../components/ui'
import { PageHeader } from '../components/PageHeader'
import { ShareModal } from '../components/ShareModal'
import { WeeklyMeetingChart } from '../components/WeeklyMeetingChart'
import { formatTime } from '../constants'
import { isSameDay, isToday, getMondayOf } from '../components/ui/date-utils'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { eventTypes } = useEventTypes()
  const { upcomingBookings, bookedByYou, pastBookings } = useBookings()
  const { user } = useUser()
  const { getUser } = useUserLookup()
  const { profile, updateProfile, getProfileByUsername } = useProfile()
  const dashboardDisplayName = useMemo(() => {
    const roomSelf = user?.id ? getUser(user.id) : null
    return getBookMeDisplayIdentity({ user, profile, roomSelf }).displayName
  }, [user, profile, getUser])
  const { ready: availabilityReady } = useAvailability()
  const {
    isCalendarConnected,
    isLoading: integrationsLoading,
    isDisconnecting,
    getCalendarAuthUrl,
    disconnectGoogle,
    refreshStatus,
  } = useIntegrations()

  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [calendarDate, setCalendarDate] = useState<Date | null>(new Date())
  const [checklistDismissed, setChecklistDismissed] = useState(() => {
    return localStorage.getItem('book-me-checklist-dismissed') === 'true'
  })
  const [showGettingStartedModal, setShowGettingStartedModal] = useState(false)
  const [isEditingSlug, setIsEditingSlug] = useState(false)
  const [editSlugValue, setEditSlugValue] = useState('')
  const [slugError, setSlugError] = useState<string | null>(null)

  const bookingLink = profile?.username ? `${window.location.origin}/book/${profile.username}` : null

  /** Sanitize URL slug: lowercase, alphanumeric + hyphens only */
  const sanitizeSlug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)

  const handleStartEditSlug = () => {
    setEditSlugValue(profile?.username ?? '')
    setSlugError(null)
    setIsEditingSlug(true)
  }

  const handleSaveSlug = () => {
    const sanitized = sanitizeSlug(editSlugValue)
    if (!sanitized) {
      setSlugError('URL slug cannot be empty')
      return
    }
    const existing = getProfileByUsername(sanitized)
    if (existing && existing.id !== profile?.id) {
      setSlugError('This URL slug is already taken')
      showToast('This URL slug is already taken. Please choose a different one.', 'error')
      return
    }
    setSlugError(null)
    updateProfile({ username: sanitized })
    showToast('URL slug updated', 'success')
    setIsEditingSlug(false)
  }

  const handleCancelEditSlug = () => {
    setIsEditingSlug(false)
    setEditSlugValue('')
    setSlugError(null)
  }

  // Copy with feedback
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const dismissChecklist = () => {
    setChecklistDismissed(true)
    localStorage.setItem('book-me-checklist-dismissed', 'true')
  }

  const hasCalendar = isCalendarConnected
  const hasEventType = eventTypes.length > 0
  const hasAvailability = availabilityReady
  const completedSteps = [hasCalendar, hasEventType, hasAvailability].filter(Boolean).length
  const allComplete = completedSteps === 3

  /** Getting Started modal: shared step layout so titles, subtitles, and status circles match. */
  const gsStepRow =
    'flex items-start gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100'
  const gsStepCircle =
    'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
  const gsStepTitleBase = 'text-[14px] font-semibold leading-snug'
  const gsStepSubtitle = 'mt-0.5 text-[12px] leading-snug text-gray-500'
  const gsStepActionBtn =
    'mt-0.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed'

  // Handle OAuth callback
  useEffect(() => {
    const oauthStatus = searchParams.get('oauth')
    const provider = searchParams.get('provider')
    const oauthError = searchParams.get('error')
    if (oauthStatus) {
      setSearchParams({}, { replace: true })
      if (oauthStatus === 'success') {
        showToast(`${provider === 'google' ? 'Google' : 'Integration'} connected successfully!`, 'success')
        refreshStatus()
      } else if (oauthStatus === 'error') {
        showToast(oauthError || 'Failed to connect. Please try again.', 'error')
      }
    }
  }, [searchParams, setSearchParams, refreshStatus])

  // Re-check integration status when returning to tab
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshStatus()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshStatus])

  const handleConnectCalendar = useCallback(async () => {
    setIsConnectingCalendar(true)
    try {
      const authUrl = await getCalendarAuthUrl()
      if (authUrl) window.open(authUrl, '_blank', 'noopener')
      else showToast('Failed to get authorization URL.', 'error')
    } catch (err) {
      showToast(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setIsConnectingCalendar(false)
    }
  }, [getCalendarAuthUrl])

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const handleDisconnect = useCallback(async () => {
    setShowDisconnectConfirm(false)
    const success = await disconnectGoogle()
    if (success) showToast('Google Calendar disconnected.', 'success')
    else showToast('Failed to disconnect. Please try again.', 'error')
  }, [disconnectGoogle])


  /** Group bookings (past + upcoming) by date (for mini calendar day detail) */
  const scheduledGroups = useMemo(() => {
    const allBookings = [...pastBookings, ...upcomingBookings].filter(b => b.status !== 'cancelled')
    const groups: Record<string, typeof upcomingBookings> = {}
    for (const b of allBookings) {
      const d = new Date(b.startTime)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!groups[key]) groups[key] = []
      groups[key].push(b)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    }
    return groups
  }, [pastBookings, upcomingBookings])

  /** Upcoming invitations */
  const upcomingInvitations = useMemo(() => {
    const now = new Date()
    return bookedByYou
      .filter(b => new Date(b.startTime) > now && b.status === 'confirmed')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5)
  }, [bookedByYou])

  /** Dates that have bookings (for mini calendar highlight) — includes past and upcoming */
  const bookedDates = useMemo(() => {
    const all = [...pastBookings, ...upcomingBookings].filter(b => b.status !== 'cancelled')
    return new Set(all.map(b => {
      const d = new Date(b.startTime)
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }))
  }, [pastBookings, upcomingBookings])

  /** All bookings with role for the weekly chart (this week + last week).
   * Last week: meetings that happened (past). This week: meetings scheduled (past + upcoming). */
  const allBookingsWithRole = useMemo(() => {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    twoWeeksAgo.setHours(0, 0, 0, 0)
    const twoWeeksFromNow = new Date()
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14)
    twoWeeksFromNow.setHours(23, 59, 59, 999)
    return [...pastBookings, ...upcomingBookings].filter(b => {
      const s = new Date(b.startTime)
      return s >= twoWeeksAgo && s <= twoWeeksFromNow
    })
  }, [pastBookings, upcomingBookings])

  const hasBookingOnDate = (date: Date) =>
    bookedDates.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`)

  const today = new Date()
  const dateString = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const nextMeeting = upcomingBookings[0]
  const todayMeetingCount = useMemo(() => {
    return [...upcomingBookings, ...pastBookings].filter(b => {
      if (b.status === 'cancelled') return false
      const d = new Date(b.startTime)
      return isSameDay(d, today)
    }).length
  }, [upcomingBookings, pastBookings, today])

  /** Stats comparison: this week vs last week (Mon–Sun), next 7 days vs past 7 days, today vs 30-day avg.
   * Week is fixed Mon–Sun (same definition as WeeklyMeetingChart). */
  const statsData = useMemo(() => {
    const now = new Date()
    // This week: Monday 00:00 through Sunday 23:59 (local time)
    const thisWeekStart = getMondayOf(now)
    thisWeekStart.setHours(0, 0, 0, 0)
    const lastWeekStart = new Date(thisWeekStart)
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)

    /** Count bookings in a full week (Mon–Sun) by calendar day, matching WeeklyMeetingChart logic. */
    const countInWeek = (bookings: Array<{ startTime: string; status?: string }>, weekStart: Date): number => {
      const wy = weekStart.getFullYear()
      const wm = weekStart.getMonth()
      const wd = weekStart.getDate()
      return bookings.filter(b => {
        if (b.status === 'cancelled') return false
        const s = new Date(b.startTime)
        const sy = s.getFullYear()
        const sm = s.getMonth()
        const sd = s.getDate()
        for (let i = 0; i < 7; i++) {
          const dayDate = new Date(wy, wm, wd + i)
          if (sy === dayDate.getFullYear() && sm === dayDate.getMonth() && sd === dayDate.getDate()) return true
        }
        return false
      }).length
    }

    const allRelevant = [...pastBookings, ...upcomingBookings]

    const totalThisWeek = countInWeek(allRelevant, thisWeekStart)
    const totalLastWeek = countInWeek(allRelevant, lastWeekStart)

    const inRange = (b: { startTime: string; status?: string }, start: Date, end: Date) => {
      if (b.status === 'cancelled') return false
      const s = new Date(b.startTime)
      return s >= start && s <= end
    }

    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const sevenDaysAhead = new Date(now)
    sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7)
    sevenDaysAhead.setHours(23, 59, 59, 999)

    const upcomingNext7 = allRelevant.filter(b => inRange(b, now, sevenDaysAhead)).length
    const upcomingPast7 = allRelevant.filter(b => inRange(b, sevenDaysAgo, now)).length

    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const meetingsLast30 = allRelevant.filter(b => inRange(b, thirtyDaysAgo, now)).length
    const avgPerDay = meetingsLast30 / 30

    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr > 0 ? 100 : null
      return Math.round(((curr - prev) / prev) * 100)
    }

    const totalPct = pctChange(totalThisWeek, totalLastWeek)
    const upcomingPct = pctChange(upcomingNext7, upcomingPast7)
    const todayVsAvg = avgPerDay > 0 ? ((todayMeetingCount - avgPerDay) / avgPerDay) * 100 : (todayMeetingCount > 0 ? 100 : 0)

    return {
      totalMeetings: totalThisWeek,
      totalPct,
      upcomingCount: upcomingNext7,
      upcomingPct,
      avgPerDay,
      todayVsAvg,
    }
  }, [pastBookings, upcomingBookings, todayMeetingCount])

  /** Event types now vs how many had been created by the same instant one week ago (createdAt-based). */
  const eventTypesVsWeekAgo = useMemo(() => {
    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoMs = weekAgo.getTime()
    const current = eventTypes.length
    const countAsOfWeekAgo = eventTypes.filter(et => new Date(et.createdAt).getTime() <= weekAgoMs).length
    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr > 0 ? 100 : null
      return Math.round(((curr - prev) / prev) * 100)
    }
    return { current, countAsOfWeekAgo, pct: pctChange(current, countAsOfWeekAgo) }
  }, [eventTypes])

  const stats = useMemo(() => {
    const formatChange = (pct: number | null): { text: string; isUp: boolean; neutral: boolean } => {
      if (pct === null || pct === 0) return { text: '—', isUp: false, neutral: true }
      if (pct > 0) return { text: `${pct}%`, isUp: true, neutral: false }
      return { text: `${Math.abs(pct)}%`, isUp: false, neutral: false }
    }

    const totalChange = formatChange(statsData.totalPct)
    const upcomingChange = formatChange(statsData.upcomingPct)
    const eventTypesChange = formatChange(eventTypesVsWeekAgo.pct)

    let todayChangeText: string
    let todayIsUp: boolean
    let todayNeutral: boolean
    if (statsData.avgPerDay === 0) {
      todayChangeText = todayMeetingCount > 0 ? '100%' : '—'
      todayIsUp = todayMeetingCount > 0
      todayNeutral = todayMeetingCount === 0
    } else {
      const pct = Math.round(statsData.todayVsAvg)
      if (pct > 0) {
        todayChangeText = `${pct}%`
        todayIsUp = true
        todayNeutral = false
      } else if (pct < 0) {
        todayChangeText = `${Math.abs(pct)}%`
        todayIsUp = false
        todayNeutral = false
      } else {
        todayChangeText = '—'
        todayIsUp = false
        todayNeutral = true
      }
    }

    return [
      {
        label: 'Total Meetings',
        value: String(statsData.totalMeetings),
        change: totalChange.text,
        isUp: totalChange.isUp,
        neutral: totalChange.neutral,
        subtext: 'vs last week',
      },
      {
        label: 'Upcoming',
        value: String(statsData.upcomingCount),
        change: upcomingChange.text,
        isUp: upcomingChange.isUp,
        neutral: upcomingChange.neutral,
        subtext: 'vs last week',
      },
      {
        label: 'Event Types',
        value: String(eventTypesVsWeekAgo.current),
        change: eventTypesVsWeekAgo.current > 0 ? eventTypesChange.text : 'Create one',
        isUp: eventTypesVsWeekAgo.current > 0 ? eventTypesChange.isUp : true,
        neutral: eventTypesVsWeekAgo.current === 0 || eventTypesChange.neutral,
        subtext: eventTypesVsWeekAgo.current > 0 ? 'vs a week ago today' : null,
      },
      {
        label: 'Today',
        value: String(todayMeetingCount),
        change: todayChangeText,
        isUp: todayIsUp,
        neutral: todayNeutral,
        subtext: `Avg ${statsData.avgPerDay.toFixed(1)}/day`,
      },
    ]
  }, [statsData, eventTypesVsWeekAgo, todayMeetingCount])

  return (
    <div data-testid="dashboard-page" className="flex-1 flex flex-col min-h-0 bg-[#F3F4F6]">
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="max-w-[1600px] mx-auto px-2">
          <PageHeader
            title={<h2 className="text-3xl font-bold text-[#111827] tracking-tight">{getGreeting()}, {(dashboardDisplayName === 'U' ? 'there' : dashboardDisplayName).split(' ')[0]}.</h2>}
            subtitle={<p className="text-sm text-gray-500 font-medium">It&apos;s {dateString}. You have {todayMeetingCount} meeting{todayMeetingCount !== 1 ? 's' : ''} today.</p>}
          />
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Row 1: Up Next + Calendar (left) | Stats + Activity Map (right) — aligned heights */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            {/* Up Next Meeting */}
            <div className="app-card p-4">
              <h3 className="text-[12px] font-bold text-[#111827] mb-4">Up Next Meeting</h3>
              {nextMeeting ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-indigo-50 rounded flex items-center justify-center">
                      <Video className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold">{nextMeeting.eventTitle || 'Meeting'}</p>
                      <p className="text-[10px] text-gray-400 font-medium uppercase">
                        {new Date(nextMeeting.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {formatTime(nextMeeting.startTime)} – {formatTime(nextMeeting.endTime)}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-gray-100 pt-4">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-400 font-medium">Attendee:</span>
                      <span className="font-bold">{nextMeeting.role === 'host' ? nextMeeting.guestName : nextMeeting.hostName}</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-400 font-medium">Type:</span>
                      <span className="font-bold">
                        {(eventTypes.find(et => et.id === nextMeeting.eventTypeId)?.maxAttendees ?? 0) > 1 ? 'Group' : '1-on-1'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    {nextMeeting.meetingLink && (
                      <a href={nextMeeting.meetingLink} target="_blank" rel="noopener noreferrer" className="flex-[1.2] min-w-0">
                        <button className="w-full py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all">
                          Join Meeting
                        </button>
                      </a>
                    )}
                    <Link to={`/meetings?meeting=${nextMeeting.id}`} className="flex-[0.9] min-w-0">
                      <button className="w-full py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all">
                        Details
                      </button>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-gray-500 mb-4">No meetings scheduled</p>
                  <Link to="/events">
                    <button className="w-full py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all">
                      Create Event Type
                    </button>
                  </Link>
                </>
              )}
            </div>

            {/* Calendar */}
            <div className="app-card overflow-hidden p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-[#111827]">Calendar</h3>
              </div>
                <CalendarComponent
                  selected={calendarDate}
                  onSelect={setCalendarDate}
                  compact
                  className="p-0"
                  renderDay={(date, _defaultEl, context) => {
                    const inMonth = context
                      ? date.getMonth() === context.month && date.getFullYear() === context.year
                      : true
                    if (!inMonth) return <span />

                    const hasBooking = hasBookingOnDate(date)
                    const isSelected = calendarDate ? isSameDay(date, calendarDate) : false
                    const isTodayDate = isToday(date)

                    const btnClass = [
                      'w-7 h-7 rounded-full flex items-center justify-center text-[12px] transition-colors relative',
                      isSelected
                        ? 'bg-black text-white font-semibold'
                        : hasBooking
                          ? 'bg-indigo-50 text-indigo-600 font-semibold hover:bg-indigo-100 cursor-pointer'
                          : 'text-[#111827] hover:bg-gray-50 cursor-pointer',
                    ].join(' ')

                    return (
                      <div className="flex flex-col items-center justify-center">
                        <button
                          type="button"
                          onClick={() => setCalendarDate(date)}
                          className={btnClass}
                        >
                          {date.getDate()}
                          {isTodayDate && (
                            <span
                              className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                                isSelected ? 'bg-white' : 'bg-[#111827]'
                              }`}
                            />
                          )}
                        </button>
                      </div>
                    )
                  }}
                />
                {calendarDate && (() => {
                  const key = calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  const dayBookings = scheduledGroups[key]
                  if (!dayBookings?.length) return null
                  return (
                    <div className="border-t border-gray-200 mt-3 pt-3 px-1 pb-2 space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{key}</p>
                      {dayBookings.map(b => (
                        <div key={b.id} className="flex items-center gap-2 text-xs">
                          <span className="text-gray-500 shrink-0 tabular-nums">{formatTime(b.startTime)}</span>
                          <span className="text-[#111827] font-medium truncate">{b.role === 'host' ? b.guestName : b.hostName}</span>
                          <span className="text-gray-500 shrink-0">· {b.eventTitle.split(' ').slice(0, 3).join(' ')}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
            </div>

            {/* Booking Link — right under calendar */}
            {(bookingLink || profile) && (
              <div className="app-card p-4 flex flex-col min-w-0 overflow-hidden">
                <h3 className="text-[12px] font-bold text-[#111827] mb-4">Booking Link</h3>
                {isEditingSlug ? (
                  <div className="space-y-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                      <span className="text-[12px] text-gray-500 shrink-0">
                        {window.location.origin.replace(/^https?:\/\//, '')}/book/
                      </span>
                      <input
                        type="text"
                        value={editSlugValue}
                        onChange={e => setEditSlugValue(e.target.value)}
                        placeholder="your-username"
                        className="flex-1 min-w-0 px-3 py-2 text-[12px] font-bold border border-gray-200 rounded-lg focus:outline-none focus:border-2 focus:border-black overflow-x-auto"
                        autoFocus
                      />
                    </div>
                    {slugError && (
                      <p className="text-[11px] text-red-600 font-medium">{slugError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveSlug}
                        className="flex-1 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEditSlug}
                        className="flex-1 py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {bookingLink && (
                      <>
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 mb-4">
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            <span className="text-[12px] font-bold truncate break-all">{bookingLink.replace(/^https?:\/\//, '')}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <button
                            onClick={() => { setShareUrl(bookingLink); setShowShareModal(true) }}
                            className="flex-1 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all"
                          >
                            Share
                          </button>
                          <a href={bookingLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                            <button className="w-full py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all">
                              View
                            </button>
                          </a>
                          <button
                            onClick={() => handleCopy(bookingLink, 'booking-link-sidebar')}
                            className="px-3 py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all shrink-0"
                            title="Copy link"
                          >
                            {copiedId === 'booking-link-sidebar' ? (
                              <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </>
                    )}
                    <button
                      onClick={handleStartEditSlug}
                      className="w-full py-2 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all"
                    >
                      {bookingLink ? 'Edit URL Slug' : 'Set URL Slug'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Column — Stats + Activity Map (fills to match Calendar bottom) */}
          <div className="lg:col-span-9 flex flex-col gap-4 min-h-0">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
              {stats.map((stat, i) => (
                <div key={i} className="app-card p-4">
                  <p className="text-[12px] font-bold text-black uppercase tracking-wider mb-2">{stat.label}</p>
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                    <span className="text-2xl font-bold tracking-tight shrink-0">{stat.value}</span>
                    <div className="flex flex-col items-end min-w-0 ml-auto">
                      <span
                        className={`flex items-center gap-1 whitespace-nowrap text-[12px] font-bold ${
                          stat.neutral
                            ? 'text-gray-500'
                            : stat.isUp
                              ? 'text-emerald-600'
                              : 'text-red-600'
                        }`}
                      >
                        {!stat.neutral && (
                          stat.isUp ? <TrendingUp className="w-3.5 h-3.5 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                        )}
                        {stat.change}
                      </span>
                      {stat.subtext && (
                        <p className="text-[11px] text-gray-500 font-medium mt-0.5 text-right break-words max-w-full">{stat.subtext}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Weekly Meeting Chart — natural height, no stretching */}
            <WeeklyMeetingChart
              allBookings={allBookingsWithRole}
            />

            {/* Upcoming Schedule — right under chart */}
            <div className="app-card overflow-hidden flex flex-col shrink-0">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-[12px] font-bold text-[#111827]">Upcoming Schedule</h3>
                <Link to="/meetings" className="text-[12px] font-bold text-indigo-600 hover:underline uppercase tracking-wider">View All</Link>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                {upcomingBookings.length > 0 ? (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <th className="px-4 py-3">Meeting Title</th>
                        <th className="px-4 py-3">Attendee</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {upcomingBookings.slice(0, 4).map((booking) => {
                        const d = new Date(booking.startTime)
                        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        return (
                          <tr key={booking.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-3 text-[12px] font-bold">{booking.eventTitle}</td>
                            <td className="px-4 py-3 text-[12px] font-medium text-gray-500">{booking.role === 'host' ? booking.guestName : booking.hostName}</td>
                            <td className="px-4 py-3 text-[12px] font-medium text-gray-500">{dateStr}</td>
                            <td className="px-4 py-3 text-[12px] font-bold">{formatTime(booking.startTime)}</td>
                            <td className="px-4 py-3">
                              <Link to={`/meetings?meeting=${booking.id}`} className="text-[10px] font-bold text-indigo-600 hover:underline uppercase tracking-wider">Details</Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">No upcoming meetings.</div>
                )}
              </div>
            </div>

            {/* Event Invitations — same table layout as Upcoming Schedule, directly below */}
            <div className="app-card overflow-hidden flex flex-col shrink-0">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-[12px] font-bold text-[#111827]">Event Invitations</h3>
                <Link to="/meetings" className="text-[12px] font-bold text-indigo-600 hover:underline uppercase tracking-wider">
                  View All
                </Link>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                {upcomingInvitations.length > 0 ? (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <th className="px-4 py-3">Meeting Title</th>
                        <th className="px-4 py-3">Attendee</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {upcomingInvitations.slice(0, 4).map(booking => {
                        const d = new Date(booking.startTime)
                        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        return (
                          <tr key={booking.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-3 text-[12px] font-bold">{booking.eventTitle}</td>
                            <td className="px-4 py-3 text-[12px] font-medium text-gray-500">
                              {booking.role === 'host' ? booking.guestName : booking.hostName}
                            </td>
                            <td className="px-4 py-3 text-[12px] font-medium text-gray-500">{dateStr}</td>
                            <td className="px-4 py-3 text-[12px] font-bold">{formatTime(booking.startTime)}</td>
                            <td className="px-4 py-3">
                              <Link
                                to={`/meetings?meeting=${booking.id}`}
                                className="text-[10px] font-bold text-indigo-600 hover:underline uppercase tracking-wider"
                              >
                                Details
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">No pending invitations.</div>
                )}
              </div>
            </div>

            {/* Quick Actions — compact, under Event Invitations */}
            <div className="app-card p-3 shrink-0">
              <h3 className="text-[12px] font-bold text-[#111827] mb-2">Quick Actions</h3>
              <div className="flex flex-wrap gap-2">
                <Link to="/events" className="flex-1 min-w-[5.5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-black hover:bg-white transition-all group">
                  <Plus className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-black" />
                  <span className="text-xs font-bold text-[#111827] truncate">New Event</span>
                </Link>
                <button
                  onClick={() => bookingLink && handleCopy(bookingLink, 'quick-copy')}
                  className="flex-1 min-w-[5.5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-black hover:bg-white transition-all group"
                >
                  {copiedId === 'quick-copy' ? (
                    <>
                      <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                      <span className="text-xs font-bold text-emerald-600 truncate">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-black" />
                      <span className="text-xs font-bold text-[#111827] truncate">Copy Link</span>
                    </>
                  )}
                </button>
                <a href={bookingLink ?? '#'} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[5.5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-black hover:bg-white transition-all group">
                  <Globe className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-black" />
                  <span className="text-xs font-bold text-[#111827] truncate">Public Page</span>
                </a>
                <Link to="/analytics" className="flex-1 min-w-[5.5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-black hover:bg-white transition-all group">
                  <Zap className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-black" />
                  <span className="text-xs font-bold text-[#111827] truncate">Analytics</span>
                </Link>
                <button
                  onClick={() => setShowGettingStartedModal(true)}
                  className="flex-1 min-w-[5.5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-black hover:bg-white transition-all group"
                >
                  <ListChecks className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-black" />
                  <span className="text-xs font-bold text-[#111827] truncate">Getting Started</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Getting Started Modal — centered popup */}
      <Modal
        isOpen={showGettingStartedModal}
        onClose={() => setShowGettingStartedModal(false)}
        title="Getting Started"
        subtitle={`${completedSteps} of 3 steps complete`}
        maxWidth="max-w-lg"
        variant="light"
        headerClassName="px-6 py-4 border-b border-[#E5E7EB] flex items-start justify-between shrink-0 bg-white"
        footerClassName="px-6 py-4 border-t border-[#E5E7EB] shrink-0 bg-white"
        footer={
          <div className="flex justify-end gap-2">
            {allComplete && (
              <button
                type="button"
                onClick={() => {
                  dismissChecklist()
                  setShowGettingStartedModal(false)
                }}
                className="px-3 py-1.5 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all"
              >
                Dismiss
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowGettingStartedModal(false)}
              className="px-3 py-1.5 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all"
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 bg-[#111827]"
              style={{ width: `${(completedSteps / 3) * 100}%` }}
            />
          </div>

          <div className="space-y-3">
            <div className={gsStepRow}>
              <div
                className={`${gsStepCircle} ${hasCalendar ? 'bg-emerald-50' : 'bg-gray-200'}`}
                aria-hidden
              >
                {hasCalendar ? (
                  <Check className="h-5 w-5 text-emerald-600" strokeWidth={2.5} />
                ) : (
                  <span className="box-border h-4 w-4 shrink-0 rounded-full border-2 border-gray-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`${gsStepTitleBase} ${hasCalendar ? 'text-gray-500 line-through' : 'text-[#111827]'}`}
                >
                  Connect Google Calendar
                </p>
                <p className={gsStepSubtitle}>
                  {hasCalendar ? 'Auto-creates events with Google Meet links' : 'Sync bookings and generate Meet links'}
                </p>
              </div>
              {!integrationsLoading && (
                hasCalendar ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowGettingStartedModal(false)
                      setShowDisconnectConfirm(true)
                    }}
                    disabled={isDisconnecting}
                    className={`${gsStepActionBtn} text-destructive hover:bg-red-50 disabled:opacity-50`}
                  >
                    {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectCalendar}
                    disabled={isConnectingCalendar}
                    className={`${gsStepActionBtn} bg-black text-white hover:bg-gray-800`}
                  >
                    {isConnectingCalendar ? 'Connecting...' : 'Connect'}
                  </button>
                )
              )}
            </div>

            <div className={gsStepRow}>
              <div
                className={`${gsStepCircle} ${hasEventType ? 'bg-emerald-50' : 'bg-gray-200'}`}
                aria-hidden
              >
                {hasEventType ? (
                  <Check className="h-5 w-5 text-emerald-600" strokeWidth={2.5} />
                ) : (
                  <span className="box-border h-4 w-4 shrink-0 rounded-full border-2 border-gray-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`${gsStepTitleBase} ${hasEventType ? 'text-gray-500 line-through' : 'text-[#111827]'}`}
                >
                  Create an event type
                </p>
                <p className={gsStepSubtitle}>
                  {hasEventType ? `${eventTypes.length} event type${eventTypes.length > 1 ? 's' : ''} created` : 'Define meeting templates others can book'}
                </p>
              </div>
              {!hasEventType && (
                <Link to="/events" className="shrink-0" onClick={() => setShowGettingStartedModal(false)}>
                  <button type="button" className={`${gsStepActionBtn} bg-black text-white hover:bg-gray-800`}>
                    Create
                  </button>
                </Link>
              )}
            </div>

            <div className={gsStepRow}>
              <div
                className={`${gsStepCircle} ${hasAvailability ? 'bg-emerald-50' : 'bg-gray-200'}`}
                aria-hidden
              >
                {hasAvailability ? (
                  <Check className="h-5 w-5 text-emerald-600" strokeWidth={2.5} />
                ) : (
                  <span className="box-border h-4 w-4 shrink-0 rounded-full border-2 border-gray-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`${gsStepTitleBase} ${hasAvailability ? 'text-gray-500 line-through' : 'text-[#111827]'}`}
                >
                  Set your availability
                </p>
                <p className={gsStepSubtitle}>
                  {hasAvailability ? 'Mon–Fri availability configured' : "Define when you're available for meetings"}
                </p>
              </div>
              <Link to="/availability" className="shrink-0" onClick={() => setShowGettingStartedModal(false)}>
                <button
                  type="button"
                  className={`${gsStepActionBtn} border border-gray-200 text-[#111827] hover:bg-gray-50`}
                >
                  Customize
                </button>
              </Link>
            </div>
          </div>
        </div>
      </Modal>

      {/* Share Modal */}
      {shareUrl && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => { setShowShareModal(false); setShareUrl(null) }}
          url={shareUrl}
        />
      )}

      {/* Disconnect Confirmation */}
      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        onClose={() => setShowDisconnectConfirm(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Google Calendar"
        message="Are you sure you want to disconnect Google Calendar? Bookings will no longer sync."
        confirmLabel="Disconnect"
        variant="danger"
        isLoading={isDisconnecting}
      />
    </div>
  )
}
