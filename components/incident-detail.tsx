"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { X, AlertTriangle, TrendingUp, GitBranch, Search, Copy, Check } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts"
import { LineagePanel } from "./lineage-view"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"

interface HistoryPoint {
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  details: string | null
  checkDate: string | null
  checkTimestamp: string | null
}

interface Incident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  severity: string
  status: string
  failureCount: number
  lastMetric: number | null
  lastThreshold: number | null
  firstSeen: string | null
  lastSeen: string | null
}

interface IncidentDetailProps {
  incident: Incident
  onClose: () => void
  onResolve: (incident: Incident) => void
}

function getDefaultDates() {
  const end = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const start = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return { start, end }
}

export function IncidentDetail({ incident, onClose, onResolve }: IncidentDetailProps) {
  const defaults = getDefaultDates()
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)
  const [showLineageGraph, setShowLineageGraph] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<{ validation: any; suggestions: any[] } | null>(null)
  const [diagError, setDiagError] = useState("")

  const runDiagnosis = async () => {
    setDiagnosing(true)
    setDiagnosis(null)
    setDiagError("")
    try {
      const res = await fetch("/api/incidents/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkType: incident.checkType,
          targetTable: incident.targetTable,
          groupValue: incident.groupValue,
          severity: incident.severity,
          lastMetric: incident.lastMetric,
          lastThreshold: incident.lastThreshold,
          failureCount: incident.failureCount,
        }),
      })
      const text = await res.text()
      if (!res.ok) {
        try { setDiagError(JSON.parse(text).error) } catch { setDiagError(text || `Error ${res.status}`) }
        return
      }
      setDiagnosis(JSON.parse(text))
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : "Diagnosis failed")
    } finally {
      setDiagnosing(false)
    }
  }

  const params = new URLSearchParams({
    checkType: incident.checkType,
    targetTable: incident.targetTable,
    groupValue: incident.groupValue || "",
    dateStart,
    dateEnd,
  })

  const { data, isLoading, error } = useQuery<HistoryPoint[]>({
    queryKey: ["incident-history", incident.incidentId, dateStart, dateEnd],
    queryFn: () => fetch(`/api/incidents/history?${params}`).then((r) => r.json()),
  })

  const results = data || []

  const chartData = useMemo(() => {
    return results
      .filter((r) => r.checkDate && r.metricValue != null)
      .map((r) => ({
        date: r.checkDate!,
        value: r.metricValue,
        threshold: r.threshold,
        status: r.status,
      }))
  }, [results])

  const latestThreshold = results.length > 0 ? results[results.length - 1]?.threshold : null

  const severityColors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-card border border-border rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
              Incident Detail
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{incident.incidentKey}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2 -mr-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Incident info */}
        <div className="p-4 border-b border-border grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Check Type</span>
            <p className="font-mono text-xs mt-0.5">{incident.checkType}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Target</span>
            <p className="text-xs mt-0.5 break-all">{incident.targetTable}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Group</span>
            <p className="text-xs mt-0.5">{incident.groupValue || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Severity</span>
            <p className="mt-0.5">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${severityColors[incident.severity] || "bg-gray-100 text-gray-800"}`}>
                {incident.severity}
              </span>
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Failures</span>
            <p className="text-xs mt-0.5 font-medium text-red-600">{incident.failureCount}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Last Value</span>
            <p className="font-mono text-xs mt-0.5">{incident.lastMetric != null ? formatTick(incident.lastMetric) : "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Threshold</span>
            <p className="font-mono text-xs mt-0.5">{incident.lastThreshold != null ? formatTick(incident.lastThreshold) : "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">First Seen</span>
            <p className="text-xs mt-0.5">{formatPST(incident.firstSeen)}</p>
          </div>
        </div>

        {/* Date range */}
        <div className="p-4 border-b border-border">
          <div className="flex flex-wrap gap-3 items-center">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Check History</span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground ml-4">
              <span>From</span>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span>To</span>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="p-4 space-y-4">
          {isLoading && <div className="text-muted-foreground py-8 text-center">Loading history...</div>}
          {error && <div className="text-destructive py-4">Failed to load history</div>}

          {!isLoading && !error && chartData.length === 0 && (
            <div className="text-muted-foreground py-8 text-center">No check results for selected date range</div>
          )}

          {!isLoading && chartData.length > 0 && (
            <>
              <div className="bg-background border border-border rounded-lg p-4">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      width={getYAxisWidth(chartData, "value")}
                      tickFormatter={formatTick}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="value" name="Metric Value" stroke="#29b5e8" strokeWidth={2} dot={(props: any) => {
                      const { cx, cy, payload } = props
                      const color = payload.status === "PASS" ? "#22c55e" : "#ef4444"
                      return <circle cx={cx} cy={cy} r={4} fill={color} stroke={color} />
                    }} />
                    <Line type="monotone" dataKey="threshold" name="Threshold" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                    {latestThreshold != null && (
                      <ReferenceLine y={latestThreshold} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Data table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Value</th>
                      <th className="text-left px-3 py-2 font-medium">Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...results].reverse().slice(0, 50).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs">{r.checkDate}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            r.status === "PASS"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.metricValue != null ? formatTick(r.metricValue) : "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.threshold != null ? formatTick(r.threshold) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Diagnosis Results */}
        {diagnosing && (
          <div className="px-4 py-6 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 animate-pulse">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Diagnosing... running validation + AI analysis
            </div>
          </div>
        )}
        {diagError && (
          <div className="px-4 py-3 border-t border-border">
            <div className="text-destructive text-sm">{diagError}</div>
          </div>
        )}
        {diagnosis && (
          <div className="px-4 py-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Diagnosis</h3>
              {diagnosis.validation.stillFailing ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  Still Failing
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Appears Resolved
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{diagnosis.validation.details}</p>

            {diagnosis.suggestions.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suggested Resolutions</h4>
                {diagnosis.suggestions.map((s: any, i: number) => (
                  <DiagnosisSuggestion key={i} suggestion={s} index={i} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => setShowLineageGraph(true)}
            className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-blue-500 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <GitBranch className="w-4 h-4" />
            View Lineage
          </button>
          <button
            onClick={runDiagnosis}
            disabled={diagnosing}
            className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-amber-500 text-amber-600 dark:text-amber-400 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search className="w-4 h-4" />
            {diagnosing ? "Diagnosing..." : "Diagnose & Suggest Fix"}
          </button>
          <button
            onClick={() => onResolve(incident)}
            className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            Resolve Incident
          </button>
        </div>

        {showLineageGraph && (
          <LineageGraphPopup
            target={incident.targetTable}
            onClose={() => setShowLineageGraph(false)}
          />
        )}
      </div>
    </div>
  )
}

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch {
    return iso.slice(0, 16).replace("T", " ")
  }
}

function LineageGraphPopup({ target, onClose }: { target: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Lineage Graph</h3>
            <span className="text-xs text-muted-foreground font-mono ml-2 truncate max-w-[300px]">{target}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <LineagePanel initialTarget={target} maxDepth={1} />
        </div>
      </div>
    </div>
  )
}

function DiagnosisSuggestion({ suggestion, index }: { suggestion: any; index: number }) {
  const [copied, setCopied] = useState(false)

  const copySQL = () => {
    if (!suggestion.sql) return
    navigator.clipboard.writeText(suggestion.sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const priorityColor = suggestion.priority === "high"
    ? "border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20"
    : suggestion.priority === "medium"
    ? "border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20"
    : "border-border bg-muted/20"

  return (
    <div className={`border rounded-lg p-3 ${priorityColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground">{index + 1}.</span>
            <span className="text-sm font-medium">{suggestion.title}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
              suggestion.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
              suggestion.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
              "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }`}>{suggestion.priority}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{suggestion.description}</p>
        </div>
      </div>
      {suggestion.sql && (
        <div className="mt-2 flex items-start gap-2">
          <pre className="flex-1 text-[11px] font-mono bg-black/5 dark:bg-white/5 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">
            {suggestion.sql}
          </pre>
          <button
            onClick={copySQL}
            className="shrink-0 p-1.5 rounded hover:bg-muted transition-colors"
            title="Copy SQL"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
        </div>
      )}
    </div>
  )
}
