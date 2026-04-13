/**
 * GuardedLink — Like React Router Link, but when LeaveWizardContext has
 * hasWizardInProgress, intercepts navigation and shows a confirmation popup.
 */

import { Link, useNavigate, type To } from 'react-router-dom'
import { useLeaveWizard } from '../context/LeaveWizardContext'

interface GuardedLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: To
  children?: React.ReactNode
}

export function GuardedLink({ to, onClick, ...rest }: GuardedLinkProps) {
  const navigate = useNavigate()
  const leaveWizard = useLeaveWizard()

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const path =
      typeof to === 'string'
        ? to
        : `${to.pathname ?? '/'}${to.search ?? ''}${to.hash ?? ''}`
    if (leaveWizard) {
      leaveWizard.requestLeaveNavigation(path)
    } else {
      navigate(to)
    }
    onClick?.(e)
  }

  return <Link to={to} onClick={handleClick} {...rest} />
}
