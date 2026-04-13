/**
 * Availability Hook
 *
 * Manages weekly availability schedules for booking.
 * Supports multiple named schedules per user (e.g., "Standard Hours", "Sales Calls").
 * The first schedule is treated as the default.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import { DEFAULT_AVAILABILITY, normalizeDaySettings } from '../constants'
import type { AvailabilitySettings, DayOfWeek, DayBlock } from '../constants'

interface UseAvailabilityReturn {
  /** The currently selected (or first) schedule */
  availability: AvailabilitySettings
  /** All schedules for this user */
  schedules: AvailabilitySettings[]
  /** ID of the active schedule */
  activeScheduleId: string | null
  /** Switch to a different schedule */
  setActiveScheduleId: (id: string) => void
  updateDayAvailability: (
    day: DayOfWeek,
    updates: { isAvailable?: boolean; startTime?: string; endTime?: string }
  ) => void
  /** Add a new time block to a day */
  addDayBlock: (day: DayOfWeek) => void
  /** Remove a time block from a day */
  removeDayBlock: (day: DayOfWeek, blockIndex: number) => void
  /** Update a specific time block */
  updateDayBlock: (day: DayOfWeek, blockIndex: number, updates: Partial<DayBlock>) => void
  setTimeGap: (minutes: number) => void
  setMaxBookingsPerDay: (max: number) => void
  setTimezone: (timezone: string) => void
  setScheduleName: (name: string) => void
  createSchedule: (name: string) => void
  deleteSchedule: (id: string) => void
  resetToDefault: () => void
  /** Get a specific schedule by ID */
  getScheduleById: (id: string) => AvailabilitySettings | undefined
  ready: boolean
}

/**
 * Hook to manage availability for a specific user.
 *
 * @param forUserId - Optional user ID to load availability for (defaults to current user).
 */
