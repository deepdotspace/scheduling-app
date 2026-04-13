/**
 * QuickTooltip — Book-me styled hover label (no native title tooltip delay).
 * Uses instant show/hide. Optional hit layer when the control is disabled so hover
 * still works in browsers that suppress events on disabled elements.
 */

import React, { useState, useCallback, type ReactNode } from 'react'

export interface QuickTooltipProps {
  label: string
  children: ReactNode
  /** When true, a transparent layer captures hover (use while inner control is disabled). */
  interactionBlocked?: boolean
}

export function QuickTooltip({
  label,
  children,
  interactionBlocked = false,
}: QuickTooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  const handleLeave = useCallback((e: React.MouseEvent<HTMLElement>): void => {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setOpen(false)
  }, [])

  return (
    <span
      className="relative flex min-h-[2.25rem] min-w-0 flex-1 basis-0 flex-col"
      onMouseEnter={() => {
        if (!interactionBlocked) setOpen(true)
      }}
      onMouseLeave={handleLeave}
    >
      {children}
      {interactionBlocked ? (
        <span
          className="absolute inset-0 z-[1] cursor-not-allowed bg-transparent"
          aria-hidden
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={handleLeave}
        />
      ) : null}
      <span
        role="tooltip"
        aria-hidden
        style={{ transition: 'none' }}
        className={[
          'pointer-events-none absolute bottom-[calc(100%+5px)] left-1/2 z-[90] max-w-[calc(100vw-16px)] -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-[#111111] px-2 py-0.5 text-center text-[9px] font-medium leading-none tracking-wide text-white shadow-md',
          open ? 'visible opacity-100' : 'invisible opacity-0',
        ].join(' ')}
      >
        {label}
      </span>
    </span>
  )
}
