# BookWithMe

A scheduling app that lets people book time with you from a shareable link —
your own hosted alternative to Calendly. Built on the
[DeepSpace SDK](https://deep.space).

**Live app:** https://bookwithme.app.space

## What it does
- Define event types with set durations, then publish a public booking page at your own username link.
- Set weekly availability with per-day hours and one-off date overrides; guests only see open slots.
- Manage bookings from a dashboard — reschedule, cancel, or mark a meeting as a no-show — with weekly analytics.
- Guests receive email confirmations, and meetings can include a video-call link.

## How it's built
Event types, availability, and bookings are stored as collections in a
`RecordRoom` Durable Object for real-time updates across host and guest views.
Booking lifecycle operations (schedule, reschedule, cancel, validate
availability) run as server actions, which check the host's real calendar via a
user-billed Google Calendar free/busy integration and send confirmation emails
through the DeepSpace email integration — both proxied through the platform.
Meetings link to DeepSpace video calls at `meet.app.space`, and an AI assistant
page helps manage the schedule.

## Run your own
Apps like this are built by handing a prompt to a coding agent — start at
[deep.space/get-started](https://deep.space/get-started), or scaffold directly:
`npm create deepspace@latest my-app`.

---
*BookWithMe was built end-to-end by an AI agent on the DeepSpace SDK.
DeepSpace is laying the foundation for rebuilding the Internet in an AI-native
way — [deep.space](https://deep.space) · [docs](https://docs.deep.space).*
