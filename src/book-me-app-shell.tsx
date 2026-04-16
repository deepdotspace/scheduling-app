/**
 * BookMe shell — sidebar layout + full-bleed routes (from legacy App.tsx).
 */

import { useEffect, useMemo, useState, type ReactNode, Suspense } from 'react'
import { useLocation, Link, Outlet } from 'react-router-dom'
import { CalendarCheck, Video, LayoutDashboard, Sparkles, Clock } from 'lucide-react'
import { LeaveWizardProvider } from './context/LeaveWizardContext'
import { GuardedLink } from './components/GuardedLink'
import { useUser } from 'deepspace'
import { BookMePlatformProvider } from './platform/BookMePlatformProvider'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import { useProfile, useBookings } from './hooks'
import { formatTime } from './constants'
import { ToastContainer } from './components/ui/ToastContainer'
import { UserAccountMenu } from './components/UserAccountMenu'

const LayersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
)

const CalendarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const BarChart3Icon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
)

const SidebarToggleIcon = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
    <line x1="8" y1="3" x2="8" y2="21" />
  </svg>
)

function Sidebar() {
  const location = useLocation()
  const sidebar = useSidebar()
  const mobileMenuOpen = sidebar?.mobileMenuOpen ?? false
  const setMobileMenuOpen = sidebar?.setMobileMenuOpen ?? (() => {})
  const isCollapsed = sidebar?.isCollapsed ?? false
  const setIsCollapsed = sidebar?.setIsCollapsed ?? (() => {})
  const { upcomingBookings } = useBookings()

  const [nextMeetingListHidden, setNextMeetingListHidden] = useState(false)

  const nextMeetingsThisWeek = useMemo(() => {
    const now = new Date()
    const endOfWeek = new Date(now)
    endOfWeek.setDate(endOfWeek.getDate() + 7)
    return upcomingBookings
      .filter(b => b.status !== 'cancelled')
      .filter(b => {
        const start = new Date(b.startTime)
        return start >= now && start <= endOfWeek
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5)
  }, [upcomingBookings])

  const navItems = [
    { path: '/', icon: Sparkles, label: 'Assistant' },
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/events', icon: LayersIcon, label: 'Event Types' },
    { path: '/meetings', icon: CalendarIcon, label: 'Meetings' },
    { path: '/availability', icon: Clock, label: 'Availability' },
    { path: '/analytics', icon: BarChart3Icon, label: 'Analytics' },
  ]

  const effectivelyCollapsed = isCollapsed && !mobileMenuOpen

  return (
    <>
      <div className="lg:hidden flex items-center justify-between h-14 px-3 border-b border-white/5 bg-[#111111] shrink-0 gap-2">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
            <CalendarCheck className="w-5 h-5 text-black" strokeWidth={2} />
          </div>
          <span className="text-lg font-black text-white tracking-tight italic truncate">Book Me</span>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <UserAccountMenu variant="dark" />
          <button
            type="button"
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
          {mobileMenuOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
          </button>
        </div>
      </div>

      <aside
        className={[
          'bg-[#111111] flex-col z-50',
          mobileMenuOpen
            ? 'flex fixed w-full max-lg:left-0 max-lg:right-0 max-lg:bottom-0 max-lg:top-[var(--mobile-header-height,0px)] max-lg:min-h-0 lg:inset-0 lg:h-full'
            : 'hidden lg:flex',
          'lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-white/5 lg:transition-[width] lg:duration-300',
          effectivelyCollapsed ? 'lg:w-[52px]' : 'lg:w-52',
        ].join(' ')}
      >
        <div className="flex items-center h-14 shrink-0">
          <div className="w-[52px] h-full flex items-center justify-center shrink-0">
            {effectivelyCollapsed ? (
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className="group relative items-center justify-center w-8 h-8 hidden lg:flex"
                title="Open sidebar"
              >
                <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover:opacity-0">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                    <CalendarCheck className="w-[18px] h-[18px] text-black" strokeWidth={2} />
                  </div>
                </span>
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-white/60">
                  <SidebarToggleIcon />
                </span>
              </button>
            ) : (
              <Link to="/" className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                <CalendarCheck className="w-[18px] h-[18px] text-black" strokeWidth={2} />
              </Link>
            )}
          </div>

          <div className={`flex-1 flex items-center justify-between pr-2 overflow-hidden whitespace-nowrap transition-opacity duration-200 ${effectivelyCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <h1 className="text-base font-black text-white tracking-tight italic">Book Me</h1>
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="shrink-0 hidden lg:flex items-center justify-center w-7 h-7 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Collapse sidebar"
            >
              <SidebarToggleIcon />
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="shrink-0 flex lg:hidden items-center justify-center w-7 h-7 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Close menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 pt-2 overflow-y-auto scrollbar-hide">
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive =
                location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
              const Icon = item.icon
              return (
                <GuardedLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  title={effectivelyCollapsed ? item.label : ''}
                  className={`flex items-center rounded-lg transition-colors duration-150 ${
                    mobileMenuOpen ? 'mx-4 py-1' : 'mx-2'
                  } ${
                    isActive
                      ? 'bg-white text-black shadow-sm'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`flex items-center justify-center shrink-0 ${mobileMenuOpen ? 'w-[48px] h-[52px]' : 'w-[36px] h-[38px]'}`}>
                    <Icon className={mobileMenuOpen ? 'w-5 h-5' : 'w-4 h-4'} strokeWidth={2} />
                  </span>
                  <span
                    className={`overflow-hidden whitespace-nowrap font-bold uppercase tracking-wider pr-2 transition-opacity duration-200 ${
                      mobileMenuOpen ? 'text-sm opacity-100' : `text-[11px] ${effectivelyCollapsed ? 'opacity-0' : 'opacity-100'}`
                    }`}
                  >
                    {item.label}
                  </span>
                </GuardedLink>
              )
            })}
          </div>

          {!effectivelyCollapsed && nextMeetingsThisWeek.length > 0 && (
            <div className="pt-4">
              <div
                className="group flex items-center justify-between px-4 mb-4 cursor-default"
                role="button"
                tabIndex={0}
                onClick={() => setNextMeetingListHidden(prev => !prev)}
                onKeyDown={(e) => e.key === 'Enter' && setNextMeetingListHidden(prev => !prev)}
              >
                <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">
                  Next Meeting{nextMeetingsThisWeek.length > 1 ? 's' : ''}
                </p>
                <button
                  type="button"
                  className="text-[9px] font-bold text-white/60 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity hover:text-white shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setNextMeetingListHidden(prev => !prev)
                  }}
                >
                  {nextMeetingListHidden ? 'Show' : 'Hide'}
                </button>
              </div>
              {!nextMeetingListHidden && (
                <div className="space-y-1">
                  {nextMeetingsThisWeek.map((meeting) => (
                    <div
                      key={meeting.id}
                      className="mx-2 flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg text-white/60 hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Video className="w-4 h-4 shrink-0 text-white/60" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-white truncate leading-tight">
                            {meeting.eventTitle || 'Meeting'}
                          </p>
                          <p className="text-[8px] text-white/40 font-bold uppercase tracking-widest">
                            {new Date(meeting.startTime).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            · {formatTime(meeting.startTime)}
                          </p>
                        </div>
                      </div>
                      {meeting.meetingLink ? (
                        <a
                          href={meeting.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-white text-black text-[8px] font-bold rounded uppercase tracking-tighter hover:bg-gray-200 transition-all shrink-0"
                        >
                          Join
                        </a>
                      ) : (
                        <GuardedLink
                          to={`/meetings?meeting=${meeting.id}`}
                          onClick={() => setMobileMenuOpen(false)}
                          className="px-2 py-1 bg-white/20 text-white text-[8px] font-bold rounded uppercase tracking-tighter hover:bg-white/30 transition-all shrink-0"
                        >
                          Details
                        </GuardedLink>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
      </aside>
    </>
  )
}

function BookMeInner({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser()
  const { profile, updateProfile, ready } = useProfile()

  useEffect(() => {
    if (user && (!profile || !profile.username) && ready) {
      updateProfile({})
    }
  }, [user, profile, ready, updateProfile])

  const location = useLocation()
  const isFullScreenFlow =
    location.pathname.startsWith('/book/') ||
    location.pathname.startsWith('/manage/') ||
    location.pathname.startsWith('/meetings/reschedule/')
  const isEventsOrMeetings = location.pathname === '/events' || location.pathname === '/meetings'

  if (isLoading || !ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (isFullScreenFlow) {
    return (
      <div
        data-testid="app-root"
        className="min-h-screen overflow-auto bg-background custom-scrollbar max-lg:pt-[var(--mobile-header-height,0px)]"
      >
        {user && (
          <div className="fixed top-3 right-3 z-[100001]" data-testid="bookme-fullscreen-account-pill">
            <UserAccountMenu variant="light" />
          </div>
        )}
        {children}
        <ToastContainer />
      </div>
    )
  }

  return (
    <SidebarProvider>
      <LeaveWizardProvider>
        <div
          data-testid="app-root"
          className="flex min-h-screen flex-col bg-[#F3F4F6] text-foreground max-lg:pt-[var(--mobile-header-height,0px)] lg:flex-row"
        >
          <Sidebar />
          <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
            <div
              className={`flex-1 min-h-0 ${isEventsOrMeetings ? 'overflow-hidden' : 'overflow-auto'} bg-[#F3F4F6] custom-scrollbar`}
            >
              <div
                key={location.pathname}
                className={`page-enter h-full min-h-0 ${isEventsOrMeetings ? 'flex flex-col' : ''}`}
              >
                {children}
              </div>
            </div>
          </main>
          <ToastContainer />
        </div>
      </LeaveWizardProvider>
    </SidebarProvider>
  )
}

export function BookMeAppShell() {
  return (
    <BookMePlatformProvider>
      <BookMeInner>
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-muted-foreground">Loading...</div>}>
          <Outlet />
        </Suspense>
      </BookMeInner>
    </BookMePlatformProvider>
  )
}
