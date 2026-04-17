import type { ActionTools } from 'deepspace/worker'

/**
 * Extended action tools for book2me — adds calendarApp for reaching the
 * deepspace calendar worker via service binding.
 */
export interface BookMeActionTools extends ActionTools {
  /**
   * POST to a /internal/* endpoint on the deepspace calendar worker.
   * Returns null when the CALENDAR_WORKER binding is absent (local dev).
   */
  calendarApp(path: string, body: unknown): Promise<Response | null>
}
