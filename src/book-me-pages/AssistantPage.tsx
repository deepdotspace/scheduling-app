/**
 * Assistant Page
 *
 * Step-by-step tutorial to help users set up a new event/meeting.
 * Aura-scheduling inspired design with wizard flow.
 */

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLeaveWizard } from '../context/LeaveWizardContext'
import { GuardedLink } from '../components/GuardedLink'
import { useUser, useUserLookup, useUsers } from 'deepspace'
import {
  Home,
  Plus,
  ChevronLeft,
  Clock,
  Video,
  MapPin,
  Smartphone,
  Calendar,
  Mail,
  CheckCircle2,
  Trash2,
  QrCode,
  Link as LinkIcon,
  Copy,
  HelpCircle,
  Globe,
  ListChecks,
  Layers,
  CalendarDays,
  ArrowRight,
  Check,
} from 'lucide-react'
import { useEventTypes, useProfile, useBookings, useIntegrations, useAvailability, showToast } from '../hooks'
import { AvailabilityPreview } from '../components/AvailabilityPreview'
import { ConfirmDialog, Input } from '../components/ui'
import { MEETING_LOCATIONS, BUFFER_OPTIONS, EVENT_COLORS } from '../constants'
import type { MeetingLocation } from '../constants'
import { generateId } from '../constants'
import { isSameDay } from '../components/ui/date-utils'
import { getBookMeDisplayIdentity } from '../lib/book-me-identity'
import { UserAccountMenu } from '../components/UserAccountMenu'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

interface AssistantEventData {
  title: string
  duration: string
  location: MeetingLocation | '' | 'undetermined'
  maxAttendees: number
  isRoundRobin: boolean
  teamMemberIds: string[]
  bufferBefore: string
  bufferAfter: string
  questions: Array< { id: string; text: string; required: boolean }>
  sendGoogleCalendarInvite: boolean
  sendDeepSpaceMail: boolean
  sendEmailConfirmation: boolean
}

const INITIAL_EVENT_DATA: AssistantEventData = {
  title: '',
  duration: '15',
  location: '',
  maxAttendees: 0,
  isRoundRobin: false,
  teamMemberIds: [],
  bufferBefore: '0',
  bufferAfter: '0',
  questions: [],
  sendGoogleCalendarInvite: false,
  sendDeepSpaceMail: false,
  sendEmailConfirmation: false,
}

/** Tracks if we auto-opened Getting Started this session (refresh clears; navigate-back does not). */
let hasAutoOpenedGettingStartedThisSession = false

/**
 * Wizard nav: on small screens, step dots sit on their own row so they do not collide with Back / Next.
 * From `md` up, matches the original single-row layout.
 */
function WizardStepFooter({
  step,
  totalSteps,
  backSlot,
  nextSlot,
}: {
  step: number
  totalSteps: number
  backSlot: ReactNode
  nextSlot: ReactNode
}): ReactElement {
  const showDots = step > 0 && step < totalSteps - 1
  const segmentCount = totalSteps - 2

  return (
    <div className="grid w-full grid-cols-2 items-center gap-x-3 gap-y-2.5 pt-8 md:flex md:flex-row md:items-center md:gap-4 md:gap-y-0">
      <div className="col-start-1 row-start-1 shrink-0 justify-self-start self-center">{backSlot}</div>
      {showDots ? (
        <div
          className="col-span-2 row-start-2 flex max-w-full min-w-0 justify-center gap-1 px-0.5 md:col-span-1 md:row-start-1 md:flex-1 md:justify-center md:gap-2 md:px-0"
          aria-hidden
        >
          {Array.from({ length: segmentCount }, (_, i) => (
            <div
              key={i}
              className={`h-0.5 w-3 shrink-0 rounded-full transition-colors duration-500 md:h-1 md:w-8 ${
                i + 1 <= step
                  ? 'bg-[var(--color-app-sidebar)]'
                  : 'bg-[var(--color-app-border)]'
              }`}
            />
          ))}
        </div>
      ) : null}
      <div className="col-start-2 row-start-1 shrink-0 justify-self-end self-center">{nextSlot}</div>
    </div>
  )
}

