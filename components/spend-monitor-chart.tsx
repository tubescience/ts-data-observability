"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"

interface HistoryResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  groupName: string | null
  checkDate: string | null
  checkTimestamp: string | null
}

interface SpendMonitorChartProps {
  monitorId: number
  spendCheckTypes: string[]
  enabled: boolean
}

function getDefaultDates() {
  const end = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const start = new Date(Date.now() - 13 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return { start, end }
}

const CHART_COLORS = [
  "#29b5e8", "#22c55e", "#ef4444", "#eab308", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#14b8a6", "#8b5cf6",
]

function buildChartData(rows: HistoryResult[], seriesKeyFn: (r: HistoryResult) => string) {
  const byDate: Record<string, Record<string, number | null>> = {}
  for (const r of rows) {
    if (r.checkDate && r.metricValue != null) {
      const key = seriesKeyFn(r)
      if (!byDate[r.checkDate]) byDate[r.checkDate] = {}
      byDate[r.checkDate][key] = r.metricValue
    }
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, series]) => ({ date, ...series }))
}

function SeriesChart({ data, seriesKeys, height = 200 }: { data: Record<string, unknown>[]; seriesKeys: string[]; height?: number }) {
  return (
    <div className="bg-background border border-border rounded-lg p-3">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            width={getYAxisWidth(data, seriesKeys[0] || "value")}
            tickFormatter={formatTick}
          />
          <Tooltip content={<ChartTooltip />} />
          {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {seriesKeys.slice(0, 10).map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            >
              <LabelList dataKey={key} position="top" fontSize={9} formatter={(v: unknown) => formatTick(Number(v))} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SpendMonitorChart({ monitorId, spendCheckTypes, enabled }: SpendMonitorChartProps) {
  const defaults = getDefaultDates()
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)
  const [openAccounts, setOpenAccounts] = useState<Set<string>>(new Set())

  const { data, isLoading, error } = useQuery<HistoryResult[]>({
    queryKey: ["monitor-history", monitorId, dateStart, dateEnd],
    queryFn: () =>
      fetch(`/api/monitors/history?monitorId=${monitorId}&dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
    enabled,
  })

  const groupedResults = useMemo(
    () => (data || []).filter((r) => spendCheckTypes.includes(r.checkType)),
    [data, spendCheckTypes]
  )

  // One accordion row per account, auto-derived from the results — no manual
  // account selection needed — ordered by total spend in range, highest first.
  // Some monitors run more than one check type against the same group+date
  // (e.g. V_SPEND_DAILY_MCP's SUM_VALUE_GROUPED and SPEND_PLATFORM report the
  // same number) — dedupe to one value per date per account before summing,
  // otherwise those monitors would show double the real spend.
  const accounts = useMemo(() => {
    const byDatePerGroup = new Map<string, Map<string, HistoryResult>>()
    const labelByGroup = new Map<string, string>()
    for (const r of groupedResults) {
      if (!r.groupValue || !r.checkDate) continue
      if (!byDatePerGroup.has(r.groupValue)) byDatePerGroup.set(r.groupValue, new Map())
      byDatePerGroup.get(r.groupValue)!.set(r.checkDate, r)
      if (!labelByGroup.has(r.groupValue)) {
        labelByGroup.set(r.groupValue, r.groupName ? `${r.groupName} (${r.groupValue})` : r.groupValue)
      }
    }
    const result: { key: string; label: string; rows: HistoryResult[]; totalSpend: number }[] = []
    for (const [groupValue, byDate] of byDatePerGroup) {
      const rows = [...byDate.values()].sort((a, b) => (a.checkDate || "").localeCompare(b.checkDate || ""))
      const totalSpend = rows.reduce((sum, r) => sum + (r.metricValue ?? 0), 0)
      result.push({ key: groupValue, label: labelByGroup.get(groupValue)!, rows, totalSpend })
    }
    return result.sort((a, b) => b.totalSpend - a.totalSpend)
  }, [groupedResults])

  function toggleAccount(key: string) {
    setOpenAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <input
          type="date"
          value={dateStart}
          onChange={(e) => setDateStart(e.target.value)}
          className="border border-input rounded-md px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span>To</span>
        <input
          type="date"
          value={dateEnd}
          onChange={(e) => setDateEnd(e.target.value)}
          className="border border-input rounded-md px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading && <div className="text-muted-foreground text-xs py-6 text-center">Loading spend history...</div>}
      {error && <div className="text-destructive text-xs py-4">Failed to load spend history</div>}

      {!isLoading && !error && accounts.length === 0 && (
        <div className="text-muted-foreground text-xs py-6 text-center">No spend results for selected date range</div>
      )}

      {!isLoading && !error && accounts.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
          {accounts.map((acc) => {
            const isOpen = openAccounts.has(acc.key)
            const chartData = isOpen ? buildChartData(acc.rows, () => "value") : []
            return (
              <div key={acc.key}>
                <button
                  onClick={() => toggleAccount(acc.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="font-medium">{acc.label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">{formatTick(acc.totalSpend)} total · {acc.rows.length} results</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    {chartData.length > 0 ? (
                      <SeriesChart data={chartData} seriesKeys={["value"]} />
                    ) : (
                      <div className="text-muted-foreground text-xs py-4 text-center">No values in selected date range</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
