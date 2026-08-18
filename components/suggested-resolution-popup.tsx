"use client"

import { useState } from "react"
import { X, Lightbulb, Copy, Check } from "lucide-react"

function formatCode(code: string): string {
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function buildSuggestionMessage(resolution: string | null, reason: string | null): string {
  if (!resolution) return ""
  const parts = [formatCode(resolution)]
  if (reason) parts.push(reason)
  return parts.join("\n\n")
}

export function SuggestedResolutionPopup({
  resolution,
  reason,
  onClose,
  onUseInResolve,
}: {
  resolution: string | null
  reason: string | null
  onClose: () => void
  onUseInResolve?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const message = buildSuggestionMessage(resolution, reason)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2">
            <Lightbulb className={`w-4 h-4 ${resolution ? "text-amber-500" : "text-muted-foreground"}`} />
            Suggested Resolution
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {resolution ? (
            <div className="space-y-4">
              <div>
                <span className="text-xs text-muted-foreground">Suggestion</span>
                <p className="text-sm font-medium mt-1">{formatCode(resolution)}</p>
              </div>
              {reason && (
                <div>
                  <span className="text-xs text-muted-foreground">Reason</span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{reason}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm text-center py-4">
              No suggested resolution available for this incident.
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
          {resolution && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(message)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-border rounded-md hover:bg-accent transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {resolution && onUseInResolve && (
            <button
              onClick={onUseInResolve}
              className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              Use in Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
