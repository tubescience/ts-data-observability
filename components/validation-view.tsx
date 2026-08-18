"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Search } from "lucide-react"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"

type Mode = "account" | "client" | "general"

interface Entity {
  id: string
  name: string
}

interface EntitiesResponse {
  accounts: Entity[]
  clients: Entity[]
}

interface ResultRow {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  checkDate: string | null
  checkTimestamp: string | null
}

interface DailyCount {
  checkDate: string | null
  status: string
  count: number
}

interface ResultsResponse {
  mode: Mode
  results?: ResultRow[]
  daily?: DailyCount[]
  checkTypes?: string[]
  targets?: string[]
}

const CHART_COLORS = [
  "#29b5e8", "#22c55e", "#ef4444", "#eab308", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#14b8a6", "#8b5cf6",
]

function getDefaultDates() {
  const end = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const start = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return { start, end }
}

function shortTableName(fullPath: string): string {
  const parts = fullPath.split(".")
  return parts[parts.length - 1]?.replace(/"/g, "") || fullPath
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

function EntityPicker({
  entities,
  value,
  onChange,
  placeholder,
}: {
  entities: Entity[]
  value: Entity | null
  onChange: (entity: Entity | null) => void
  placeholder: string
}) {
  const [query, setQuery] = useState(value?.name || "")
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!query) return entities.slice(0, 50)
    const q = query.toLowerCase()
    return entities.filter((e) => e.name.toLowerCase().includes(q) || e.id.includes(q)).slice(0, 50)
  }, [entities, query])

  return (
    <div className="relative w-full sm:w-64">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (!e.target.value) onChange(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="border border-input rounded-md pl-8 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
          {filtered.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onChange(e)
                setQuery(e.name)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              {e.name} <span className="text-xs text-muted-foreground">({e.id})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ValidationView() {
  const defaults = getDefaultDates()
  const [mode, setMode] = useState<Mode>("account")
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [checkTypeFilter, setCheckTypeFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [dateStart, setDateStart] = useState(defaults.start)
  const [dateEnd, setDateEnd] = useState(defaults.end)

  const { data: entitiesData } = useQuery<EntitiesResponse>({
    queryKey: ["validation-entities"],
    queryFn: () => fetch("/api/validation/entities").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const entities = mode === "client" ? entitiesData?.clients || [] : entitiesData?.accounts || []

  // For general mode, checkType/target filters are applied server-side (the
  // underlying data is aggregated there). For account/client mode, the full
  // per-entity result set is fetched once and filtered client-side below.
  const params = new URLSearchParams({
    mode,
    groupValue: selectedEntity?.id || "",
    checkType: mode === "general" ? checkTypeFilter : "",
    target: mode === "general" ? targetFilter : "",
    dateStart,
    dateEnd,
  })

  const { data, isLoading, error } = useQuery<ResultsResponse>({
    queryKey: ["validation-results", mode, selectedEntity?.id, checkTypeFilter, targetFilter, dateStart, dateEnd],
    queryFn: () => fetch(`/api/validation/results?${params}`).then((r) => r.json()),
    enabled: mode === "general" || !!selectedEntity,
  })

  const results = data?.results || []
  const daily = data?.daily || []

  // Dropdown options stay stable regardless of the other active filters.
  const checkTypeOptions = mode === "general"
    ? data?.checkTypes || []
    : [...new Set(results.map((r) => r.checkType))].sort()
  // Target options are scoped to the selected account/client (mode !== "general")
  // and further narrowed by the currently selected check type, if any.
  const targetOptions = mode === "general"
    ? data?.targets || []
    : [...new Set(
        results
          .filter((r) => !checkTypeFilter || r.checkType === checkTypeFilter)
          .map((r) => r.targetTable)
      )].sort()

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      if (checkTypeFilter && r.checkType !== checkTypeFilter) return false
      if (targetFilter && r.targetTable !== targetFilter) return false
      return true
    })
  }, [results, checkTypeFilter, targetFilter])

  // Account/Client mode: metric value vs threshold, one line per check type
  const metricChartData = useMemo(() => {
    const byDate: Record<string, Record<string, { value: number | null; threshold: number | null }>> = {}
    for (const r of filteredResults) {
      if (r.checkDate && r.metricValue != null) {
        if (!byDate[r.checkDate]) byDate[r.checkDate] = {}
        byDate[r.checkDate][r.checkType] = { value: r.metricValue, threshold: r.threshold }
      }
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, series]) => {
        const point: Record<string, any> = { date }
        for (const [key, v] of Object.entries(series)) {
          point[key] = v.value
          point[`${key}_threshold`] = v.threshold
        }
        return point
      })
  }, [filteredResults])

  const metricSeriesKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of filteredResults) {
      if (r.metricValue != null) keys.add(r.checkType)
    }
    return [...keys].sort()
  }, [filteredResults])

  // General mode: pass/fail counts per day (SKIP and other non-terminal
  // statuses are excluded — they didn't actually pass or fail)
  const generalChartData = useMemo(() => {
    const byDate: Record<string, { Pass: number; Fail: number }> = {}
    for (const d of daily) {
      if (!d.checkDate) continue
      if (!byDate[d.checkDate]) byDate[d.checkDate] = { Pass: 0, Fail: 0 }
      if (d.status === "PASS") byDate[d.checkDate].Pass += d.count
      else if (d.status === "FAIL" || d.status === "ERROR") byDate[d.checkDate].Fail += d.count
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }))
  }, [daily])

  const isFail = (status: string) => status === "FAIL" || status === "ERROR"
  const passCount = mode === "general"
    ? daily.filter((d) => d.status === "PASS").reduce((sum, d) => sum + d.count, 0)
    : filteredResults.filter((r) => r.status === "PASS").length
  const failCount = mode === "general"
    ? daily.filter((d) => isFail(d.status)).reduce((sum, d) => sum + d.count, 0)
    : filteredResults.filter((r) => isFail(r.status)).length

  const hasChartData = mode === "general" ? generalChartData.length > 0 : metricChartData.length > 0

  return (
    <div className="space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">Check History</h2>

      {/* Mode + filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <div className="flex border border-input rounded-md overflow-hidden">
          {(["account", "client", "general"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setSelectedEntity(null); setCheckTypeFilter(""); setTargetFilter("") }}
              className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode !== "general" && (
          <EntityPicker
            entities={entities}
            value={selectedEntity}
            onChange={setSelectedEntity}
            placeholder={mode === "client" ? "Search client..." : "Search account..."}
          />
        )}

        {checkTypeOptions.length > 0 && (
          <select
            value={checkTypeFilter}
            onChange={(e) => { setCheckTypeFilter(e.target.value); setTargetFilter("") }}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
          >
            <option value="">All Check Types</option>
            {checkTypeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {targetOptions.length > 0 && (
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
          >
            <option value="">All Targets</option>
            {targetOptions.map((t) => <option key={t} value={t}>{shortTableName(t)}</option>)}
          </select>
        )}

        <div className="flex items-center gap-1 text-xs text-muted-foreground col-span-1 sm:col-span-2 md:col-span-1">
          <span>From</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none"
          />
          <span>To</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none"
          />
        </div>

        {(mode === "general" || selectedEntity) && (
          <div className="sm:ml-auto flex gap-3 text-sm">
            <span className="text-green-600 font-medium">{passCount} passed</span>
            {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failed</span>}
          </div>
        )}
      </div>

      {mode !== "general" && !selectedEntity && (
        <div className="text-muted-foreground py-8 text-center text-sm">
          Search for a {mode} above to see its validation history.
        </div>
      )}

      {(mode === "general" || selectedEntity) && (
        <>
          {isLoading && <div className="text-muted-foreground py-8 text-center">Loading results...</div>}
          {error && <div className="text-destructive py-4">Failed to load results</div>}

          {!isLoading && !error && !hasChartData && (
            <div className="text-muted-foreground py-8 text-center text-sm">No results for selected filters</div>
          )}

          {!isLoading && hasChartData && mode === "general" && (
            <div className="bg-background border border-border rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3">Pass / Fail Over Time</h4>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={generalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={formatTick} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Pass" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Fail" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!isLoading && hasChartData && mode !== "general" && (
            <div className="bg-background border border-border rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3">Metric Value vs Threshold</h4>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={metricChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    width={getYAxisWidth(metricChartData, metricSeriesKeys[0] || "value")}
                    tickFormatter={formatTick}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {metricSeriesKeys.slice(0, 10).map((key, i) => (
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
          )}

          {!isLoading && mode !== "general" && filteredResults.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Validated At</th>
                    <th className="text-left px-3 py-2 font-medium">Check Type</th>
                    <th className="text-left px-3 py-2 font-medium">Target</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Value</th>
                    <th className="text-left px-3 py-2 font-medium">Threshold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...filteredResults].reverse().slice(0, 200).map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{formatPST(r.checkTimestamp)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.checkType}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate" title={r.targetTable}>{r.targetTable}</td>
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
          )}
        </>
      )}
    </div>
  )
}
