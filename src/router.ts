// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/analytics`
  | `/availability`
  | `/book/:username`
  | `/book/:username/:eventId`
  | `/dashboard`
  | `/events`
  | `/manage/:bookingId/:token`
  | `/meetings`
  | `/meetings/reschedule/:bookingId`

export type Params = {
  '/book/:username': { username: string }
  '/book/:username/:eventId': { username: string; eventId: string }
  '/manage/:bookingId/:token': { bookingId: string; token: string }
  '/meetings/reschedule/:bookingId': { bookingId: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
