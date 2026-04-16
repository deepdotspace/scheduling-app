/**
 * Account menu: avatar trigger opens name, email, and sign-out (or sign-in when logged out).
 */

import { signOut, useUser, useUserLookup } from 'deepspace'
import { useProfile } from '../hooks'
import { getBookMeDisplayIdentity } from '../lib/book-me-identity'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/DropdownMenu'
import { cn } from './ui/utils'

async function bookMeSignOut() {
  await signOut()
  window.location.assign('/')
}

export type UserAccountMenuVariant = 'light' | 'dark'

interface UserAccountMenuProps {
  variant?: UserAccountMenuVariant
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function UserAccountMenu({ variant = 'light', align = 'end', className }: UserAccountMenuProps) {
  const { user, isLoading } = useUser()
  const { profile } = useProfile()
  const { getUser } = useUserLookup()
  const roomSelf = user?.id ? getUser(user.id) : null
  const { displayName, displayImageUrl } = getBookMeDisplayIdentity({ user, profile, roomSelf })
  const displayEmail = (profile?.email ?? user?.email ?? '').trim()

  const isDark = variant === 'dark'

  if (isLoading) {
    return (
      <div
        className={cn(
          'h-8 w-8 shrink-0 animate-pulse rounded-full',
          isDark ? 'bg-white/10' : 'bg-gray-200',
          className,
        )}
        aria-hidden
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="bookme-user-menu-trigger"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2',
            isDark
              ? 'border border-white/15 bg-white/10 text-white hover:bg-white/15 focus-visible:ring-white/40 focus-visible:ring-offset-[#111111]'
              : 'border border-gray-300 bg-gray-200 text-gray-800 hover:ring-2 hover:ring-gray-200 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F4F6]',
            className,
          )}
          title="Account"
        >
          {displayImageUrl ? (
            <img src={displayImageUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            displayName.slice(0, 2).toUpperCase()
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={8}
        className={cn(
          'min-w-[260px] overflow-hidden rounded-xl border p-0 shadow-lg',
          isDark ? 'border-white/10 bg-[#1a1a1a] text-white' : 'border-gray-200 bg-white text-gray-900',
        )}
      >
        {user ? (
          <>
            <div
              className={cn(
                'border-b px-3 py-3',
                isDark ? 'border-white/10' : 'border-gray-100',
              )}
            >
              <p className={cn('truncate text-sm font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
                {displayName}
              </p>
              {displayEmail ? (
                <p className={cn('mt-0.5 truncate text-xs', isDark ? 'text-white/60' : 'text-gray-500')}>
                  {displayEmail}
                </p>
              ) : null}
            </div>
            <div className="p-2">
              <DropdownMenuItem
                data-testid="bookme-user-menu-sign-out"
                className={cn(
                  'cursor-pointer justify-center rounded-lg py-2.5 text-[10px] font-bold uppercase tracking-wide focus:cursor-pointer',
                  isDark
                    ? 'bg-white text-black hover:bg-gray-100 focus:bg-gray-100 focus:text-black'
                    : 'bg-[#111111] text-white hover:bg-black focus:bg-[#111111] focus:text-white',
                )}
                onSelect={(e) => {
                  e.preventDefault()
                  void bookMeSignOut()
                }}
              >
                Sign out
              </DropdownMenuItem>
            </div>
          </>
        ) : (
          <>
            <div className={cn('px-3 py-2.5', isDark ? 'text-white/70' : 'text-gray-500')}>
              <p className="text-xs">Sign in to manage your bookings</p>
            </div>
            <div className="p-2 pt-0">
              <a
                data-testid="bookme-user-menu-sign-in"
                href="/api/auth/social-redirect?provider=google"
                className={cn(
                  'flex w-full items-center justify-center rounded-lg py-2.5 text-center text-[10px] font-bold uppercase tracking-wide transition-colors',
                  isDark ? 'bg-white text-black hover:bg-gray-100' : 'bg-[#111111] text-white hover:bg-black',
                )}
              >
                Sign in with Google
              </a>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
