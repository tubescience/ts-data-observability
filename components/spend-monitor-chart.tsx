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
  thresholdMin: number | null
  thresholdMax: number | null
  groupValue: string | null
  groupName: string | null
  groupKind: "account" | "client" | null
  groupClientId: string | null
  groupClientName: string | null
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

interface SeriesSpec {
  key: string
  color?: string
  dashed?: boolean
  showLabel?: boolean
  colorByThreshold?: boolean
}

const OUT_OF_RANGE_COLOR = "#ef4444"

// Custom dot renderer for series flagged `colorByThreshold` — turns a point
// red when its value falls outside that row's min/max threshold band.
function ThresholdAwareDot(props: any) {
  const { cx, cy, payload, dataKey, stroke } = props
  const value = payload?.[dataKey]
  const min = payload?.min
  const max = payload?.max
  if (cx == null || cy == null || value == null) return null
  const outOfRange = (min != null && value < min) || (max != null && value > max)
  return <circle cx={cx} cy={cy} r={outOfRange ? 4 : 3} fill={outOfRange ? OUT_OF_RANGE_COLOR : stroke} stroke={outOfRange ? OUT_OF_RANGE_COLOR : stroke} />
}

function buildChartData(rows: HistoryResult[], seriesKeyFn: (r: HistoryResult) => string, valueFn: (r: HistoryResult) => number | null = (r) => r.metricValue) {
  const byDate: Record<string, Record<string, number | null>> = {}
  for (const r of rows) {
    const value = valueFn(r)
    if (r.checkDate && value != null) {
      const key = seriesKeyFn(r)
      if (!byDate[r.checkDate]) byDate[r.checkDate] = {}
      byDate[r.checkDate][key] = value
    }
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, series]) => ({ date, ...series }))
}

