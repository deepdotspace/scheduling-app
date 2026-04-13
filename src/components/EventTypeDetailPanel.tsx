/**
 * EventTypeDetailPanel
 *
 * Right-side detail panel for creating or editing an event type.
 * Basics, Settings, Notifications tabs — matches MeetingDetailPanel layout.
 */

import { useMemo } from 'react'
import { X } from 'lucide-react'
import { Input, Textarea, Select, Button } from './ui'
import { AvailabilityPreview } from './AvailabilityPreview'
import {
  EVENT_DURATIONS,
  MEETING_LOCATIONS,
  EVENT_COLORS,
  BUFFER_OPTIONS,
} from '../constants'
import type { EventType, MeetingLocation, BookingQuestion, AvailabilitySettings } from '../constants'

export type PanelTab = 'basics' | 'settings' | 'notifications'

export interface EventTypeFormData {
  title: string
  description: string
  duration: number
  location: MeetingLocation
  color: string
  /** Google Calendar API: create event + invite guest (stored as sendGcalInvite). */
  sendGoogleCalendarInvite: boolean
  sendDeepSpaceMail: boolean
  sendExternalEmail: boolean
  bufferBefore: number
  bufferAfter: number
  durations: number[]
  availabilityScheduleId: string
  maxAttendees: number
  isRoundRobin: boolean
  teamMemberIds: string[]
  bookingQuestions: BookingQuestion[]
}

interface User {
  id: string
  name: string
  imageUrl?: string
}

interface EventTypeDetailPanelProps {
  event: EventType | null
  formData: EventTypeFormData
  onFormDataChange: (data: EventTypeFormData) => void
  activeTab: PanelTab
  onActiveTabChange: (tab: PanelTab) => void
  onClose: () => void
  onSubmit: () => void
  onDelete?: () => void
  /** Default/fallback availability schedule */
  availability: AvailabilitySettings
  /** All available schedules to choose from */
  schedules: AvailabilitySettings[]
  users: User[]
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'settings', label: 'Settings' },
  { id: 'notifications', label: 'Notifications' },
]

