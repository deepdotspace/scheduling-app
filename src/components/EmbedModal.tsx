/**
 * EmbedModal — Generate embed code snippets for booking pages.
 * Three modes: inline iframe, popup button, floating button.
 */

import { useState } from 'react'
import { Modal } from './ui/Modal'

type EmbedMode = 'inline' | 'popup' | 'floating'

interface EmbedModalProps {
  isOpen: boolean
  onClose: () => void
  bookingUrl: string
  eventTitle: string
}

export function EmbedModal({ isOpen, onClose, bookingUrl, eventTitle }: EmbedModalProps) {
  const [mode, setMode] = useState<EmbedMode>('inline')
  const [copied, setCopied] = useState(false)

  const getSnippet = (): string => {
    switch (mode) {
      case 'inline':
        return `<!-- BookMe Inline Embed -->
<iframe
  src="${bookingUrl}"
  style="width:100%;min-height:700px;border:1px solid #E5E7EB;border-radius:12px;background:#fff"
  title="Book ${eventTitle}"
></iframe>`

      case 'popup':
        return `<!-- BookMe Popup Button -->
<script>
(function(){
  var btn = document.getElementById('bookme-popup-btn');
  if (!btn) return;
  btn.addEventListener('click', function() {
    var w = Math.min(500, window.innerWidth - 40);
    var h = Math.min(750, window.innerHeight - 40);
    var left = (window.innerWidth - w) / 2;
    var top = (window.innerHeight - h) / 2;
    window.open(
      '${bookingUrl}',
      'bookme',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top
    );
  });
})();
</script>
<button
  id="bookme-popup-btn"
  type="button"
  style="padding:12px 24px;background:#111827;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;box-shadow:0 1px 2px rgba(17,24,39,0.08)"
>
  Book ${eventTitle}
</button>`

      case 'floating':
        return `<!-- BookMe Floating Button -->
<script>
(function(){
  var fab = document.createElement('button');
  fab.textContent = 'Book a Meeting';
  fab.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 24px;background:#111827;color:#fff;border:none;border-radius:9999px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;z-index:9999;box-shadow:0 4px 14px rgba(17,24,39,0.2)';
  fab.addEventListener('click', function() {
    var w = Math.min(500, window.innerWidth - 40);
    var h = Math.min(750, window.innerHeight - 40);
    var left = (window.innerWidth - w) / 2;
    var top = (window.innerHeight - h) / 2;
    window.open(
      '${bookingUrl}',
      'bookme',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top
    );
  });
  document.body.appendChild(fab);
})();
</script>`
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(getSnippet())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const modes: { id: EmbedMode; label: string; description: string }[] = [
    { id: 'inline', label: 'Inline', description: 'Embed directly in your page' },
    { id: 'popup', label: 'Popup', description: 'Button that opens a popup window' },
    { id: 'floating', label: 'Floating Button', description: 'Fixed button in the corner' },
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Embed booking page"
      subtitle="Add this event to your site"
      variant="light"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-5">
        {/* Mode Selector — match Event Types / Share modal (light gray cards, black selection) */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {modes.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMode(m.id); setCopied(false) }}
              className={`rounded-xl border p-3 text-left transition-colors ${
                mode === m.id
                  ? 'border-[#111827] bg-white shadow-sm ring-1 ring-black/5'
                  : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
              }`}
            >
              <p className={`text-sm font-bold ${mode === m.id ? 'text-[#111827]' : 'text-gray-700'}`}>{m.label}</p>
              <p className={`mt-0.5 text-xs ${mode === m.id ? 'text-gray-600' : 'text-gray-500'}`}>{m.description}</p>
            </button>
          ))}
        </div>

        {/* Code Snippet */}
        <div className="relative">
          <pre className="max-h-64 overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-[#111827]">
            {getSnippet()}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className={`app-btn-secondary absolute right-2 top-2 py-1.5 px-3 text-xs sm:text-sm ${copied ? 'border-emerald-500/50 text-emerald-600' : ''}`}
          >
            {copied ? (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        {/* Instructions */}
        <p className="text-xs text-gray-500">
          Paste this code into your website&apos;s HTML where you want the booking
          {mode === 'inline' ? ' widget to appear' : mode === 'popup' ? ' button to appear' : ' button to float'}.
        </p>
      </div>
    </Modal>
  )
}
