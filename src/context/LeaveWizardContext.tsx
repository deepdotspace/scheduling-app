/**
 * LeaveWizardContext — When the user is creating an event in the Assistant wizard,
 * intercept navigation (sidebar links, etc.) and show a confirmation popup before leaving.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui'

interface LeaveWizardContextValue {
  hasWizardInProgress: boolean
  setHasWizardInProgress: (v: boolean) => void
  /** Call when user attempts to navigate away; shows dialog if wizard in progress */
  requestLeaveNavigation: (targetPath: string) => void
}

const LeaveWizardContext = createContext<LeaveWizardContextValue | null>(null)

export function LeaveWizardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [hasWizardInProgress, setHasWizardInProgress] = useState(false)
  const [pendingLeavePath, setPendingLeavePath] = useState<string | null>(null)

  const requestLeaveNavigation = useCallback(
    (targetPath: string) => {
      const currentPath = location.pathname
      const isSamePage = targetPath === currentPath
      if (!hasWizardInProgress || isSamePage) {
        navigate(targetPath)
        return
      }
      setPendingLeavePath(targetPath)
    },
    [hasWizardInProgress, location.pathname, navigate]
  )

  const confirmLeave = useCallback(() => {
    if (pendingLeavePath) {
      navigate(pendingLeavePath)
      setPendingLeavePath(null)
    }
  }, [pendingLeavePath, navigate])

  const cancelLeave = useCallback(() => {
    setPendingLeavePath(null)
  }, [])

  return (
    <LeaveWizardContext.Provider
      value={{
        hasWizardInProgress,
        setHasWizardInProgress,
        requestLeaveNavigation,
      }}
    >
      {children}
      <ConfirmDialog
        isOpen={pendingLeavePath !== null}
        onClose={cancelLeave}
        onConfirm={confirmLeave}
        title="Leave page?"
        message="Leaving the page would result in losing your current event. Do you still want to proceed?"
        confirmLabel="Continue"
        cancelLabel="Cancel"
        variant="primary"
        modalVariant="light"
      />
    </LeaveWizardContext.Provider>
  )
}

export function useLeaveWizard() {
  const ctx = useContext(LeaveWizardContext)
  if (!ctx) return null
  return ctx
}
