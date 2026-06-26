/**
 * Host Contact Sync
 *
 * Persists the signed-in user's email into the private `host-contacts` collection so server actions
 * (schedule-event) can resolve the host's real email when a guest books — without storing email in
 * the world-readable `users` record. The user writes their OWN row from their session; read access
 * is owner-only, and the DO stamps `userId` (userBound), so no one can write a contact for another
 * user's id.
 *
 * The row uses a server-generated recordId (create) rather than recordId=userId: a predictable,
 * publicly-known recordId could be pre-created ("squatted") by an attacker to lock a host out of
 * writing their own contact. Server reads always query by `userId`, never by recordId.
 */
import { useEffect } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'

interface HostContact {
  userId: string
  email: string
}

export function useHostContactSync(): void {
  const { user } = useUser()
  const { records, status } = useQuery<HostContact>('host-contacts')
  const { create, put } = useMutations<HostContact>('host-contacts')

  useEffect(() => {
    const email = user?.email?.trim()
    // Only act once our own row(s) have loaded — avoids a spurious create before the query resolves.
    if (!user?.id || !email || status !== 'ready') return
    // read: 'own' → useQuery returns only this user's own row(s).
    const mine = records[0]
    if (!mine) {
      void create({ userId: user.id, email }) // userId is stamped server-side; recordId is generated
      return
    }
    if ((mine.data as Partial<HostContact>)?.email !== email) {
      void put(mine.recordId, { email })
    }
  }, [user, status, records, create, put])
}
