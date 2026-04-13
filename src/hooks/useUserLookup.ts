/**
 * useUserLookup — debounced email lookup against DeepSpace user directory.
 *
 * Calls `lookup-user` via the integration proxy to check whether a guest
 * email belongs to a registered DeepSpace user.
 */

import { useState, useEffect, useRef } from 'react'

export interface UserLookupResult {
  found: boolean
  userId?: string
  name?: string
  email?: string
}

export function useUserLookup(email: string) {
  const [isLooking, setIsLooking] = useState(false)
  const [result, setResult] = useState<UserLookupResult | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(0) // monotonic counter to discard stale responses

  useEffect(() => {
    // Clear previous result whenever email changes
    setResult(null)

    // Cancel pending debounce
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // Basic validity check: must contain @ with something on each side
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@') || trimmed.indexOf('@') === 0 || trimmed.endsWith('@')) {
      setIsLooking(false)
      return
    }

    // Must have a domain part (at least x@y.z)
    const domain = trimmed.split('@')[1]
    if (!domain || !domain.includes('.')) {
      setIsLooking(false)
      return
    }

    setIsLooking(true)
    const callId = ++abortRef.current

    timerRef.current = setTimeout(async () => {
      try {
        const { integration } = await import('deepspace')
        const res = await integration.post<{
          found: boolean
          userId?: string
          name?: string
          email?: string
        }>('lookup-user', { email: trimmed })

        // Discard if a newer call has been issued
        if (callId !== abortRef.current) return

        const data = res.data ?? (res as unknown as { found?: boolean })
        if (res.success && data && typeof (data as { found?: boolean }).found === 'boolean') {
          setResult(data as UserLookupResult)
        } else {
          setResult({ found: false })
        }
      } catch {
        if (callId !== abortRef.current) return
        setResult({ found: false })
      } finally {
        if (callId === abortRef.current) {
          setIsLooking(false)
        }
      }
    }, 500)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [email])

  return { isLooking, result }
}