export function useAvailability(forUserId?: string): UseAvailabilityReturn {
  const { user } = useUser()

  const targetUserId = forUserId ?? user?.id
  const isOwner = user?.id === targetUserId

  const queryOptions = useMemo(() => {
    if (!targetUserId) return { where: { userId: '__none__' } }
    return { where: { userId: targetUserId } }
  }, [targetUserId])

  const { records, status } = useQuery<any>('availability', queryOptions)
  const { create, put, remove } = useMutations<any>('availability')

  // Track which schedule is currently being edited — must be state (not ref) to trigger re-renders
  const [storedActiveId, setStoredActiveId] = useState<string | null>(null)

  // Auto-create default availability for the owner if no records exist.
  const didAutoCreate = useRef(false)
  useEffect(() => {
    if (status !== 'loading' && records.length === 0 && isOwner && targetUserId && !didAutoCreate.current) {
      didAutoCreate.current = true
      create({ ...DEFAULT_AVAILABILITY, userId: targetUserId, name: 'Standard Hours' })
    }
  }, [status, records.length, isOwner, targetUserId, create])

  // Parse all records into AvailabilitySettings[] (normalize legacy single-block format)
  const schedules = useMemo((): AvailabilitySettings[] => {
    if (records.length === 0) return [DEFAULT_AVAILABILITY]

    return records.map(rec => {
      const data = rec.data as Record<string, unknown>
      const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
      const days = {} as Record<string, { isAvailable: boolean; blocks: DayBlock[] }>
      for (const k of dayKeys) {
        const raw = data[k] ?? DEFAULT_AVAILABILITY[k]
        days[k] = normalizeDaySettings(raw)
      }
      return {
        id: rec.recordId,
        name: (data.name as string) ?? 'Standard Hours',
        ...days,
        timeGap: (data.timeGap as number) ?? DEFAULT_AVAILABILITY.timeGap,
        maxBookingsPerDay: (data.maxBookingsPerDay as number) ?? DEFAULT_AVAILABILITY.maxBookingsPerDay,
        timezone: (data.timezone as string) ?? DEFAULT_AVAILABILITY.timezone,
      } as AvailabilitySettings
    })
  }, [records])

  // Resolve active schedule — fall back to first schedule if stored ID is no longer valid
  const activeScheduleId = (storedActiveId && schedules.find(s => s.id === storedActiveId))
    ? storedActiveId
    : (schedules[0]?.id ?? null)

  const availability = useMemo(() => {
    return schedules.find(s => s.id === activeScheduleId) ?? schedules[0] ?? DEFAULT_AVAILABILITY
  }, [schedules, activeScheduleId])

  const setActiveScheduleId = useCallback((id: string) => {
    setStoredActiveId(id)
  }, [])

  const saveAvailability = useCallback((settings: AvailabilitySettings) => {
    if (!isOwner || !targetUserId) return

    const data = {
      userId: targetUserId,
      name: settings.name,
      monday: settings.monday,
      tuesday: settings.tuesday,
      wednesday: settings.wednesday,
      thursday: settings.thursday,
      friday: settings.friday,
      saturday: settings.saturday,
      sunday: settings.sunday,
      timeGap: settings.timeGap,
      maxBookingsPerDay: settings.maxBookingsPerDay,
      timezone: settings.timezone,
    }

    if (settings.id) {
      put(settings.id, data)
    } else {
      create(data)
    }
  }, [isOwner, targetUserId, put, create])

  const updateDayAvailability = useCallback((
    day: DayOfWeek,
    updates: { isAvailable?: boolean; startTime?: string; endTime?: string }
  ) => {
    if (!isOwner) return
    const daySettings = normalizeDaySettings(availability[day])
    const blocks = [...daySettings.blocks]
    if (updates.startTime !== undefined) blocks[0] = { ...blocks[0], startTime: updates.startTime }
    if (updates.endTime !== undefined) blocks[0] = { ...blocks[0], endTime: updates.endTime }
    saveAvailability({
      ...availability,
      [day]: {
        isAvailable: updates.isAvailable ?? daySettings.isAvailable,
        blocks: blocks.length > 0 ? blocks : [{ startTime: '09:00', endTime: '17:00' }],
      },
    })
  }, [availability, saveAvailability, isOwner])

  const addDayBlock = useCallback((day: DayOfWeek) => {
    if (!isOwner) return
    const parseTime = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const minsToTime = (mins: number) => `${Math.floor(mins / 60).toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`
    const daySettings = normalizeDaySettings(availability[day])
    const lastBlock = daySettings.blocks[daySettings.blocks.length - 1]
    const newBlock: DayBlock = lastBlock
      ? { startTime: lastBlock.endTime, endTime: minsToTime(Math.min(parseTime(lastBlock.endTime) + 60, 24 * 60 - 30)) }
      : { startTime: '09:00', endTime: '17:00' }
    saveAvailability({
      ...availability,
      [day]: {
        ...daySettings,
        blocks: [...daySettings.blocks, newBlock],
      },
    })
  }, [availability, saveAvailability, isOwner])

  const removeDayBlock = useCallback((day: DayOfWeek, blockIndex: number) => {
    if (!isOwner) return
    const daySettings = normalizeDaySettings(availability[day])
    if (daySettings.blocks.length <= 1) return
    const blocks = daySettings.blocks.filter((_, i) => i !== blockIndex)
    saveAvailability({
      ...availability,
      [day]: { ...daySettings, blocks },
    })
  }, [availability, saveAvailability, isOwner])

  const updateDayBlock = useCallback((day: DayOfWeek, blockIndex: number, updates: Partial<DayBlock>) => {
    if (!isOwner) return
    const daySettings = normalizeDaySettings(availability[day])
    const blocks = [...daySettings.blocks]
    if (blocks[blockIndex]) {
      blocks[blockIndex] = { ...blocks[blockIndex], ...updates }
    }
    saveAvailability({
      ...availability,
      [day]: { ...daySettings, blocks },
    })
  }, [availability, saveAvailability, isOwner])

  const setTimeGap = useCallback((minutes: number) => {
    if (!isOwner) return
    saveAvailability({ ...availability, timeGap: minutes })
  }, [availability, saveAvailability, isOwner])

  const setMaxBookingsPerDay = useCallback((max: number) => {
    if (!isOwner) return
    saveAvailability({ ...availability, maxBookingsPerDay: max })
  }, [availability, saveAvailability, isOwner])

  const setTimezone = useCallback((timezone: string) => {
    if (!isOwner) return
    saveAvailability({ ...availability, timezone })
  }, [availability, saveAvailability, isOwner])

  const setScheduleName = useCallback((name: string) => {
    if (!isOwner) return
    saveAvailability({ ...availability, name })
  }, [availability, saveAvailability, isOwner])

  const createSchedule = useCallback((name: string) => {
    if (!isOwner || !targetUserId) return
    create({
      userId: targetUserId,
      ...DEFAULT_AVAILABILITY,
      name,
    })
  }, [isOwner, targetUserId, create])

  const deleteSchedule = useCallback((id: string) => {
    if (!isOwner) return
    if (schedules.length <= 1) return // Can't delete the last schedule
    remove(id)
    if (storedActiveId === id) {
      setStoredActiveId(null)
    }
  }, [isOwner, schedules.length, remove, storedActiveId])

  const resetToDefault = useCallback(() => {
    if (!isOwner) return
    saveAvailability({ ...DEFAULT_AVAILABILITY, id: availability.id, name: availability.name })
  }, [saveAvailability, isOwner, availability.id, availability.name])

  const getScheduleById = useCallback((id: string) => {
    return schedules.find(s => s.id === id)
  }, [schedules])

  return {
    availability,
    schedules,
    activeScheduleId,
    setActiveScheduleId,
    updateDayAvailability,
    addDayBlock,
    removeDayBlock,
    updateDayBlock,
    setTimeGap,
    setMaxBookingsPerDay,
    setTimezone,
    setScheduleName,
    createSchedule,
    deleteSchedule,
    resetToDefault,
    getScheduleById,
    ready: status !== 'loading',
  }
}
