"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { X, CheckCircle, TrendingUp, Radar } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts"
import { MonitorDetailPopup } from "@/components/monitor-detail-popup"
import { SeverityBadge } from "@/components/severity-badge"
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

interface ResolvedIncident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  groupName?: string | null
  monitorId: number | null
  severity: string
  failureCount: number
  resolutionNotes: string | null
  firstSeen: string | null
  lastSeen: string | null
  resolvedAt: string | null
}

interface Props {
  incident: ResolvedIncident
  onClose: () => void
}

function getDefaultDates() {
  const end = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const start = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return { start, end }
}

export function ResolvedIncidentDetail({ incident, onClose }: Props) {
  const defaults = getDefaultDates()
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)
  const [showMonitor, setShowMonitor] = useState(false)

  // Resolve group name for SPEND_CLIENT / SPEND_ACCOUNT / SRC_SPEND_CLIENT / SRC_SPEND_ACCOUNT / SUM_VALUE_GROUPED / DATA_RECENCY
  const { data: groupNameData } = useQuery<{ name: string | null }>({
    queryKey: ["resolved-group-name", incident.checkType, incident.groupValue],
    queryFn: () => fetch(`/api/incidents/group-name?checkType=${incident.checkType}&groupValue=${incident.groupValue || ""}`).then((r) => r.json()),
    enabled:
      (incident.checkType === "SPEND_CLIENT" ||
        incident.checkType === "SPEND_ACCOUNT" ||
        incident.checkType === "SRC_SPEND_CLIENT" ||
        incident.checkType === "SRC_SPEND_ACCOUNT" ||
        incident.checkType === "SUM_VALUE_GROUPED" ||
        incident.checkType === "DATA_RECENCY") &&
      !!incident.groupValue,
  })
  const groupName = incident.groupName || groupNameData?.name

  const params = new URLSearchParams({
    checkType: incident.checkType,
    targetTable: incident.targetTable,
    groupValue: incident.groupValue || "",
    dateStart,
    dateEnd,
  })

  const { data, isLoading, error } = useQuery<HistoryPoint[]>({
    queryKey: ["resolved-incident-history", incident.incidentId, dateStart, dateEnd],
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-card border border-border rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              Resolved Incident
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
            {groupName && <p className="text-xs font-medium text-foreground">{groupName}</p>}
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Severity</span>
            <p className="mt-0.5">
              <SeverityBadge severity={incident.severity} />
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Failures</span>
            <p className="text-xs mt-0.5">{incident.failureCount}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">First Seen</span>
            <p className="text-xs mt-0.5">{formatPST(incident.firstSeen)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Resolved At</span>
            <p className="text-xs mt-0.5 text-green-600 font-medium">{formatPST(incident.resolvedAt)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Resolution Notes</span>
            <p className="text-xs mt-0.5">{incident.resolutionNotes || "—"}</p>
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

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
          {incident.monitorId != null && (
            <button
              onClick={() => setShowMonitor(true)}
              className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-border rounded-md hover:bg-accent transition-colors"
            >
              <Radar className="w-4 h-4" />
              View Monitor
            </button>
          )}
        </div>

        {showMonitor && incident.monitorId != null && (
          <MonitorDetailPopup
            monitorId={incident.monitorId}
            onClose={() => setShowMonitor(false)}
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
