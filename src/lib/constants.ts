/**
 * BookMe Constants
 * 
 * Scheduling app configuration and type definitions
 */

// Days of the week
export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type DayOfWeek = typeof DAYS_OF_WEEK[number]

// Time slots from 00:00 to 23:30 in 30-minute increments
export const TIME_SLOTS: string[] = []
for (let hour = 0; hour < 24; hour++) {
  for (let min = 0; min < 60; min += 30) {
    const h = hour.toString().padStart(2, '0')
    const m = min.toString().padStart(2, '0')
    TIME_SLOTS.push(`${h}:${m}`)
  }
}

// Event durations in minutes
export const EVENT_DURATIONS = [
  { value: 15, label: '15 minutes' },
  { value: 20, label: '20 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
] as const

// Meeting locations
export const MEETING_LOCATIONS = [
  { value: 'google-meet', label: 'Google Meet', icon: '📹' },
  { value: 'zoom', label: 'Zoom', icon: '💻' },
  { value: 'phone', label: 'Phone Call', icon: '📞' },
  { value: 'in-person', label: 'In Person', icon: '🏢' },
] as const

export type MeetingLocation = typeof MEETING_LOCATIONS[number]['value']

// Event types
export interface EventType {
  id: string
  title: string
  description: string
  duration: number
  location: MeetingLocation
  isActive: boolean
  color: string
  createdAt: string
}

// Availability slot
export interface AvailabilitySlot {
  day: DayOfWeek
  isAvailable: boolean
  startTime: string
  endTime: string
}

// Availability settings
export interface AvailabilitySettings {
  monday: { isAvailable: boolean; startTime: string; endTime: string }
  tuesday: { isAvailable: boolean; startTime: string; endTime: string }
  wednesday: { isAvailable: boolean; startTime: string; endTime: string }
  thursday: { isAvailable: boolean; startTime: string; endTime: string }
  friday: { isAvailable: boolean; startTime: string; endTime: string }
  saturday: { isAvailable: boolean; startTime: string; endTime: string }
  sunday: { isAvailable: boolean; startTime: string; endTime: string }
  timeGap: number // Minimum minutes gap before booking
  timezone: string
}

// Booking
export interface Booking {
  id: string
  eventTypeId: string
  eventTitle: string
  guestName: string
  guestEmail: string
  startTime: string
  endTime: string
  meetingLink?: string
  additionalInfo?: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  createdAt: string
  hostUserId: string
  hostName: string
  hostEmail?: string
}

// User profile for booking page
export interface UserProfile {
  id: string
  name: string
  email: string
  imageUrl?: string
  username: string
  bio?: string
  calendarConnected: boolean
  emailConnected: boolean
}

// Default availability (Mon-Fri 9-5)
export const DEFAULT_AVAILABILITY: AvailabilitySettings = {
  monday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
  tuesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
  wednesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
  thursday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
  friday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
  saturday: { isAvailable: false, startTime: '09:00', endTime: '17:00' },
  sunday: { isAvailable: false, startTime: '09:00', endTime: '17:00' },
  timeGap: 60,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

// Event colors for visual distinction (user-selectable for event types)
export const EVENT_COLORS = [
  '#B2E1D2',
  '#FF8c00',
  '#CD9A62',
  '#007B82',
  '#D8EB27',
  '#F3c1AA',
  '#5E183B',
  '#BDBDF7',
  '#003c38',
  '#FFc20E',
] as const

// Generate random ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

// Format date for display
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Format time for display
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// Get day of week from date
export function getDayOfWeek(date: Date): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[date.getDay()]
}

// Check if time slot is available
export function isTimeSlotAvailable(
  time: string,
  availability: AvailabilitySettings,
  day: DayOfWeek
): boolean {
  const daySettings = availability[day]
  if (!daySettings.isAvailable) return false
  
  return time >= daySettings.startTime && time < daySettings.endTime
}

// Generate available time slots for a date
export function getAvailableSlots(
  date: Date,
  availability: AvailabilitySettings,
  duration: number,
  existingBookings: Booking[]
): string[] {
  const day = getDayOfWeek(date)
  const daySettings = availability[day]
  
  if (!daySettings.isAvailable) return []
  
  const slots: string[] = []
  const startMinutes = parseTimeToMinutes(daySettings.startTime)
  const endMinutes = parseTimeToMinutes(daySettings.endTime)
  
  // Check if date is today and skip past times
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() + availability.timeGap : 0
  
  for (let mins = startMinutes; mins + duration <= endMinutes; mins += 30) {
    if (mins < currentMinutes) continue
    
    const slotTime = minutesToTime(mins)
    const slotStart = new Date(date)
    slotStart.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
    const slotEnd = new Date(slotStart.getTime() + duration * 60000)
    
    // Check for conflicts with existing bookings
    const hasConflict = existingBookings.some(booking => {
      if (booking.status === 'cancelled') return false
      const bookingStart = new Date(booking.startTime)
      const bookingEnd = new Date(booking.endTime)
      return slotStart < bookingEnd && slotEnd > bookingStart
    })
    
    if (!hasConflict) {
      slots.push(slotTime)
    }
  }
  
  return slots
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0')
  const m = (mins % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

