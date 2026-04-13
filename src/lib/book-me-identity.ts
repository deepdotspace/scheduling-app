/**
 * Resolves the name and avatar shown in Book Me UI to match DeepSpace profile:
 * room user list (API-enriched), then app `users` record, then `/api/users/me` from useUser.
 */

import type { User, UserInfo } from 'deepspace'
import type { UserProfile } from '../constants'

export function getBookMeDisplayIdentity(input: {
  user: User | null
  profile: UserProfile | null
  /** From useUserLookup().getUser(currentUserId) — includes batch profile image/name */
  roomSelf: UserInfo | null
}): { displayName: string; displayImageUrl: string | undefined } {
  const { user, profile, roomSelf } = input
  const displayImageUrl = roomSelf?.imageUrl ?? profile?.imageUrl ?? user?.imageUrl
  const rawName = roomSelf?.name ?? profile?.name ?? user?.name ?? 'U'
  const displayName = rawName.trim() || 'U'
  return { displayName, displayImageUrl }
}
