/**
 * Cron arming — the one thing that makes `send-reminders` actually run.
 *
 * The SDK's CronRoom does NOT arm its alarm in the constructor. Arming happens
 * inside its private ensureInitialized(), which runs only when the DO is
 * touched: fetch(), a WebSocket connect, or an alarm. Declaring the task in
 * src/cron.ts is therefore not enough — until something addresses the DO, no
 * alarm is ever scheduled and no reminder is ever sent, silently and forever.
 *
 * BookMe has no client that opens the cron monitor: the role-gated
 * /ws/cron/:roomId socket is the only route to the room, and no page in this
 * app calls useCronMonitor. So the worker has to poke the room itself. Once
 * poked the room self-sustains — CronRoom re-arms at the end of every tick and
 * the alarm survives redeploys — which makes arming a one-shot-per-isolate job,
 * not a per-request one.
 */

/**
 * The name the CronRoom DO is addressed by.
 *
 * Deliberately `app:<APP_NAME>` — the key every other server-side room in this
 * app uses (RecordRoom and the cron's own CronContext in worker.ts, SCOPE_ID in
 * src/constants.ts) and the id `/ws/cron/:roomId` resolves through idFromName.
 *
 * It is NOT `app:<DEEPSPACE_APP_ID>`. In this app those are two different
 * strings (`bookwithme` vs `app_01KZ4FHFZZBV5QMZ5PGZF33HSM` in wrangler.toml),
 * so addressing the wrong one would arm a second, empty CronRoom whose task
 * table nothing ever reads — an arming call that returns 200 and still leaves
 * every reminder dead.
 */
export function cronRoomName(appName: string): string {
  return `app:${appName}`
}

/**
 * A once-per-isolate arming latch.
 *
 * Returns a function that runs `ping` the first time it is called and returns
 * the in-flight promise; every later call returns null (nothing to wait on).
 * If the ping fails, the latch is released so a later request in the same
 * isolate retries — a long-lived isolate must never be the reason the alarm
 * stays unarmed.
 *
 * "Fails" covers a rejected promise AND a synchronous throw while the ping is
 * being built (a missing DO binding makes `env.CRON_ROOMS.get(...)` throw
 * before any promise exists). Both mean the DO was never reached, so both
 * un-latch, and neither is allowed to escape: arming rides along on somebody
 * else's request and must never be the reason that request fails.
 *
 * A *404 response* is not a failure: CronRoom.fetch() arms the room and then
 * falls through to BaseRoom, which has no HTTP route for a bare path and
 * answers 404. The arming already happened by then, so a resolved 404 correctly
 * keeps the latch closed.
 */
export function createCronArmer(): (ping: () => Promise<unknown>) => Promise<void> | null {
  let armed = false
  const failed = (err: unknown): void => {
    armed = false
    console.error('[cron-arm] could not arm the cron room; will retry:', err)
  }
  return (ping) => {
    if (armed) return null
    armed = true
    let pending: Promise<unknown>
    try {
      pending = ping()
    } catch (err) {
      failed(err)
      return null
    }
    return pending.then(() => undefined, failed)
  }
}
