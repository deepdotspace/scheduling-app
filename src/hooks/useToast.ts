/**
 * useToast — Global toast notification system
 *
 * Manages a queue of toast notifications with auto-dismiss.
 * Uses a simple global state pattern (module-level array + listeners).
 */

import { useState, useEffect, useCallback } from 'react'
import type { ToastType } from '../components/ui/Toast'

interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

// Module-level state for cross-component sharing
let toasts: ToastItem[] = []
const listeners: Set<() => void> = new Set()

function notify() {
  listeners.forEach(fn => fn())
}

export function showToast(message: string, type: ToastType = 'success', duration = 3000, replace = false) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts = replace ? [{ id, message, type, duration }] : [...toasts, { id, message, type, duration }]
  notify()
}

export function removeToast(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

export function useToast() {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'success', duration = 3000) => {
    showToast(message, type, duration)
  }, [])

  return {
    toasts,
    removeToast,
    toast,
    success: useCallback((msg: string) => showToast(msg, 'success'), []),
    error: useCallback((msg: string) => showToast(msg, 'error', 5000), []),
    info: useCallback((msg: string) => showToast(msg, 'info'), []),
  }
}
