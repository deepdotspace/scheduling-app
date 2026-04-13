/**
 * ToastContainer — Renders all active toast notifications.
 * Place once at the app root level.
 */

import { Toast } from './Toast'
import { useToast } from '../../hooks/useToast'

export function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-2">
      {toasts.map(t => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          duration={t.duration}
          onClose={() => removeToast(t.id)}
        />
      ))}
    </div>
  )
}
