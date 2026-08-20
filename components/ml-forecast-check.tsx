"use client"

import { useState } from "react"
import { X, Copy, Check, TrendingUp } from "lucide-react"

// The ML forecast service currently only supports these two check types —
// confirmed live: SUM_VALUE_GROUPED etc. respond with status "error" and
// "not yet implemented" rather than a real forecast.
export const ML_FORECAST_CHECK_TYPES = new Set(["SPEND_CLIENT", "SPEND_ACCOUNT"])

export interface MlForecastTarget {
  checkType: string
  groupValue: string | null
}

export interface MlForecastResult {
  status: string
  check_type: string
  group_value: string
  message: string
  train_days: number | null
  nonzero_days: number | null
  forecast_date: string | null
  expected: number | null
  lower_bound: number | null
  upper_bound: number | null
  actual: number | null
  flagged: boolean | null
}

export function useMlForecastCheck() {
  const [checkingMlForecast, setCheckingMlForecast] = useState(false)
  const [mlForecastResult, setMlForecastResult] = useState<MlForecastResult | null>(null)
  const [mlForecastError, setMlForecastError] = useState("")
  const [showMlForecastPopup, setShowMlForecastPopup] = useState(false)

  const runMlForecastCheck = async (target: MlForecastTarget) => {
    setShowMlForecastPopup(true)
    setCheckingMlForecast(true)
    setMlForecastResult(null)
    setMlForecastError("")
    try {
      const res = await fetch("/api/incidents/validate-vs-ml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkType: target.checkType, groupValue: target.groupValue }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMlForecastError(json.error || `Error ${res.status}`)
        return
      }
      setMlForecastResult(json)
    } catch (err) {
      setMlForecastError(err instanceof Error ? err.message : "ML forecast check failed")
    } finally {
      setCheckingMlForecast(false)
    }
  }

  return {
    checkingMlForecast,
    mlForecastResult,
    mlForecastError,
    showMlForecastPopup,
    setShowMlForecastPopup,
    runMlForecastCheck,
  }
}

// Full-precision, comma-grouped quantity (e.g. "2,352.52") for resolution notes.
function formatFullQty(value: number | null | undefined): string {
  if (value == null) return "—"
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildMlForecastMessage(result: MlForecastResult): string {
  if (result.status !== "done") return `ML Forecast: ${result.message}`
  return (
    `Validated vs ML Forecast: ${result.group_value}\n` +
    `Expected: ${formatFullQty(result.expected)} (range ${formatFullQty(result.lower_bound)} - ${formatFullQty(result.upper_bound)})\n` +
    `Actual: ${formatFullQty(result.actual)}\n` +
    `Flagged: ${result.flagged ? "Yes — outside expected range" : "No — within expected range"}`
  )
}

export function MlForecastPopup({
  loading,
  error,
  result,
  onClose,
  onUseInResolve,
}: {
  loading: boolean
  error: string
  result: MlForecastResult | null
  onClose: () => void
  onUseInResolve: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const message = result ? buildMlForecastMessage(result) : ""
  const done = result?.status === "done"

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            ML Forecast Validation
            {result?.forecast_date && <span className="text-xs font-normal text-muted-foreground">for {result.forecast_date}</span>}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-purple-600 dark:text-purple-400 animate-pulse py-8">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running ML forecast...
            </div>
          )}
          {error && <div className="text-destructive text-sm text-center py-4">{error}</div>}

          {result && !done && (
            <div className="text-sm text-muted-foreground text-center py-4">{result.message}</div>
          )}

          {result && done && (
            <div className="space-y-3">
              <div
                className={`rounded-lg border p-3 text-sm font-semibold ${
                  result.flagged
                    ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                    : "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                }`}
              >
                {result.flagged ? "Outside expected range" : "Within expected range"}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Actual</span>
                  <p className="font-mono font-medium mt-0.5">{formatFullQty(result.actual)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Expected</span>
                  <p className="font-mono mt-0.5">{formatFullQty(result.expected)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Lower Bound</span>
                  <p className="font-mono text-xs mt-0.5">{formatFullQty(result.lower_bound)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Upper Bound</span>
                  <p className="font-mono text-xs mt-0.5">{formatFullQty(result.upper_bound)}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Trained on {result.train_days} day{result.train_days !== 1 ? "s" : ""} ({result.nonzero_days} with nonzero spend).
              </div>
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
          {done && (
            <>
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
              <button
                onClick={() => onUseInResolve(message)}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Use in Resolve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
