/**
 * ConfirmDialog — Replaces browser confirm() with a styled modal.
 */

import { Modal } from './Modal'
import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  /** Modal theme: 'light' matches app-card style, 'dark' for dark overlays */
  modalVariant?: 'light' | 'dark'
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  modalVariant = 'dark',
  isLoading = false,
}: ConfirmDialogProps) {
  const isLight = modalVariant === 'light'
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} variant={modalVariant}>
      <div className="space-y-4">
        <p className={`text-sm ${isLight ? 'text-[var(--color-app-text-muted)]' : 'text-slate-400'}`}>{message}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
