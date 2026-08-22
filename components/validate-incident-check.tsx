"use client"

import { useState } from "react"
import { X, ShieldCheck } from "lucide-react"

export function useValidateIncidentCheck() {
  const [checkingValidate, setCheckingValidate] = useState(false)
  const [validateRows, setValidateRows] = useState<Record<string, any>[] | null>(null)
  const [validateError, setValidateError] = useState("")
  const [showValidatePopup, setShowValidatePopup] = useState(false)

  const runValidateIncidentCheck = async (incidentId: number) => {
    setShowValidatePopup(true)
    setCheckingValidate(true)
    setValidateRows(null)
    setValidateError("")
    try {
      const res = await fetch("/api/incidents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setValidateError(json.error || `Error ${res.status}`)
        return
      }
      setValidateRows(json.rows || [])
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : "Validation failed")
    } finally {
      setCheckingValidate(false)
    }
  }

  return {
    checkingValidate,
    validateRows,
    validateError,
    showValidatePopup,
    setShowValidatePopup,
    runValidateIncidentCheck,
  }
}

function formatValue(value: any): string {
  if (value == null) return "—"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

export function ValidateIncidentPopup({
  loading,
  error,
  rows,
  onClose,
}: {
  loading: boolean
  error: string
  rows: Record<string, any>[] | null
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-500" />
            Validate Incident
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-teal-600 dark:text-teal-400 animate-pulse py-8">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running VALIDATE_INCIDENT...
            </div>
          )}
          {error && <div className="text-destructive text-sm whitespace-pre-wrap text-center py-4">{error}</div>}

          {rows && rows.length === 0 && !loading && (
            <div className="text-sm text-muted-foreground text-center py-4">Procedure returned no rows.</div>
          )}

          {rows && rows.length > 0 && (
            <div className="space-y-3">
              {rows.map((row, i) => (
                <div key={i} className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {Object.entries(row).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <span className="text-xs text-muted-foreground shrink-0 w-32">{key}</span>
                      <span className="font-mono text-xs whitespace-pre-wrap break-all">{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
