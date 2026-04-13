/**
 * PageHeader
 *
 * Shared header row: title + optional actions, user avatar on the right (md+ only;
 * hidden on small screens where DeepSpace mobile chrome already exposes the account).
 */

import { useUser, useUserLookup } from 'deepspace'
import { useProfile } from '../hooks'
import { getBookMeDisplayIdentity } from '../lib/book-me-identity'

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Actions/buttons to show to the left of the user icon */
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const { user } = useUser()
  const { profile } = useProfile()
  const { getUser } = useUserLookup()
  const roomSelf = user?.id ? getUser(user.id) : null
  const { displayName, displayImageUrl } = getBookMeDisplayIdentity({ user, profile, roomSelf })

  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 mb-6">
      <div className="min-w-0">
        {title}
        {subtitle && <div className="mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-4 md:w-auto">
        {actions}
        <div className="hidden h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-300 bg-gray-200 text-xs font-bold md:flex">
          {displayImageUrl ? (
            <img src={displayImageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            displayName.slice(0, 2).toUpperCase()
          )}
        </div>
      </div>
    </header>
  )
}
