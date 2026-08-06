"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"

interface CreditResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  checkTimestamp: string | null
}

interface AICostEntry {
  usageDate: string
  serviceType: string
  creditsUsed: number
}

const SERVICE_COLORS: Record<string, string> = {
  AI_INFERENCE: "#22c55e",
  AI_SERVICES: "#14b8a6",
  CORTEX_AGENTS: "#ef4444",
  CORTEX_CODE_DESKTOP: "#a855f7",
  CORTEX_CODE_SNOWSIGHT: "#8b5cf6",
  SNOWPARK_CONTAINER_SERVICES: "#29b5e8",
}

export function CreditsView() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [checkFilter, setCheckFilter] = useState("CREDITS_BY_WAREHOUSE")
  const [statusFilter, setStatusFilter] = useState("")
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [activeTab, setActiveTab] = useState<"warehouse" | "ai-costs">("warehouse")
  const [aiDays, setAiDays] = useState("30")
  const [aiServiceFilter, setAiServiceFilter] = useState("")

  const { data, isLoading, error } = useQuery<CreditResult[]>({
    queryKey: ["credits"],
    queryFn: () => fetch("/api/credits").then((r) => r.json()),
  })

  const { data: aiData, isLoading: aiLoading, error: aiError } = useQuery<AICostEntry[]>({
    queryKey: ["ai-costs", aiDays],
    queryFn: () => fetch(`/api/credits/ai-costs?days=${aiDays}`).then((r) => r.json()),
  })

  // Warehouse credits data
  const allResults = data || []
  const checkTypes = [...new Set(allResults.map((r) => r.checkType))].sort()
  const statuses = [...new Set(allResults.map((r) => r.status))].sort()

  const results = allResults.filter((r) => {
    if (checkFilter && r.checkType !== checkFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (dateStart && r.checkTimestamp && r.checkTimestamp.slice(0, 10) < dateStart) return false
    if (dateEnd && r.checkTimestamp && r.checkTimestamp.slice(0, 10) > dateEnd) return false
    return true
  })

  const warehouseData = results
    .filter((r) => r.groupValue)
    .reduce((acc, r) => {
      const key = r.groupValue!
      if (!acc[key]) acc[key] = { name: key, credits: 0 }
      acc[key].credits += r.metricValue || 0
      return acc
    }, {} as Record<string, { name: string; credits: number }>)

  const chartData = Object.values(warehouseData).sort((a, b) => b.credits - a.credits).slice(0, 10)

  // AI Costs data
  const allAiCosts = aiData || []
  const aiServiceTypes = useMemo(() => [...new Set(allAiCosts.map((r) => r.serviceType))].sort(), [allAiCosts])

  const filteredAiCosts = aiServiceFilter
    ? allAiCosts.filter((r) => r.serviceType === aiServiceFilter)
    : allAiCosts

  const aiChartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    for (const r of filteredAiCosts) {
      if (!byDate[r.usageDate]) byDate[r.usageDate] = {}
      byDate[r.usageDate][r.serviceType] = (byDate[r.usageDate][r.serviceType] || 0) + r.creditsUsed
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, services]) => ({ date, ...services }))
  }, [filteredAiCosts])

  const aiTotalCredits = filteredAiCosts.reduce((sum, r) => sum + r.creditsUsed, 0)

  // Daily totals for table
  const aiDailyTotals = useMemo(() => {
    const byDate: Record<string, { date: string; total: number; services: Record<string, number> }> = {}
    for (const r of filteredAiCosts) {
      if (!byDate[r.usageDate]) byDate[r.usageDate] = { date: r.usageDate, total: 0, services: {} }
      byDate[r.usageDate].total += r.creditsUsed
      byDate[r.usageDate].services[r.serviceType] = (byDate[r.usageDate].services[r.serviceType] || 0) + r.creditsUsed
    }
    return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date))
  }, [filteredAiCosts])

  const activeServices = useMemo(() => {
    const s = new Set<string>()
    for (const r of filteredAiCosts) s.add(r.serviceType)
    return [...s].sort()
  }, [filteredAiCosts])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Credits</h2>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("warehouse")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "warehouse"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Warehouse Credits
        </button>
        <button
          onClick={() => setActiveTab("ai-costs")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "ai-costs"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          AI & Agent Costs
        </button>
      </div>

      {activeTab === "warehouse" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={checkFilter}
              onChange={(e) => setCheckFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Checks</option>
              {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {isLoading && <div className="text-muted-foreground">Loading credits...</div>}
          {error && <div className="text-destructive">Failed to load credits</div>}

          {chartData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium mb-3">Credits by Group</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={80} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
                  <Bar dataKey="credits" fill="#29b5e8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Check</th>
                  <th className="text-left px-3 py-2 font-medium">Group</th>
                  <th className="text-left px-3 py-2 font-medium">Credits</th>
                  <th className="text-left px-3 py-2 font-medium">Threshold</th>
                  <th className="text-left px-3 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.slice(0, 50).map((r, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${r.status === "PASS" ? "bg-green-500" : "bg-red-500"}`} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.checkType}</td>
                    <td className="px-3 py-2 text-xs">{r.groupValue || "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.metricValue != null ? r.metricValue.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.threshold != null ? r.threshold.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(r.checkTimestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "ai-costs" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={aiDays}
              onChange={(e) => setAiDays(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <select
              value={aiServiceFilter}
              onChange={(e) => setAiServiceFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Services</option>
              {aiServiceTypes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="ml-auto text-sm font-medium">
              Total: <span className="text-primary">{aiTotalCredits.toFixed(4)} credits</span>
            </div>
          </div>

          {aiLoading && <div className="text-muted-foreground">Loading AI costs...</div>}
          {aiError && <div className="text-destructive">Failed to load AI costs</div>}

          {!aiLoading && !aiError && aiChartData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium mb-3">Daily AI & Agent Credits</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={aiChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    width={60}
                    tickFormatter={(v) => v.toFixed(2)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeServices.map((service) => (
                    <Line
                      key={service}
                      type="monotone"
                      dataKey={service}
                      name={service.replace(/_/g, " ")}
                      stroke={SERVICE_COLORS[service] || "#64748b"}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!aiLoading && !aiError && aiDailyTotals.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-left px-3 py-2 font-medium">Service</th>
                    <th className="text-left px-3 py-2 font-medium">Credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredAiCosts
                    .sort((a, b) => b.usageDate.localeCompare(a.usageDate))
                    .map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs">{r.usageDate}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERVICE_COLORS[r.serviceType] || "#64748b" }} />
                          {r.serviceType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.creditsUsed.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!aiLoading && !aiError && aiChartData.length === 0 && (
            <div className="text-muted-foreground py-8 text-center">No AI/Agent costs for selected period</div>
          )}
        </div>
      )}
    </div>
  )
}

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch {
    return iso.slice(0, 16).replace("T", " ")
  }
}
