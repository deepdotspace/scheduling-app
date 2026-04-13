/**
 * Badge Component - Dark Theme
 */

import React from 'react'

interface BadgeProps {
  children: React.ReactNode
  color?: string
  variant?: 'solid' | 'subtle'
  size?: 'sm' | 'md'
}

export function Badge({ children, color = '#8b5cf6', variant = 'subtle', size = 'sm' }: BadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'

  if (variant === 'solid') {
    return (
      <span
        className={`${sizeClasses} font-medium rounded inline-flex items-center shadow-sm`}
        style={{ backgroundColor: color, color: '#fff' }}
      >
        {children}
      </span>
    )
  }

  // For dark theme, we use a higher opacity background and ensure text is visible
  const isLightColor = color === '#E0E7EE' || color === '#FFD700' || color === '#B9F2FF'
  const textColor = isLightColor ? color : color

  return (
    <span
      className={`${sizeClasses} font-medium rounded inline-flex items-center border`}
      style={{
        backgroundColor: `${color}20`,
        color: textColor,
        borderColor: `${color}40`,
      }}
    >
      {children}
    </span>
  )
}