export function EventTypeDetailPanel({
  event,
  formData,
  onFormDataChange,
  activeTab,
  onActiveTabChange,
  onClose,
  onSubmit,
  onDelete,
  availability,
  schedules,
  users,
}: EventTypeDetailPanelProps) {
  const setFormData = (data: EventTypeFormData) => onFormDataChange(data)
  const isEdit = !!event

  // Resolve which schedule to preview based on the current selection
  const previewAvailability = useMemo((): AvailabilitySettings => {
    if (formData.availabilityScheduleId) {
      const found = schedules.find(s => s.id === formData.availabilityScheduleId)
      if (found) return found
    }
    return availability
  }, [formData.availabilityScheduleId, schedules, availability])

  const previewScheduleName = useMemo((): string | undefined => {
    if (formData.availabilityScheduleId) {
      return schedules.find(s => s.id === formData.availabilityScheduleId)?.name
    }
    return schedules[0]?.name
  }, [formData.availabilityScheduleId, schedules])

  return (
    <div className="flex flex-col h-full min-h-0 bg-white border-l border-gray-200 w-full min-w-[380px] max-w-[480px] shrink-0 overflow-hidden self-stretch">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-gray-500 uppercase tracking-widest mb-1">
            Event Type
          </p>
          <h2 className="text-xl font-bold text-[#111827] tracking-tight truncate">
            {isEdit ? event.title : 'New Event Type'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-50 transition-colors text-gray-500 shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-4 border-b border-gray-200 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onActiveTabChange(tab.id)}
            className={`px-3 py-2 text-[12px] font-bold rounded-t-md transition-colors focus-visible:outline-none ${
              activeTab === tab.id
                ? 'border-b-2 border-[#111827] -mb-px text-[#111827]'
                : 'text-gray-500 hover:text-[#111827]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — independent scroll, does not affect middle section */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide px-6 py-4">
        {activeTab === 'basics' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-4">
              <Input
                label="Event Title"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter event title"
              />
              <Textarea
                label="Description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this meeting about?"
                rows={4}
              />
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-[#111827]">Duration</label>
                {formData.durations.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, durations: [formData.duration] })}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Offer multiple durations
                  </button>
                )}
              </div>
              {formData.durations.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {EVENT_DURATIONS.map(d => {
                      const isSelected = formData.durations.includes(d.value)
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => {
                            const updated = isSelected
                              ? formData.durations.filter(v => v !== d.value)
                              : [...formData.durations, d.value].sort((a, b) => a - b)
                            if (updated.length === 0) return
                            setFormData({ ...formData, durations: updated, duration: updated[0] })
                          }}
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            isSelected
                              ? 'bg-indigo-50 border-indigo-200 text-[#111827]'
                              : 'bg-gray-50 border-gray-200 text-gray-500'
                          }`}
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, durations: [] })}
                    className="text-xs text-gray-500 hover:text-[#111827]"
                  >
                    Use single duration
                  </button>
                </div>
              ) : (
                <Select
                  value={String(formData.duration)}
                  onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) })}
                  options={EVENT_DURATIONS.map(d => ({ value: String(d.value), label: d.label }))}
                />
              )}
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30">
              <Select
                label="Location"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value as MeetingLocation })}
                options={MEETING_LOCATIONS.map(l => ({ value: l.value, label: `${l.icon} ${l.label}` }))}
              />
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-1.5">
              <label className="block text-sm font-bold text-[#111827]">Color</label>
              <div className="flex gap-2">
                {EVENT_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-8 h-8 rounded-lg transition-all ${formData.color === color ? 'ring-2 ring-[#111827] ring-offset-2 ring-offset-white' : 'hover:scale-110'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            {schedules.length > 1 && (
              <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-1.5">
                <Select
                  label="Availability Schedule"
                  value={formData.availabilityScheduleId}
                  onChange={e => setFormData({ ...formData, availabilityScheduleId: e.target.value })}
                  options={[
                    { value: '', label: `Default (${schedules[0]?.name ?? 'Standard Hours'})` },
                    ...schedules.map(s => ({ value: s.id ?? '', label: s.name })),
                  ]}
                />
                <p className="text-xs text-gray-500">Which availability schedule should this event type use?</p>
              </div>
            )}
            <AvailabilityPreview availability={previewAvailability} scheduleName={previewScheduleName} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-[#111827]">Group Event</label>
                  <p className="text-xs text-gray-500 mt-0.5">Allow multiple people to book the same time slot</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, maxAttendees: formData.maxAttendees > 1 ? 0 : 5 })}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    formData.maxAttendees > 1 ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      formData.maxAttendees > 1 ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              {formData.maxAttendees > 1 && (
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    label="Max attendees per slot"
                    type="number"
                    value={formData.maxAttendees}
                    onChange={e => setFormData({ ...formData, maxAttendees: Math.max(2, parseInt(e.target.value) || 2) })}
                    min={2}
                    className="w-24"
                  />
                </div>
              )}
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-[#111827]">Round Robin</label>
                  <p className="text-xs text-gray-500 mt-0.5">Distribute bookings across team members (least-recent-booking first)</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      isRoundRobin: !formData.isRoundRobin,
                      teamMemberIds: !formData.isRoundRobin ? formData.teamMemberIds : [],
                    })
                  }
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    formData.isRoundRobin ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      formData.isRoundRobin ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              {formData.isRoundRobin && (
                <div className="space-y-2 mt-2">
                  <label className="block text-xs font-medium text-gray-500">Team Members</label>
                  {users.length === 0 ? (
                    <p className="text-xs text-gray-500">No other users in this workspace</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {users.map(u => {
                        const isSelected = formData.teamMemberIds.includes(u.id)
                        return (
                          <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const updated = isSelected
                                  ? formData.teamMemberIds.filter(id => id !== u.id)
                                  : [...formData.teamMemberIds, u.id]
                                setFormData({ ...formData, teamMemberIds: updated })
                              }}
                              className="rounded border-gray-300 bg-white"
                            />
                            <div className="flex items-center gap-2">
                              {u.imageUrl && <img src={u.imageUrl} alt="" className="w-5 h-5 rounded-full" />}
                              <span className="text-sm text-[#111827]">{u.name}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {formData.teamMemberIds.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {formData.teamMemberIds.length} member{formData.teamMemberIds.length !== 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#111827]">Buffer Time</label>
                <p className="text-xs text-gray-500 mt-0.5">Add padding before/after meetings to prevent back-to-back bookings</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Before event"
                  value={String(formData.bufferBefore)}
                  onChange={e => setFormData({ ...formData, bufferBefore: parseInt(e.target.value) })}
                  options={BUFFER_OPTIONS.map(b => ({ value: String(b.value), label: b.label }))}
                />
                <Select
                  label="After event"
                  value={String(formData.bufferAfter)}
                  onChange={e => setFormData({ ...formData, bufferAfter: parseInt(e.target.value) })}
                  options={BUFFER_OPTIONS.map(b => ({ value: String(b.value), label: b.label }))}
                />
              </div>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-[#111827]">Booking Questions</label>
                  <p className="text-xs text-gray-500 mt-0.5">Ask guests for additional information when they book</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newQ: BookingQuestion = {
                      id: `q-${Date.now()}`,
                      type: 'text',
                      label: '',
                      required: false,
                    }
                    setFormData({ ...formData, bookingQuestions: [...formData.bookingQuestions, newQ] })
                  }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Question
                </Button>
              </div>
              {formData.bookingQuestions.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <p className="text-sm text-gray-500">No custom questions yet</p>
                  <p className="text-xs text-gray-500 mt-1">Guests will only see the default "Additional Information" field</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {formData.bookingQuestions.map((q, idx) => (
                    <div key={q.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Question label"
                          value={q.label}
                          onChange={e => {
                            const updated = [...formData.bookingQuestions]
                            updated[idx] = { ...q, label: e.target.value }
                            setFormData({ ...formData, bookingQuestions: updated })
                          }}
                          className="flex-1"
                        />
                        <select
                          value={q.type}
                          onChange={e => {
                            const updated = [...formData.bookingQuestions]
                            updated[idx] = { ...q, type: e.target.value as BookingQuestion['type'] }
                            setFormData({ ...formData, bookingQuestions: updated })
                          }}
                          className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg text-[#111827]"
                        >
                          <option value="text">Text</option>
                          <option value="textarea">Long Text</option>
                          <option value="select">Dropdown</option>
                          <option value="checkbox">Checkbox</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              bookingQuestions: formData.bookingQuestions.filter((_, i) => i !== idx),
                            })
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={e => {
                            const updated = [...formData.bookingQuestions]
                            updated[idx] = { ...q, required: e.target.checked }
                            setFormData({ ...formData, bookingQuestions: updated })
                          }}
                          className="rounded border-gray-300 bg-white"
                        />
                        Required
                      </label>
                      {q.type === 'select' && (
                        <Input
                          placeholder="Options (comma separated)"
                          value={(q.options ?? []).join(', ')}
                          onChange={e => {
                            const updated = [...formData.bookingQuestions]
                            updated[idx] = { ...q, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                            setFormData({ ...formData, bookingQuestions: updated })
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/30 space-y-3">
              <p className="text-sm text-gray-500">Configure how guests and hosts are notified when a booking is made.</p>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
                <button
                  type="button"
                  onClick={() =>
                    setFormData({ ...formData, sendGoogleCalendarInvite: !formData.sendGoogleCalendarInvite })
                  }
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    formData.sendGoogleCalendarInvite ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      formData.sendGoogleCalendarInvite ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <span className="text-sm text-[#111827]">Google Calendar invite</span>
                  <p className="text-xs text-gray-500">
                    Create an event on your connected Google Calendar and email a calendar invite to the guest. Requires
                    Google Calendar connected on your dashboard.
                  </p>
                </div>
              </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, sendDeepSpaceMail: !formData.sendDeepSpaceMail })}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    formData.sendDeepSpaceMail ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      formData.sendDeepSpaceMail ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <span className="text-sm text-[#111827]">DeepSpace Mail</span>
                  <p className="text-xs text-gray-500">
                    Post booking activity to DeepSpace Mail (directory + in-app). When on, signed-in guests also get the
                    confirmation email without an extra checkbox.
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, sendExternalEmail: !formData.sendExternalEmail })}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    formData.sendExternalEmail ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      formData.sendExternalEmail ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <span className="text-sm text-[#111827]">Send email confirmation to guest</span>
                  <p className="text-xs text-gray-500">Guest receives an email with booking details, meeting link, and calendar file.</p>
                </div>
              </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between gap-4">
        <div className="shrink-0">
          {isEdit && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 py-1.5 px-2 rounded-lg transition-colors whitespace-nowrap"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0 ml-auto">
          {activeTab !== 'basics' && (
            <button
              type="button"
              onClick={() => onActiveTabChange(activeTab === 'notifications' ? 'settings' : 'basics')}
              className="app-btn-secondary py-1.5 px-2 text-xs flex items-center gap-1 shrink-0"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          )}
          <button type="button" onClick={onClose} className="app-btn-secondary py-1.5 px-2 text-xs shrink-0">
            Cancel
          </button>
          {activeTab !== 'notifications' ? (
            <button
              type="button"
              onClick={() => onActiveTabChange(activeTab === 'basics' ? 'settings' : 'notifications')}
              disabled={activeTab === 'basics' && !formData.title}
              className="app-btn-primary py-1.5 px-2 text-xs flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              data-testid="create-event-type-submit-btn"
              onClick={onSubmit}
              disabled={!formData.title}
              className="app-btn-primary py-1.5 px-2 text-xs flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {isEdit ? 'Save Changes' : 'Create Event Type'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