function SeriesChart({ data, series, height = 220 }: { data: Record<string, unknown>[]; series: SeriesSpec[]; height?: number }) {
  const primaryKeys = series.filter((s) => !s.dashed).map((s) => s.key)
  return (
    <div className="bg-background border border-border rounded-lg p-3">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            width={getYAxisWidth(data, primaryKeys[0] || "value")}
            tickFormatter={formatTick}
          />
          <Tooltip content={<ChartTooltip />} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.slice(0, 12).map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color || CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={s.dashed ? 1.5 : 2}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              dot={s.dashed ? false : s.colorByThreshold ? <ThresholdAwareDot /> : { r: 3 }}
              connectNulls
            >
              {s.showLabel && <LabelList dataKey={s.key} position="top" fontSize={9} formatter={(v: unknown) => formatTick(Number(v))} />}
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// One entry per date, deduped (last value wins) — some monitors run more
// than one check type against the same group+date and report the same
// number (e.g. V_SPEND_DAILY_MCP's SUM_VALUE_GROUPED and SPEND_PLATFORM),
// which would otherwise double totals.
function dedupeByDate(rows: HistoryResult[]): HistoryResult[] {
  const byDate = new Map<string, HistoryResult>()
  for (const r of rows) {
    if (!r.checkDate) continue
    byDate.set(r.checkDate, r)
  }
  return [...byDate.values()].sort((a, b) => (a.checkDate || "").localeCompare(b.checkDate || ""))
}

function sumMetric(rows: HistoryResult[]): number {
  return rows.reduce((sum, r) => sum + (r.metricValue ?? 0), 0)
}

export function SpendMonitorChart({ monitorId, spendCheckTypes, enabled }: SpendMonitorChartProps) {
  const defaults = getDefaultDates()
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)
  const [openAccounts, setOpenAccounts] = useState<Set<string>>(new Set())
  const [openClients, setOpenClients] = useState<Set<string>>(new Set())
  const [accountSectionOpen, setAccountSectionOpen] = useState(false)
  const [clientSectionOpen, setClientSectionOpen] = useState(false)

  const { data, isLoading, error } = useQuery<HistoryResult[]>({
    queryKey: ["monitor-history", monitorId, dateStart, dateEnd],
    queryFn: () =>
      fetch(`/api/monitors/history?monitorId=${monitorId}&dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
    enabled,
  })

  // A monitor's raw-layer checks are sometimes written with a SRC_ prefix
  // that doesn't appear in the config's own CHECK_TYPE (e.g. config declares
  // "SPEND_CLIENT" but ~15% of its actual results are "SRC_SPEND_CLIENT",
  // same CONFIG_ID) — normalize both sides so those rows aren't dropped.
  const results = useMemo(() => {
    const normalize = (ct: string) => ct.replace(/^SRC_/, "")
    const wanted = new Set(spendCheckTypes.map(normalize))
    return (data || []).filter((r) => wanted.has(normalize(r.checkType)))
  }, [data, spendCheckTypes])

  const accountRows = useMemo(() => results.filter((r) => r.groupKind === "account" && r.groupValue), [results])
  const directClientRows = useMemo(() => results.filter((r) => r.groupKind === "client" && r.groupValue), [results])

  // By Account: one accordion row per account, deduped/rolled up from raw
  // rows, ordered by total spend in range, highest first.
  const accounts = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rows: HistoryResult[] }>()
    for (const r of accountRows) {
      const key = r.groupValue!
      if (!map.has(key)) map.set(key, { key, label: r.groupName ? `${r.groupName} (${r.groupValue})` : r.groupValue!, rows: [] })
      map.get(key)!.rows.push(r)
    }
    return [...map.values()]
      .map((a) => ({ ...a, rows: dedupeByDate(a.rows) }))
      .sort((a, b) => sumMetric(b.rows) - sumMetric(a.rows))
  }, [accountRows])

  // By Client: roll accounts up under their owning client, plus any checks
  // that are already client-grain (no account breakdown available for those).
  const clients = useMemo(() => {
    const map = new Map<string, { key: string; label: string; accounts: { label: string; rows: HistoryResult[] }[] }>()
    for (const acc of accounts) {
      const rawRows = acc.rows
      const first = rawRows[0]
      const clientKey = first?.groupClientId || `account:${acc.key}`
      const clientLabel = first?.groupClientName || acc.label
      if (!map.has(clientKey)) map.set(clientKey, { key: clientKey, label: clientLabel, accounts: [] })
      map.get(clientKey)!.accounts.push({ label: acc.label, rows: rawRows })
    }
    const directByClient = new Map<string, HistoryResult[]>()
    for (const r of directClientRows) {
      const key = r.groupValue!
      if (!directByClient.has(key)) directByClient.set(key, [])
      directByClient.get(key)!.push(r)
    }
    for (const [key, rows] of directByClient) {
      const deduped = dedupeByDate(rows)
      const label = rows[0]?.groupName || key
      if (!map.has(key)) map.set(key, { key, label, accounts: [] })
      map.get(key)!.accounts.push({ label, rows: deduped })
    }
    return [...map.values()]
      .map((c) => ({ ...c, totalSpend: c.accounts.reduce((sum, a) => sum + sumMetric(a.rows), 0) }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
  }, [accounts, directClientRows])

  function toggleAccount(key: string) {
    setOpenAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleClient(key: string) {
    setOpenClients((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
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

      {!isLoading && !error && (
        <div className="space-y-4">
          <div>
            <button
              onClick={() => setAccountSectionOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 mb-2 text-left"
            >
              {accountSectionOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">By Account{accounts.length > 0 ? ` (${accounts.length})` : ""}</h4>
            </button>
            {accountSectionOpen && (accounts.length === 0 ? (
              <div className="text-muted-foreground text-xs py-4 text-center border border-border rounded-lg">No account-level breakdown for this check</div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {accounts.map((acc) => {
                  const isOpen = openAccounts.has(acc.key)
                  const chartData = isOpen
                    ? buildChartData(acc.rows, () => "value")
                        .map((point, i) => ({ ...point, min: acc.rows[i]?.thresholdMin ?? null, max: acc.rows[i]?.thresholdMax ?? null }))
                    : []
                  return (
                    <div key={acc.key}>
                      <button
                        onClick={() => toggleAccount(acc.key)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                        <span className="font-medium">{acc.label}</span>
                        <span className="text-muted-foreground ml-auto shrink-0">{formatTick(sumMetric(acc.rows))} total · {acc.rows.length} results</span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3">
                          {chartData.length > 0 ? (
                            <SeriesChart
                              data={chartData}
                              series={[
                                { key: "value", color: CHART_COLORS[0], showLabel: true, colorByThreshold: true },
                                { key: "min", color: "#94a3b8", dashed: true },
                                { key: "max", color: "#94a3b8", dashed: true },
                              ]}
                            />
                          ) : (
                            <div className="text-muted-foreground text-xs py-4 text-center">No values in selected date range</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div>
            <button
              onClick={() => setClientSectionOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 mb-2 text-left"
            >
              {clientSectionOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">By Client{clients.length > 0 ? ` (${clients.length})` : ""}</h4>
            </button>
            {clientSectionOpen && (clients.length === 0 ? (
              <div className="text-muted-foreground text-xs py-4 text-center border border-border rounded-lg">No client-level breakdown for this check</div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {clients.map((client) => {
                  const isOpen = openClients.has(client.key)
                  const chartData = isOpen
                    ? (() => {
                        const byDate: Record<string, Record<string, number | null>> = {}
                        for (const acc of client.accounts) {
                          for (const r of acc.rows) {
                            if (!r.checkDate || r.metricValue == null) continue
                            if (!byDate[r.checkDate]) byDate[r.checkDate] = {}
                            byDate[r.checkDate][acc.label] = r.metricValue
                          }
                        }
                        return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, series]) => ({ date, ...series }))
                      })()
                    : []
                  const seriesKeys = client.accounts.map((a) => a.label)
                  return (
                    <div key={client.key}>
                      <button
                        onClick={() => toggleClient(client.key)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                        <span className="font-medium">{client.label}</span>
                        <span className="text-muted-foreground ml-auto shrink-0">
                          {formatTick(client.totalSpend)} total · {client.accounts.length} account{client.accounts.length !== 1 ? "s" : ""}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3">
                          {chartData.length > 0 ? (
                            <SeriesChart data={chartData} series={seriesKeys.map((k) => ({ key: k }))} />
                          ) : (
                            <div className="text-muted-foreground text-xs py-4 text-center">No values in selected date range</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
