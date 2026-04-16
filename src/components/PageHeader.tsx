/**
 * PageHeader
 *
 * Shared header row: title + optional actions, account menu (avatar) on the right.
 */

import { UserAccountMenu } from './UserAccountMenu'

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Actions/buttons to show to the left of the user icon */
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 mb-6">
      <div className="min-w-0">
        {title}
        {subtitle && <div className="mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-4 md:w-auto">
        {actions}
        <UserAccountMenu variant="light" />
      </div>
    </header>
  )
}
