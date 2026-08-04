"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { X, TrendingUp } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"

interface HistoryResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  checkDate: string | null
  checkTimestamp: string | null
}

interface MonitorHistoryProps {
  monitorId: number
  monitorName: string
  targetTable: string
  onClose: () => void
}

function getDefaultDates() {
  const end = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const start = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return { start, end }
}

const CHART_COLORS = [
  "#29b5e8", "#22c55e", "#ef4444", "#eab308", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#14b8a6", "#8b5cf6",
]

export function MonitorHistory({ monitorId, monitorName, targetTable, onClose }: MonitorHistoryProps) {
  const defaults = getDefaultDates()
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)
  const [selectedCheck, setSelectedCheck] = useState("")

  const { data, isLoading, error } = useQuery<HistoryResult[]>({
    queryKey: ["monitor-history", monitorId, dateStart, dateEnd],
    queryFn: () =>
      fetch(`/api/monitors/history?monitorId=${monitorId}&dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
  })

  const allResults = data || []
  const checkTypes = useMemo(() => [...new Set(allResults.map((r) => r.checkType))].sort(), [allResults])

  const filteredResults = selectedCheck
    ? allResults.filter((r) => r.checkType === selectedCheck)
    : allResults

  // Build chart data: group by date and check type (+ group value for grouped checks)
  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, { value: number | null; threshold: number | null; status: string }>> = {}

    for (const r of filteredResults) {
      if (r.checkDate && r.metricValue != null) {
        const seriesKey = r.groupValue ? `${r.checkType} (${r.groupValue})` : r.checkType
        if (!byDate[r.checkDate]) byDate[r.checkDate] = {}
        byDate[r.checkDate][seriesKey] = {
          value: r.metricValue,
          threshold: r.threshold,
          status: r.status,
        }
      }
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, series]) => {
        const point: Record<string, any> = { date }
        for (const [key, data] of Object.entries(series)) {
          point[key] = data.value
          point[`${key}_threshold`] = data.threshold
        }
        return point
      })
  }, [filteredResults])

  // Get all series keys for the chart
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of filteredResults) {
      if (r.metricValue != null) {
        keys.add(r.groupValue ? `${r.checkType} (${r.groupValue})` : r.checkType)
      }
    }
    return [...keys].sort()
  }, [filteredResults])

  // Summary stats
  const passCount = filteredResults.filter((r) => r.status === "PASS").length
  const failCount = filteredResults.filter((r) => r.status === "FAIL" || r.status === "ERROR").length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Monitor History
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">{monitorName} — {targetTable}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
            <select
              value={selectedCheck}
              onChange={(e) => setSelectedCheck(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Check Types</option>
              {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="ml-auto flex gap-3 text-sm">
              <span className="text-green-600 font-medium">{passCount} passed</span>
              {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failed</span>}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {isLoading && <div className="text-muted-foreground py-8 text-center">Loading history...</div>}
          {error && <div className="text-destructive py-4">Failed to load history</div>}

          {!isLoading && !error && chartData.length === 0 && (
            <div className="text-muted-foreground py-8 text-center">No results for selected date range</div>
          )}

          {!isLoading && chartData.length > 0 && (
            <>
              {/* Chart */}
              <div className="bg-background border border-border rounded-lg p-4">
                <h4 className="text-sm font-medium mb-3">Metric Values Over Time</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      width={getYAxisWidth(chartData, seriesKeys[0] || "value")}
                      tickFormatter={formatTick}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {seriesKeys.slice(0, 10).map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Data table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Check Type</th>
                      <th className="text-left px-3 py-2 font-medium">Group</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Value</th>
                      <th className="text-left px-3 py-2 font-medium">Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredResults.slice(-100).reverse().map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs">{r.checkDate}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.checkType}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.groupValue || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            r.status === "PASS"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.metricValue != null ? formatTick(r.metricValue) : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {r.threshold != null ? formatTick(r.threshold) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
