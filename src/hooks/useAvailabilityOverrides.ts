/**
 * useAvailabilityOverrides — Manages date-specific availability overrides.
 *
 * Overrides let users block specific dates or set custom hours for a date.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import type { AvailabilityOverride } from '../constants'

interface UseAvailabilityOverridesReturn {
  overrides: AvailabilityOverride[]
  addOverride: (override: Omit<AvailabilityOverride, 'id' | 'userId'>) => void
  removeOverride: (id: string) => void
  getOverrideForDate: (date: string) => AvailabilityOverride | undefined
  ready: boolean
}

export function useAvailabilityOverrides(forUserId?: string): UseAvailabilityOverridesReturn {
  const { user } = useUser()
  const targetUserId = forUserId ?? user?.id
  const isOwner = user?.id === targetUserId

  const queryOptions = useMemo(() => {
    if (!targetUserId) return { where: { userId: '__none__' } }
    return { where: { userId: targetUserId } }
  }, [targetUserId])

  const { records, status } = useQuery<any>('availability-overrides', queryOptions)
  const { create, remove } = useMutations<any>('availability-overrides')

  const overrides = useMemo((): AvailabilityOverride[] => {
    return records.map(rec => {
      const data = rec.data as any
      return {
        id: rec.recordId,
        userId: data.userId ?? targetUserId ?? '',
        date: data.date ?? '',
        type: data.type ?? 'blocked',
        startTime: data.startTime,
        endTime: data.endTime,
      }
    }).sort((a, b) => a.date.localeCompare(b.date))
  }, [records, targetUserId])

  const addOverride = useCallback((override: Omit<AvailabilityOverride, 'id' | 'userId'>) => {
    if (!isOwner || !targetUserId) return
    create({
      userId: targetUserId,
      date: override.date,
      type: override.type,
      startTime: override.startTime ?? '',
      endTime: override.endTime ?? '',
    })
  }, [isOwner, targetUserId, create])

  const removeOverride = useCallback((id: string) => {
    if (!isOwner) return
    remove(id)
  }, [isOwner, remove])

  const getOverrideForDate = useCallback((date: string) => {
    return overrides.find(o => o.date === date)
  }, [overrides])

  return {
    overrides,
    addOverride,
    removeOverride,
    getOverrideForDate,
    ready: status !== 'loading',
  }
}
