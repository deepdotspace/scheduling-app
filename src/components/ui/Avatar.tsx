/**
 * Avatar Component - Dark Theme
 */

import React from 'react'

interface AvatarProps {
  name?: string
  imageUrl?: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ name = '', imageUrl, color = '#8b5cf6', size = 'md' }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
  }

  const initial = name.charAt(0).toUpperCase() || '?'

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-slate-700/50`}
      />
    )
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-medium shadow-lg`}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 16px ${color}40`,
      }}
    >
      {initial}
    </div>
  )
}
