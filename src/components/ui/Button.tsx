/**
 * Button Component - Dark Theme
 */

import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'light'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  const baseClasses =
    'font-medium rounded-lg transition-all duration-200 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  }

  const variantClasses = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm active:scale-[0.98]',
    secondary:
      'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-border',
    danger:
      'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
    ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    light:
      'bg-white text-foreground border border-border hover:bg-muted shadow-sm active:scale-[0.98]',
  }

  return (
    <button className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
