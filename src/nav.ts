/**
 * Navigation Config
 *
 * Book Me uses a custom sidebar (`book-me-app-shell.tsx`). This file is kept
 * for compatibility with the DeepSpace scaffold and optional top-nav patterns.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
}

export const nav: NavItem[] = [
  { path: '/', label: 'Assistant' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/events', label: 'Event Types' },
  { path: '/meetings', label: 'Meetings' },
  { path: '/availability', label: 'Availability' },
  { path: '/analytics', label: 'Analytics' },
]
