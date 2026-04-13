/**
 * ShareModal — Share a booking link via copy, email, or QR code.
 */

import { useState } from 'react'
import { Modal } from './ui/Modal'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  url: string
  title?: string
}

export function ShareModal({ isOpen, onClose, url, title = 'Share Booking Link' }: ShareModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEmailShare = () => {
    const subject = encodeURIComponent('Book a meeting with me')
    const body = encodeURIComponent(`Schedule a time to meet:\n${url}`)
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
  }

  // Simple QR code via a public API
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} variant="light" maxWidth="max-w-md">
      <div className="space-y-5">
        {/* URL Display */}
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 rounded-lg text-xs font-mono text-[#111827] border border-gray-200 break-all">
            {url}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className={`app-btn-secondary py-2 px-3 text-sm shrink-0 ${copied ? 'border-emerald-500/50 text-emerald-600' : ''}`}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        {/* Share Options */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <span className="text-xs font-bold text-[#111827]">Copy Link</span>
          </button>

          <button
            type="button"
            onClick={handleEmailShare}
            className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-xs font-bold text-[#111827]">Email</span>
          </button>
        </div>

        {/* QR Code */}
        <div className="text-center pt-2">
          <p className="text-xs font-bold text-gray-500 mb-3">Scan to open booking page</p>
          <div className="inline-block p-3 bg-gray-50 rounded-xl border border-gray-200">
            <img src={qrUrl} alt="QR Code" className="w-[160px] h-[160px]" />
          </div>
        </div>
      </div>
    </Modal>
  )
}
