"use client"

import { useState } from "react"
import { X, ShieldCheck } from "lucide-react"

interface ValidateToast {
  id: string
  incidentId: number
  loading: boolean
  error: string
  rows: Record<string, any>[] | null
}

// Runs VALIDATE_INCIDENT as a non-blocking corner toast per incident, so multiple
// incidents can be validated at once instead of one modal blocking the whole screen.
export function useValidateIncidentCheck() {
  const [toasts, setToasts] = useState<ValidateToast[]>([])

  const runValidateIncidentCheck = async (incidentId: number) => {
    const id = `${incidentId}-${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev, { id, incidentId, loading: true, error: "", rows: null }])

    const update = (patch: Partial<ValidateToast>) =>
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

    try {
      const res = await fetch("/api/incidents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId }),
      })
      const json = await res.json()
      if (!res.ok) {
        update({ loading: false, error: json.error || `Error ${res.status}` })
        return
      }
      update({ loading: false, rows: json.rows || [] })
    } catch (err) {
      update({ loading: false, error: err instanceof Error ? err.message : "Validation failed" })
    }
  }

  const dismissValidateToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id))

  return { toasts, runValidateIncidentCheck, dismissValidateToast }
}

function formatValue(value: any): string {
  if (value == null) return "—"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

function ValidateToastCard({ toast, onDismiss }: { toast: ValidateToast; onDismiss: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg w-80 max-h-96 overflow-y-auto pointer-events-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-500 shrink-0" />
          Validate #{toast.incidentId}
        </h4>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        {toast.loading && (
          <div className="flex items-center gap-2 text-xs text-teal-600 dark:text-teal-400 animate-pulse py-2">
            <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Running VALIDATE_INCIDENT...
          </div>
        )}
        {toast.error && <div className="text-destructive text-xs whitespace-pre-wrap py-1">{toast.error}</div>}

        {toast.rows && toast.rows.length === 0 && !toast.loading && (
          <div className="text-xs text-muted-foreground py-1">Procedure returned no rows.</div>
        )}

        {toast.rows && toast.rows.length > 0 && (
          <div className="space-y-2">
            {toast.rows.map((row, i) => (
              <div key={i} className="border border-border rounded divide-y divide-border overflow-hidden">
                {Object.entries(row).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground shrink-0 w-20">{key}</span>
                    <span className="font-mono whitespace-pre-wrap break-all">{formatValue(value)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ValidateIncidentToasts({
  toasts,
  onDismiss,
}: {
  toasts: { id: string; incidentId: number; loading: boolean; error: string; rows: Record<string, any>[] | null }[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ValidateToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}