export default function AssistantPage() {
  const navigate = useNavigate()
  const { user } = useUser()
  const { users } = useUsers()
  const { getUser } = useUserLookup()
  const { profile } = useProfile()
  const headerIdentity = useMemo(() => {
    const roomSelf = user?.id ? getUser(user.id) : null
    return getBookMeDisplayIdentity({ user, profile, roomSelf })
  }, [user, profile, getUser])
  const { eventTypes, createEventType } = useEventTypes()
  const { upcomingBookings, pastBookings } = useBookings()
  const {
    isCalendarConnected,
    isLoading: integrationsLoading,
    isDisconnecting,
    getCalendarAuthUrl,
    disconnectGoogle,
    refreshStatus,
  } = useIntegrations()
  const { availability, ready: availabilityReady } = useAvailability()

  const [step, setStep] = useState(0)
  const [showGettingStartedPanel, setShowGettingStartedPanel] = useState(false)
  const gettingStartedButtonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [openButtonRect, setOpenButtonRect] = useState<DOMRect | null>(null)
  const [isPanelClosing, setIsPanelClosing] = useState(false)
  const [isPanelOpenAnimated, setIsPanelOpenAnimated] = useState(false)

  const TOTAL_STEPS = 9
  const hasWizardInProgress = step > 0 && step < TOTAL_STEPS - 1
  const leaveWizard = useLeaveWizard()

  useEffect(() => {
    leaveWizard?.setHasWizardInProgress(hasWizardInProgress)
    return () => {
      leaveWizard?.setHasWizardInProgress(false)
    }
  }, [hasWizardInProgress, leaveWizard])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasWizardInProgress) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasWizardInProgress])
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [outgoingStep, setOutgoingStep] = useState<number | null>(null)
  const [transitionDir, setTransitionDir] = useState<'forward' | 'back'>('forward')
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [eventData, setEventData] = useState<AssistantEventData>(INITIAL_EVENT_DATA)
  const [createdEventTypeId, setCreatedEventTypeId] = useState<string | null>(null)

  const userName = headerIdentity.displayName === 'U' ? 'there' : headerIdentity.displayName
  const meetingCount = useMemo(() => {
    const today = new Date()
    return [...upcomingBookings, ...pastBookings].filter(b => {
      if (b.status === 'cancelled') return false
      const d = new Date(b.startTime)
      return isSameDay(d, today)
    }).length
  }, [upcomingBookings, pastBookings])

  const hasCalendar = isCalendarConnected
  const hasEventType = eventTypes.length > 0
  const hasAvailability = availabilityReady
  const completedSteps = [hasCalendar, hasEventType, hasAvailability].filter(Boolean).length
  const allComplete = completedSteps === 3

  /** Getting Started panel — match Dashboard modal step styling */
  const gsStepRow =
    'flex items-start gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100'
  const gsStepCircle =
    'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
  const gsStepTitleBase = 'text-[14px] font-semibold leading-snug'
  const gsStepSubtitle = 'mt-0.5 text-[12px] leading-snug text-gray-500'
  const gsStepActionBtn =
    'mt-0.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed'

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

  const dismissChecklist = useCallback(() => {
    localStorage.setItem('book-me-checklist-dismissed', 'true')
  }, [])

  /** Auto-open only on refresh when steps incomplete; never on navigate-back. */
  useEffect(() => {
    const dismissed = localStorage.getItem('book-me-checklist-dismissed') === 'true'
    if (
      !integrationsLoading &&
      !allComplete &&
      !dismissed &&
      !hasAutoOpenedGettingStartedThisSession
    ) {
      hasAutoOpenedGettingStartedThisSession = true
      const rect = gettingStartedButtonRef.current?.getBoundingClientRect() ?? null
      setOpenButtonRect(rect)
      setShowGettingStartedPanel(true)
    }
  }, [integrationsLoading, allComplete])

  const openGettingStartedPanel = useCallback(() => {
    const rect = gettingStartedButtonRef.current?.getBoundingClientRect() ?? null
    setOpenButtonRect(rect)
    setIsPanelClosing(false)
    setShowGettingStartedPanel(true)
  }, [])

  const closeGettingStartedPanel = useCallback(() => {
    setIsPanelClosing(true)
  }, [])

  const closeHandledRef = useRef(false)
  const handleGettingStartedPanelTransitionEnd = useCallback(() => {
    if (!isPanelClosing || closeHandledRef.current) return
    closeHandledRef.current = true
    setShowGettingStartedPanel(false)
    setIsPanelClosing(false)
    setIsPanelOpenAnimated(false)
    setOpenButtonRect(null)
  }, [isPanelClosing])

  useEffect(() => {
    if (!isPanelClosing) closeHandledRef.current = false
  }, [isPanelClosing])

  /** Trigger open animation after first paint. */
  useEffect(() => {
    if (showGettingStartedPanel && !isPanelClosing) {
      setIsPanelOpenAnimated(false)
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsPanelOpenAnimated(true))
      })
      return () => cancelAnimationFrame(id)
    }
    if (!showGettingStartedPanel) setIsPanelOpenAnimated(false)
  }, [showGettingStartedPanel, isPanelClosing])

  const [panelTransformOrigin, setPanelTransformOrigin] = useState('bottom right')
  useLayoutEffect(() => {
    if (showGettingStartedPanel && panelRef.current && openButtonRect) {
      const panel = panelRef.current.getBoundingClientRect()
      const originX = openButtonRect.left + openButtonRect.width / 2 - panel.left
      const originY = openButtonRect.top + openButtonRect.height / 2 - panel.top
      setPanelTransformOrigin(`${originX}px ${originY}px`)
    } else {
      setPanelTransformOrigin('bottom right')
    }
  }, [showGettingStartedPanel, openButtonRect])

  const handleDisconnect = useCallback(async () => {
    setShowDisconnectConfirm(false)
    const success = await disconnectGoogle()
    if (success) showToast('Google Calendar disconnected.', 'success')
    else showToast('Failed to disconnect. Please try again.', 'error')
  }, [disconnectGoogle])

  const [searchParams, setSearchParams] = useSearchParams()
  const bookingLink = profile?.username ? `${window.location.origin}/book/${profile.username}` : null
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

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshStatus()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshStatus])

  const isTransitioningRef = useRef(false)

  const beginTransition = useCallback((currentStep: number, direction: 'forward' | 'back') => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    isTransitioningRef.current = true
    setOutgoingStep(currentStep)
    setTransitionDir(direction)
    transitionTimerRef.current = setTimeout(() => {
      setOutgoingStep(null)
      isTransitioningRef.current = false
    }, 600)
  }, [])

  const nextStep = useCallback(() => {
    if (isTransitioningRef.current) return
    beginTransition(step, 'forward')
    setStep(s => s + 1)
  }, [step, beginTransition])

  const prevStep = useCallback(() => {
    if (isTransitioningRef.current) return
    beginTransition(step, 'back')
    setStep(s => s - 1)
  }, [step, beginTransition])

  const resetWizard = useCallback(() => {
    if (isTransitioningRef.current) return
    beginTransition(step, 'back')
    setStep(0)
    setEventData(INITIAL_EVENT_DATA)
    setCreatedEventTypeId(null)
  }, [step, beginTransition])

  const addQuestion = useCallback(() => {
    setEventData({
      ...eventData,
      questions: [...eventData.questions, { id: generateId(), text: '', required: false }],
    })
  }, [eventData])

  const updateQuestion = useCallback((id: string, text: string) => {
    setEventData({
      ...eventData,
      questions: eventData.questions.map(q => (q.id === id ? { ...q, text } : q)),
    })
  }, [eventData])

  const toggleRequired = useCallback((id: string) => {
    setEventData({
      ...eventData,
      questions: eventData.questions.map(q => (q.id === id ? { ...q, required: !q.required } : q)),
    })
  }, [eventData])

  const removeQuestion = useCallback((id: string) => {
    setEventData({
      ...eventData,
      questions: eventData.questions.filter(q => q.id !== id),
    })
  }, [eventData])

  const handleCreateEvent = useCallback(() => {
    try {
      const duration = parseInt(eventData.duration, 10) || 30
      const color = EVENT_COLORS[0]

      const created = createEventType({
        title: eventData.title || 'New Meeting',
        description: '',
        duration,
        location: (eventData.location && eventData.location !== 'undetermined' ? eventData.location : 'google-meet') as MeetingLocation,
        isActive: true,
        color,
        sendGoogleCalendarInvite: eventData.sendGoogleCalendarInvite,
        sendDeepSpaceMail: eventData.sendDeepSpaceMail,
        sendExternalEmail: eventData.sendEmailConfirmation,
        bufferBefore: parseInt(eventData.bufferBefore, 10) || 0,
        bufferAfter: parseInt(eventData.bufferAfter, 10) || 0,
        durations: [],
        availabilityScheduleId: '',
        bookingQuestions: eventData.questions
          .filter(q => q.text.trim())
          .map(q => ({
            id: q.id,
            type: 'text' as const,
            label: q.text,
            required: q.required,
          })),
        maxAttendees: eventData.maxAttendees > 1 ? eventData.maxAttendees : 1,
        isRoundRobin: eventData.isRoundRobin,
        teamMemberIds: eventData.teamMemberIds,
      } as Parameters<typeof createEventType>[0])

      setCreatedEventTypeId(created.id)
      showToast('Event created successfully!', 'success')
      nextStep()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create event', 'error')
    }
  }, [eventData, createEventType, nextStep])

  const handleCopyLink = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    showToast('Link copied to clipboard', 'success')
  }, [])

  const steps = [
    {
      id: 'start',
      content: (
        <div className="flex flex-col items-center w-full py-8 relative overflow-hidden">
          <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-2 w-full">
              <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold text-[var(--color-app-text-muted)] bg-[var(--color-app-border)]/50 mb-2">
                BOOK ME
              </span>
              <h1 className="text-5xl font-bold tracking-tight text-[var(--color-app-text)]">
                {getGreeting()}, {userName.split(' ')[0] ?? userName}.
              </h1>
              <p className="text-[var(--color-app-text-muted)] text-base font-medium">
                It&apos;s {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' , year:'numeric'})}. You have {meetingCount} meeting{meetingCount !== 1 ? 's' : ''} today.
              </p>
            </div>

            <div className="w-full max-w-md mx-auto">
              <button
                type="button"
                onClick={nextStep}
                className="w-full relative group bg-white rounded-2xl border border-[var(--color-app-border)] shadow-xl shadow-black/5 py-5 px-5 transition-all hover:border-black hover:shadow-black/10 flex items-center justify-center overflow-hidden"
              >
                <div className="flex items-center justify-center gap-2">
                  <Plus className="w-5 h-5 text-black" />
                  <span className="text-base font-black text-black text-center">
                    Create and setup new event/meeting
                  </span>
                </div>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none">
                  <ArrowRight className="w-5 h-5 text-black" />
                </div>
              </button>

              <div className="mt-10 flex w-full flex-wrap items-center justify-center gap-3 md:flex-nowrap">
                <button
                  type="button"
                  onClick={() => profile?.username && handleCopyLink(`${window.location.origin}/book/${profile.username}`)}
                  className="px-4 py-2 bg-white border border-[var(--color-app-border)] rounded-lg text-[11px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all flex items-center gap-2 shrink-0"
                >
                  <Copy className="w-3 h-3" /> Copy Link
                </button>
                <a
                  href={bookingLink ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white border border-[var(--color-app-border)] rounded-lg text-[11px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all flex items-center gap-2 shrink-0"
                >
                  <Globe className="w-3 h-3" /> Public Page
                </a>
                <button
                  ref={gettingStartedButtonRef}
                  type="button"
                  onClick={openGettingStartedPanel}
                  className="px-4 py-2 bg-white border border-[var(--color-app-border)] rounded-lg text-[11px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all flex items-center gap-2 shrink-0"
                >
                  <ListChecks className="w-3 h-3" /> Getting Started
                </button>
                <Link
                  to="/events"
                  className="px-4 py-2 bg-white border border-[var(--color-app-border)] rounded-lg text-[11px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all flex items-center gap-2 shrink-0"
                >
                  <Layers className="w-3 h-3" /> Event Types
                </Link>
                <Link
                  to="/meetings"
                  className="px-4 py-2 bg-white border border-[var(--color-app-border)] rounded-lg text-[11px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all flex items-center gap-2 shrink-0"
                >
                  <CalendarDays className="w-3 h-3" /> Meetings
                </Link>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'name',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 01
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              What&apos;s the name of your event?
            </h2>
          </div>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Intern-Weekly"
            className="w-full text-3xl font-bold bg-transparent border-b-2 border-[var(--color-app-border)] focus:border-[var(--color-app-sidebar)] outline-none py-4 transition-colors text-[var(--color-app-text)] placeholder:text-[var(--color-app-text-muted)]/30"
            value={eventData.title}
            onChange={e => setEventData({ ...eventData, title: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && eventData.title && nextStep()}
          />
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={resetWizard}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                disabled={!eventData.title}
                onClick={nextStep}
                className={`shrink-0 px-6 py-3 max-md:text-sm rounded-2xl font-bold transition-all md:px-8 md:py-4 ${
                  eventData.title
                    ? 'bg-[var(--color-app-sidebar)] text-white shadow-lg shadow-black/20 hover:scale-105'
                    : 'bg-[var(--color-app-border)] text-[var(--color-app-text-muted)] cursor-not-allowed'
                }`}
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'duration',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 02
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              How long is the meeting?
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: '15', label: '15 Min' },
              { value: '20', label: '20 Min' },
              { value: '30', label: '30 Min' },
              { value: '60', label: '1 hour' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEventData({ ...eventData, duration: value })}
                className={`p-6 rounded-2xl border-2 font-bold text-xl transition-all ${
                  eventData.duration === value
                    ? 'border-[var(--color-app-sidebar)] bg-gray-100 text-[var(--color-app-sidebar)]'
                    : 'bg-white border-[var(--color-app-border)] text-[var(--color-app-text)] hover:border-[var(--color-app-sidebar)]/50'
                }`}
              >
                {label}
              </button>
            ))}
            <div className="col-span-2 relative">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Custom duration..."
                className="w-full p-6 bg-white border-2 border-[var(--color-app-border)] rounded-2xl font-bold text-xl outline-none focus:border-[var(--color-app-sidebar)] transition-all"
                value={['15', '20', '30', '60'].includes(eventData.duration) ? '' : eventData.duration}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '')
                  setEventData({ ...eventData, duration: v })
                }}
              />
              <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-[var(--color-app-text-muted)]">
                Min
              </span>
            </div>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                disabled={!eventData.duration}
                onClick={nextStep}
                className={`shrink-0 px-6 py-3 max-md:text-sm rounded-2xl font-bold transition-all md:px-8 md:py-4 ${
                  eventData.duration
                    ? 'bg-[var(--color-app-sidebar)] text-white shadow-lg shadow-black/20 hover:scale-105'
                    : 'bg-[var(--color-app-border)] text-[var(--color-app-text-muted)] cursor-not-allowed'
                }`}
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'location',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 03
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              Where will it be?
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {MEETING_LOCATIONS.map(loc => {
              const Icon = loc.value === 'deepspace-meets' || loc.value === 'google-meet' || loc.value === 'zoom'
                ? Video
                : loc.value === 'phone'
                  ? Smartphone
                  : MapPin
              return (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => setEventData({ ...eventData, location: loc.value })}
                  className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left ${
                    eventData.location === loc.value
                      ? 'border-[var(--color-app-sidebar)] bg-gray-100'
                      : 'bg-white border-[var(--color-app-border)] hover:border-[var(--color-app-sidebar)]/50'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      eventData.location === loc.value ? 'bg-[var(--color-app-sidebar)] text-white' : 'bg-gray-100 text-[var(--color-app-text-muted)]'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--color-app-text)]">{loc.label}</p>
                  </div>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setEventData({ ...eventData, location: 'undetermined' })}
              className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left ${
                eventData.location === 'undetermined'
                  ? 'border-[var(--color-app-sidebar)] bg-gray-100'
                  : 'bg-white border-[var(--color-app-border)] hover:border-[var(--color-app-sidebar)]/50'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  eventData.location === 'undetermined' ? 'bg-[var(--color-app-sidebar)] text-white' : 'bg-gray-100 text-[var(--color-app-text-muted)]'
                }`}
              >
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-[var(--color-app-text)]">Not determined</p>
                <p className="text-[10px] text-[var(--color-app-text-muted)]">No location yet</p>
              </div>
            </button>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                disabled={!eventData.location}
                onClick={nextStep}
                className={`shrink-0 px-6 py-3 max-md:text-sm rounded-2xl font-bold transition-all md:px-8 md:py-4 ${
                  eventData.location
                    ? 'bg-[var(--color-app-sidebar)] text-white shadow-lg shadow-black/20 hover:scale-105'
                    : 'bg-[var(--color-app-border)] text-[var(--color-app-text-muted)] cursor-not-allowed'
                }`}
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'availability',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 04
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              Your availability
            </h2>
          </div>
          <div className="space-y-4">
            <AvailabilityPreview availability={availability} scheduleName={availability.name} readOnly />
            <p className="text-sm text-[var(--color-app-text-muted)]">
              You can edit your availability in the{' '}
              <GuardedLink to="/availability" className="text-[var(--color-app-sidebar)] font-medium hover:underline">
                Availability
              </GuardedLink>{' '}
              page.
            </p>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                onClick={nextStep}
                className="shrink-0 px-6 py-3 max-md:text-sm rounded-2xl bg-[var(--color-app-sidebar)] text-white font-bold shadow-lg shadow-black/20 hover:scale-105 transition-all md:px-8 md:py-4"
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'settings',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 05
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              Event Settings
            </h2>
          </div>
          <div className="space-y-6">
            <div className="p-6 bg-white border border-[var(--color-app-border)] rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-[var(--color-app-text)]">Group Event</p>
                  <p className="text-[10px] text-[var(--color-app-text-muted)]">
                    Allow multiple people to book the same time slot
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEventData({ ...eventData, maxAttendees: eventData.maxAttendees > 1 ? 0 : 5 })}
                  className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${eventData.maxAttendees > 1 ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${eventData.maxAttendees > 1 ? 'left-7' : 'left-1'}`}
                  />
                </button>
              </div>
              {eventData.maxAttendees > 1 && (
                <div className="flex items-center gap-2 pt-2">
                  <Input
                    label="Max attendees per slot"
                    type="number"
                    value={eventData.maxAttendees}
                    onChange={e => setEventData({ ...eventData, maxAttendees: Math.max(2, parseInt(e.target.value) || 2) })}
                    min={2}
                    className="w-24"
                  />
                </div>
              )}
            </div>
            <div className="p-6 bg-white border border-[var(--color-app-border)] rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-[var(--color-app-text)]">Round Robin</p>
                  <p className="text-[10px] text-[var(--color-app-text-muted)]">
                    Distribute bookings across team members (least-recent-booking first)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEventData({
                      ...eventData,
                      isRoundRobin: !eventData.isRoundRobin,
                      teamMemberIds: !eventData.isRoundRobin ? eventData.teamMemberIds : [],
                    })
                  }
                  className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${eventData.isRoundRobin ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${eventData.isRoundRobin ? 'left-7' : 'left-1'}`}
                  />
                </button>
              </div>
              {eventData.isRoundRobin && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">Team Members</p>
                  {users.length === 0 ? (
                    <p className="text-xs text-[var(--color-app-text-muted)]">No other users in this workspace</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                      {users.map(u => {
                        const isSelected = eventData.teamMemberIds.includes(u.id)
                        return (
                          <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const updated = isSelected
                                  ? eventData.teamMemberIds.filter(id => id !== u.id)
                                  : [...eventData.teamMemberIds, u.id]
                                setEventData({ ...eventData, teamMemberIds: updated })
                              }}
                              className="rounded border-[var(--color-app-border)] bg-white"
                            />
                            <div className="flex items-center gap-2 min-w-0">
                              {u.imageUrl && <img src={u.imageUrl} alt="" className="w-5 h-5 rounded-full shrink-0 object-cover" referrerPolicy="no-referrer" />}
                              <span className="text-sm font-medium text-[var(--color-app-text)] truncate">{u.name}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {eventData.teamMemberIds.length > 0 && (
                    <p className="text-xs text-[var(--color-app-text-muted)]">
                      {eventData.teamMemberIds.length} member{eventData.teamMemberIds.length !== 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">
                  Buffer Before
                </label>
                <select
                  className="w-full p-4 bg-white border border-[var(--color-app-border)] rounded-2xl font-bold outline-none focus:border-[var(--color-app-sidebar)] text-[var(--color-app-text)]"
                  value={eventData.bufferBefore}
                  onChange={e => setEventData({ ...eventData, bufferBefore: e.target.value })}
                >
                  {BUFFER_OPTIONS.map(opt => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">
                  Buffer After
                </label>
                <select
                  className="w-full p-4 bg-white border border-[var(--color-app-border)] rounded-2xl font-bold outline-none focus:border-[var(--color-app-sidebar)] text-[var(--color-app-text)]"
                  value={eventData.bufferAfter}
                  onChange={e => setEventData({ ...eventData, bufferAfter: e.target.value })}
                >
                  {BUFFER_OPTIONS.map(opt => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                onClick={nextStep}
                className="shrink-0 px-6 py-3 max-md:text-sm rounded-2xl bg-[var(--color-app-sidebar)] text-white font-bold shadow-lg shadow-black/20 hover:scale-105 transition-all md:px-8 md:py-4"
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'questions',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 06
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              Booking Questions
            </h2>
          </div>
          <div className="space-y-4">
            {eventData.questions.map((q, i) => (
              <div key={q.id} className="p-6 bg-white border border-[var(--color-app-border)] rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">
                    Question {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.id)}
                    className="text-red-500 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. What is your goal for this meeting?"
                  className="w-full p-3 bg-gray-50 border border-[var(--color-app-border)] rounded-xl font-medium outline-none focus:border-[var(--color-app-sidebar)] text-[var(--color-app-text)]"
                  value={q.text}
                  onChange={e => updateQuestion(q.id, e.target.value)}
                />
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-bold text-[var(--color-app-text)]">Required Question</span>
                  <button
                    type="button"
                    onClick={() => toggleRequired(q.id)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${q.required ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${q.required ? 'left-5.5' : 'left-0.5'}`}
                    />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addQuestion}
              className="w-full p-4 bg-white border-2 border-dashed border-[var(--color-app-border)] rounded-2xl text-[var(--color-app-text-muted)] font-bold hover:border-[var(--color-app-sidebar)] hover:text-[var(--color-app-sidebar)] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Question
            </button>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                onClick={nextStep}
                className="shrink-0 px-6 py-3 max-md:text-sm rounded-2xl bg-[var(--color-app-sidebar)] text-white font-bold shadow-lg shadow-black/20 hover:scale-105 transition-all md:px-8 md:py-4"
              >
                Next
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'notifications',
      content: (
        <div className="space-y-8 w-full max-w-xl py-12">
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--color-app-sidebar)] uppercase tracking-widest">
              Step 07
            </span>
            <h2 className="text-4xl font-black tracking-tight text-[var(--color-app-text)]">
              Notifications
            </h2>
          </div>
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 p-6 bg-white border border-[var(--color-app-border)] rounded-2xl">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-app-text)]">Google Calendar invite</p>
                  <p className="text-[10px] text-[var(--color-app-text-muted)]">
                    Create a Google Calendar event and email an invite to the guest (connect your calendar on the dashboard).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEventData({ ...eventData, sendGoogleCalendarInvite: !eventData.sendGoogleCalendarInvite })
                }
                className={`relative h-6 w-12 shrink-0 rounded-full transition-colors ${eventData.sendGoogleCalendarInvite ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                role="switch"
                aria-checked={eventData.sendGoogleCalendarInvite}
              >
                <span
                  className={`pointer-events-none absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${eventData.sendGoogleCalendarInvite ? 'left-7' : 'left-1'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 p-6 bg-white border border-[var(--color-app-border)] rounded-2xl">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-app-text)]">DeepSpace Mail</p>
                  <p className="text-[10px] text-[var(--color-app-text-muted)]">
                    Notify via DeepSpace Mail when someone books. Signed-in guests also get the confirmation email automatically.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEventData({ ...eventData, sendDeepSpaceMail: !eventData.sendDeepSpaceMail })}
                className={`relative h-6 w-12 shrink-0 rounded-full transition-colors ${eventData.sendDeepSpaceMail ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                role="switch"
                aria-checked={eventData.sendDeepSpaceMail}
              >
                <span
                  className={`pointer-events-none absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${eventData.sendDeepSpaceMail ? 'left-7' : 'left-1'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 p-6 bg-white border border-[var(--color-app-border)] rounded-2xl">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-app-text)]">Email Confirmation</p>
                  <p className="text-[10px] text-[var(--color-app-text-muted)]">
                    Send confirmation email to guests
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEventData({ ...eventData, sendEmailConfirmation: !eventData.sendEmailConfirmation })}
                className={`relative h-6 w-12 shrink-0 rounded-full transition-colors ${eventData.sendEmailConfirmation ? 'bg-[var(--color-app-sidebar)]' : 'bg-[var(--color-app-border)]'}`}
                role="switch"
                aria-checked={eventData.sendEmailConfirmation}
              >
                <span
                  className={`pointer-events-none absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${eventData.sendEmailConfirmation ? 'left-7' : 'left-1'}`}
                />
              </button>
            </div>
          </div>
          <WizardStepFooter
            step={step}
            totalSteps={TOTAL_STEPS}
            backSlot={
              <button
                type="button"
                onClick={prevStep}
                className="shrink-0 text-[var(--color-app-text-muted)] font-bold hover:text-[var(--color-app-text)] transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            }
            nextSlot={
              <button
                type="button"
                onClick={handleCreateEvent}
                className="shrink-0 px-4 py-3 max-md:text-xs rounded-2xl bg-[var(--color-app-sidebar)] text-white font-bold shadow-lg shadow-black/20 hover:scale-105 transition-all md:px-8 md:py-4 md:text-base"
              >
                Create Event
              </button>
            }
          />
        </div>
      ),
    },
    {
      id: 'completed',
      content: (
        <div className="space-y-4 w-full max-w-xl py-12">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-[2.5rem] bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-5xl font-black tracking-tight text-[var(--color-app-text)]">Completed!</h2>
            <div className="space-y-1">
              <p className="text-[var(--color-app-text-muted)] font-medium">
                You can share the link and QR code to setup your meetings.
              </p>
              <p className="text-[var(--color-app-text-muted)] font-medium">
                You can edit this in{' '}
                <Link to="/events" className="text-[var(--color-app-sidebar)] font-medium hover:underline">
                  Event Types
                </Link>{' '}
                to find the certain event.
              </p>
            </div>
          </div>

          <div className="bg-white border border-[var(--color-app-border)] rounded-[2.5rem] p-8 space-y-8 shadow-xl shadow-black/5">
            <div className="flex flex-col items-center gap-6">
              <div className="p-4 bg-white rounded-3xl border border-[var(--color-app-border)]">
                {profile?.username ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                      createdEventTypeId
                        ? `${window.location.origin}/book/${profile.username}/${createdEventTypeId}`
                        : `${window.location.origin}/book/${profile.username}`
                    )}`}
                    alt="Booking QR Code"
                    className="w-32 h-32"
                  />
                ) : (
                  <QrCode className="w-32 h-32 text-[var(--color-app-text)]" />
                )}
              </div>
              <div className="w-full space-y-2">
                <p className="text-center text-[var(--color-app-text-muted)] font-medium">
                  Your Booking Link
                </p>
                <div className="flex items-center gap-2 p-4 bg-gray-50 border border-[var(--color-app-border)] rounded-2xl">
                  <LinkIcon className="w-4 h-4 text-[var(--color-app-text-muted)] shrink-0" />
                  <span className="text-xs font-bold text-[var(--color-app-text)] truncate flex-1">
                    {profile?.username
                      ? createdEventTypeId
                        ? `${window.location.origin}/book/${profile.username}/${createdEventTypeId}`
                        : `${window.location.origin}/book/${profile.username}`
                      : 'book.me/your-username'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!profile?.username) return
                      const url = createdEventTypeId
                        ? `${window.location.origin}/book/${profile.username}/${createdEventTypeId}`
                        : `${window.location.origin}/book/${profile.username}`
                      handleCopyLink(url)
                    }}
                    className="p-2 hover:bg-white rounded-lg transition-colors"
                  >
                    <Copy className="w-4 h-4 text-[var(--color-app-sidebar)]" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!profile?.username) return
                  const url = createdEventTypeId
                    ? `${window.location.origin}/book/${profile.username}/${createdEventTypeId}`
                    : `${window.location.origin}/book/${profile.username}`
                  handleCopyLink(url)
                }}
                className="flex-1 py-4 rounded-2xl bg-white border-2 border-[var(--color-app-border)] font-bold text-[11px] text-[var(--color-app-text)] hover:border-[var(--color-app-sidebar)] transition-all flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" /> Copy Link
              </button>
              <Link
                to="/events"
                className="flex-1 py-4 rounded-2xl bg-white border-2 border-[var(--color-app-border)] font-bold text-[11px] text-[var(--color-app-text)] hover:border-[var(--color-app-sidebar)] transition-all flex items-center justify-center gap-2"
              >
                <Mail className="w-4 h-4" /> Event Types
              </Link>
              <button
                type="button"
                onClick={() => {
                  resetWizard()
                  navigate('/')
                }}
                className="flex-1 py-4 rounded-2xl bg-[var(--color-app-sidebar)] text-white font-bold text-[11px] hover:scale-105 transition-all flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" /> Home
              </button>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <div className="flex-1 bg-[var(--color-app-bg)] relative overflow-hidden flex flex-col min-h-full">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, #E5E7EB 1px, transparent 1px),
            linear-gradient(to bottom, #E5E7EB 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(circle at center, rgba(0,0,0,0.2) 0%, black 35%, black 40%, rgba(0,0,0,0.15) 100%)',
        }}
      />

      {/* Header bar — h-14 aligns with sidebar logo, Back + user icon at top right */}
      <header className="h-14 shrink-0 flex items-center justify-end px-6 gap-3 relative z-20 bg-[var(--color-app-bg)]">
        {step > 0 && step < steps.length - 1 && (
          <button
            type="button"
            onClick={resetWizard}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[var(--color-app-border)] rounded-lg text-[10px] font-bold text-[var(--color-app-text-muted)] hover:bg-gray-50 transition-all"
          >
            <Home className="w-3 h-3" /> Back to Assistant
          </button>
        )}
        <UserAccountMenu variant="light" />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center pb-[10vh] relative z-10">
      <div className="w-full max-w-2xl px-6 min-w-0">
        <div className="relative w-full overflow-hidden">
          {/* Incoming step — in normal flow, its height drives the container from frame 1 */}
          <div
            key={`in-${step}`}
            className={`w-full flex justify-center min-w-0 ${
              outgoingStep === null
                ? step === 0 ? 'wizard-enter-up' : ''
                : step === 0 || outgoingStep === 0
                  ? 'wizard-enter-up'
                  : transitionDir === 'forward'
                    ? 'wizard-enter-from-right'
                    : 'wizard-enter-from-left'
            }`}
          >
            {steps[step].content}
          </div>
          {/* Outgoing step — absolute so it doesn't push the container height */}
          {outgoingStep !== null && (
            <div
              key={`out-${outgoingStep}`}
              className={`absolute top-0 left-0 right-0 flex justify-center bg-[var(--color-app-bg)] pointer-events-none ${
                transitionDir === 'forward' ? 'wizard-exit-to-left' : 'wizard-exit-to-right'
              }`}
            >
              {steps[outgoingStep].content}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Getting Started — floating panel at bottom-right, no overlay */}
      {showGettingStartedPanel &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby="getting-started-title"
            aria-describedby="getting-started-subtitle"
            className="fixed right-4 bottom-4 z-[100] w-full max-w-[420px] max-h-[min(90vh,520px)] flex flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-xl transition-all duration-300 ease-out"
            style={{
              transformOrigin: panelTransformOrigin,
              transform: isPanelClosing || !isPanelOpenAnimated ? 'scale(0.8)' : 'scale(1)',
              opacity: isPanelClosing || !isPanelOpenAnimated ? 0 : 1,
            }}
            onTransitionEnd={handleGettingStartedPanelTransitionEnd}
          >
            <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-start justify-between shrink-0 bg-white">
              <div>
                <h2 id="getting-started-title" className="text-sm font-bold text-[#111827]">
                  Getting Started
                </h2>
                <p id="getting-started-subtitle" className="text-xs text-gray-500 mt-0.5">
                  {completedSteps} of 3 steps complete
                </p>
              </div>
              <button
                type="button"
                onClick={closeGettingStartedPanel}
                className="p-1 hover:bg-gray-100 rounded-md -mr-1 -mt-1 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
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
                          closeGettingStartedPanel()
                          setShowDisconnectConfirm(true)
                        }}
                        disabled={isDisconnecting}
                        className={`${gsStepActionBtn} text-destructive hover:bg-red-50`}
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
                    <Link to="/events" className="shrink-0" onClick={closeGettingStartedPanel}>
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
                  <GuardedLink to="/availability" className="shrink-0" onClick={closeGettingStartedPanel}>
                    <button
                      type="button"
                      className={`${gsStepActionBtn} border border-gray-200 text-[#111827] hover:bg-gray-50`}
                    >
                      Customize
                    </button>
                  </GuardedLink>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-[#E5E7EB] shrink-0 bg-white flex justify-end gap-2">
              {allComplete && (
                <button
                  type="button"
                  onClick={() => {
                    dismissChecklist()
                    closeGettingStartedPanel()
                  }}
                  className="px-3 py-1.5 border border-gray-200 text-[12px] font-bold rounded-lg hover:bg-gray-50 transition-all"
                >
                  Dismiss
                </button>
              )}
              <button
                type="button"
                onClick={closeGettingStartedPanel}
                className="px-3 py-1.5 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-gray-800 transition-all"
              >
                Close
              </button>
            </div>
          </div>,
          document.body
        )}

      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        onClose={() => setShowDisconnectConfirm(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Google Calendar?"
        message="Your bookings will remain, but new events will no longer be created in Google Calendar."
        confirmLabel="Disconnect"
        modalVariant="light"
      />
    </div>
  )
}
