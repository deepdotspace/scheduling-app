/**
 * User Profile Hook
 *
 * Manages user profile for public booking page and integration status.
 * Uses useQuery/useMutations (RecordRoom) pattern.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import type { UserProfile } from '../constants'

interface UseProfileReturn {
  profile: UserProfile | null
  profiles: Record<string, UserProfile>
  updateProfile: (updates: Partial<UserProfile>) => void
  getProfileByUsername: (username: string) => UserProfile | undefined
  setCalendarConnected: (connected: boolean) => void
  ready: boolean
}

export function useProfile(): UseProfileReturn {
  const { user, isLoading } = useUser()
  const { records, status } = useQuery<UserProfile>('users')
  const { put } = useMutations<Partial<UserProfile>>('users')

  // Build profiles map from records
  const profiles = useMemo((): Record<string, UserProfile> => {
    const result: Record<string, UserProfile> = {}
    for (const rec of records) {
      const data = rec.data as any
      if (data && rec.recordId) {
        result[rec.recordId] = {
          id: rec.recordId,
          name: data.name ?? '',
          email: data.email ?? '',
          imageUrl: data.imageUrl,
          username: data.username ?? '',
          bio: data.bio ?? '',
          calendarConnected: data.calendarConnected ?? false,
          emailConnected: data.emailConnected ?? false,
          branding: data.branding ?? undefined,
        }
      }
    }
    return result
  }, [records])

  // Current user's profile
  const profile = user?.id ? profiles[user.id] ?? null : null

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    if (!user?.id) return

    const existing = profiles[user.id]
    const updated: Record<string, unknown> = {
      name: updates.name ?? existing?.name ?? user.name,
      email: updates.email ?? existing?.email ?? user.email ?? '',
      imageUrl: updates.imageUrl ?? existing?.imageUrl ?? user.imageUrl,
      username: updates.username || existing?.username || generateUniqueUsername(user.name, user.id, profiles),
      bio: updates.bio ?? existing?.bio ?? '',
      calendarConnected: updates.calendarConnected ?? existing?.calendarConnected ?? false,
      emailConnected: updates.emailConnected ?? existing?.emailConnected ?? false,
    }
    if (updates.branding !== undefined) {
      updated.branding = updates.branding
    } else if (existing?.branding) {
      updated.branding = existing.branding
    }

    // User records use the userId as the record ID
    put(user.id, updated)
  }, [user, profiles, put])

  const getProfileByUsername = useCallback((username: string): UserProfile | undefined => {
    return Object.values(profiles).find(p => p.username === username)
  }, [profiles])

  const setCalendarConnected = useCallback((connected: boolean) => {
    updateProfile({ calendarConnected: connected })
  }, [updateProfile])

  return {
    profile,
    profiles,
    updateProfile,
    getProfileByUsername,
    setCalendarConnected,
    ready: !isLoading && status !== 'loading',
  }
}

/**
 * Generate a URL-safe username from user name.
 * Appends -2, -3, etc. when the base slug is already taken by another user.
 */
function generateUniqueUsername(
  name: string,
  userId: string,
  profiles: Record<string, UserProfile>
): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || userId.slice(0, 8)

  const isTakenByOther = (candidate: string): boolean => {
    const existing = Object.values(profiles).find(p => p.username === candidate)
    return !!existing && existing.id !== userId
  }

  if (!isTakenByOther(base)) return base

  for (let n = 2; n <= 9999; n++) {
    const candidate = `${base}-${n}`
    if (!isTakenByOther(candidate)) return candidate
  }

  return `${base}-${userId.slice(0, 6)}`
}
