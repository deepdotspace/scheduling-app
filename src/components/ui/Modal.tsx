/**
 * Modal Component
 * Supports dark (default) and light theme variants.
 * Renders via portal to document.body so overlay covers entire viewport (sidebar, top bar, etc.).
 */

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  maxWidth?: string
  variant?: 'dark' | 'light'
  contentClassName?: string
  /** Override header classes (e.g. for top-nav matching grey) */
  headerClassName?: string
  /** Override footer classes (e.g. for top-nav matching grey) */
  footerClassName?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-lg',
  variant = 'dark',
  contentClassName,
  headerClassName,
  footerClassName,
  children,
  footer,
}: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [isOpen])

  if (!isOpen) return null

  const isLight = variant === 'light'

  const boxClasses = isLight
    ? `bg-[var(--color-app-card)] rounded-xl ${maxWidth} w-full max-h-[90vh] overflow-hidden shadow-[var(--shadow-card)] flex flex-col border border-[var(--color-app-border)]`
    : `bg-slate-800/95 backdrop-blur-xl rounded-2xl ${maxWidth} w-full max-h-[90vh] overflow-hidden shadow-2xl shadow-black/50 flex flex-col border border-slate-700/50`

  const headerClasses = headerClassName ?? (isLight
    ? 'px-6 py-4 border-b border-[var(--color-app-border)] flex items-start justify-between shrink-0 bg-white'
    : 'px-6 py-4 border-b border-slate-700/50 flex items-start justify-between shrink-0 bg-slate-800/50')

  const titleClasses = isLight ? 'text-xl font-bold text-[var(--color-app-text)]' : 'text-lg font-semibold text-slate-100'
  const subtitleClasses = isLight ? 'text-sm text-[var(--color-app-text-muted)] mt-0.5' : 'text-sm text-slate-400 mt-0.5'
  const closeBtnClasses = isLight
    ? 'p-1.5 hover:bg-[var(--color-muted)] rounded-lg -mr-1.5 -mt-1.5 transition-colors'
    : 'p-1.5 hover:bg-slate-700/50 rounded-lg -mr-1.5 -mt-1.5 transition-colors'
  const closeIconClasses = isLight ? 'w-5 h-5 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]' : 'w-5 h-5 text-slate-400 hover:text-slate-200'
  const footerClasses = footerClassName ?? (isLight
    ? 'px-6 py-4 border-t border-[var(--color-app-border)] bg-[var(--color-muted)] shrink-0'
    : 'px-6 py-4 border-t border-slate-700/50 bg-slate-900/50 shrink-0')

  const overlayClasses = isLight
    ? 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[100] overscroll-contain'
    : 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] overscroll-contain'

  const modalContent = (
    <div
      className={overlayClasses}
      onClick={onClose}
    >
      <div className={boxClasses} onClick={(e) => e.stopPropagation()}>
        <div className={headerClasses}>
          <div>
            <h2 className={titleClasses}>{title}</h2>
            {subtitle && <p className={subtitleClasses}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className={closeBtnClasses}>
            <svg className={closeIconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto overscroll-contain ${contentClassName ?? 'p-6'}`}>{children}</div>
        {footer && <div className={footerClasses}>{footer}</div>}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
