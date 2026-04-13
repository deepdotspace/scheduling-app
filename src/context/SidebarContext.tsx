/**
 * SidebarContext - allows child components (e.g. MeetingsPage) to close/collapse the sidebar
 * when showing a detail view that needs more space.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface SidebarContextValue {
  isCollapsed: boolean
  setIsCollapsed: (v: boolean) => void
  mobileMenuOpen: boolean
  setMobileMenuOpen: (v: boolean) => void
  /** Close sidebar (collapse on desktop, close mobile menu) */
  closeSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeSidebar = useCallback(() => {
    setMobileMenuOpen(false)
    setIsCollapsed(true)
  }, [])

  return (
    <SidebarContext.Provider
      value={{
        isCollapsed,
        setIsCollapsed,
        mobileMenuOpen,
        setMobileMenuOpen,
        closeSidebar,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) return null
  return ctx
}
