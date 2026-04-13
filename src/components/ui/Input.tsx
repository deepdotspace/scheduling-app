/**
 * Input Component
 */

import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-bold text-foreground">{label}</label>}
      <input
        className={`w-full px-3 py-2 text-sm bg-card border rounded-lg outline-none transition-all duration-200 text-foreground placeholder:text-muted-foreground ${
          error
            ? 'border-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/50'
            : 'border-border focus:border-primary focus:ring-1 focus:ring-primary/30 hover:border-border'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-bold text-foreground">{label}</label>}
      <textarea
        className={`w-full px-3 py-2 text-sm bg-card border rounded-lg outline-none transition-all duration-200 resize-none text-foreground placeholder:text-muted-foreground ${
          error
            ? 'border-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/50'
            : 'border-border focus:border-primary focus:ring-1 focus:ring-primary/30 hover:border-border'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export function Select({ label, options, className = '', ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-bold text-foreground">{label}</label>}
      <select
        className={`w-full px-3 py-2 text-sm bg-card border border-border rounded-lg outline-none transition-all duration-200 text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 hover:border-border ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-card text-foreground">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
