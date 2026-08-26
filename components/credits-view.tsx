"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts"
import { getYAxisWidth, formatTick, ChartTooltip } from "@/components/chart-utils"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

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
  userName?: string | null
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
  const [aiStartDate, setAiStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [aiEndDate, setAiEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [aiUserFilter, setAiUserFilter] = useState("")
  const [aiServiceFilter, setAiServiceFilter] = useState("")

  const { data, isLoading, error } = useQuery<CreditResult[]>({
    queryKey: ["credits"],
    queryFn: () => fetch("/api/credits").then((r) => r.json()),
  })

  const { data: aiResponse, isLoading: aiLoading, error: aiError } = useQuery<{ data: AICostEntry[]; users: string[] }>({
    queryKey: ["ai-costs", aiStartDate, aiEndDate, aiUserFilter],
    queryFn: () => {
      const params = new URLSearchParams({ startDate: aiStartDate, endDate: aiEndDate })
      if (aiUserFilter) params.set("user", aiUserFilter)
      return fetch(`/api/credits/ai-costs?${params}`).then((r) => r.json())
    },
  })

  const aiData = aiResponse?.data || []
  const aiUsers = aiResponse?.users || []

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

  const sortedResults = [...results].sort((a, b) => {
    const creditsDiff = (b.metricValue ?? 0) - (a.metricValue ?? 0)
    if (creditsDiff !== 0) return creditsDiff
    const checkDiff = a.checkType.localeCompare(b.checkType)
    if (checkDiff !== 0) return checkDiff
    const groupDiff = (a.groupValue || "").localeCompare(b.groupValue || "")
    if (groupDiff !== 0) return groupDiff
    return (b.checkTimestamp || "").localeCompare(a.checkTimestamp || "")
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

  const allAiCosts = aiData
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

  const activeServices = useMemo(() => {
    const s = new Set<string>()
    for (const r of filteredAiCosts) s.add(r.serviceType)
    return [...s].sort()
  }, [filteredAiCosts])

  const warehouseColumns: TableColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (_, row) => <span className={`inline-block w-2 h-2 rounded-full ${row.status === "PASS" ? "bg-green-500" : "bg-red-500"}`} />,
    },
    { key: "checkType", label: "Check", className: "font-mono text-xs", hideOnMobile: true },
    { key: "groupValue", label: "Group", className: "text-xs", render: (val) => val || "—" },
    { key: "metricValue", label: "Credits", className: "text-xs", render: (val) => val != null ? val.toFixed(2) : "—" },
    { key: "threshold", label: "Threshold", className: "text-xs", hideOnMobile: true, render: (val) => val != null ? val.toFixed(2) : "—" },
    { key: "checkTimestamp", label: "Time", className: "text-xs text-muted-foreground", render: (val) => formatPST(val) },
  ]

  const aiColumns: TableColumn[] = [
    { key: "usageDate", label: "Date", className: "text-xs" },
    {
      key: "serviceType",
      label: "Service",
      className: "text-xs",
      render: (val) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SERVICE_COLORS[val] || "#64748b" }} />
          <span className="truncate">{val.replace(/_/g, " ")}</span>
        </span>
      ),
    },
    { key: "creditsUsed", label: "Credits", className: "font-mono text-xs", render: (val) => val.toFixed(6) },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold">Credits</h2>

      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab("warehouse")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === "warehouse" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Warehouse Credits
        </button>
        <button
          onClick={() => setActiveTab("ai-costs")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === "ai-costs" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          AI & Agent Costs
        </button>
      </div>

      {activeTab === "warehouse" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
            <select value={checkFilter} onChange={(e) => setCheckFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
              <option value="">All Checks</option>
              {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex items-center gap-1 text-xs text-muted-foreground col-span-1 sm:col-span-2 md:col-span-1">
              <span>From</span>
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
                className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none" />
              <span>To</span>
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
                className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
              <option value="">All Statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {isLoading && <div className="text-muted-foreground">Loading credits...</div>}
          {error && <div className="text-destructive">Failed to load credits</div>}

          {chartData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
              <h3 className="text-sm font-medium mb-3">Credits by Group</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" width={60} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
                  <Bar dataKey="credits" fill="#29b5e8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <ResponsiveTable columns={warehouseColumns} data={sortedResults.slice(0, 50)} />
        </div>
      )}

      {activeTab === "ai-costs" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
            <input
              type="date"
              value={aiStartDate}
              onChange={(e) => setAiStartDate(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
            />
            <input
              type="date"
              value={aiEndDate}
              onChange={(e) => setAiEndDate(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
            />
            <select value={aiUserFilter} onChange={(e) => setAiUserFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
              <option value="">All Users</option>
              {aiUsers.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={aiServiceFilter} onChange={(e) => setAiServiceFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
              <option value="">All Services</option>
              {aiServiceTypes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="sm:ml-auto text-sm font-medium">
              Total: <span className="text-primary">{aiTotalCredits.toFixed(4)} credits</span>
            </div>
          </div>

          {aiLoading && <div className="text-muted-foreground">Loading AI costs...</div>}
          {aiError && <div className="text-destructive">Failed to load AI costs</div>}

          {!aiLoading && !aiError && aiChartData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
              <h3 className="text-sm font-medium mb-3">Daily AI & Agent Credits</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={aiChartData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50} tickFormatter={(v) => v.toFixed(2)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {activeServices.map((service) => (
                    <Line
                      key={service}
                      type="monotone"
                      dataKey={service}
                      name={service.replace(/_/g, " ")}
                      stroke={SERVICE_COLORS[service] || "#64748b"}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!aiLoading && !aiError && filteredAiCosts.length > 0 && (
            <ResponsiveTable
              columns={aiColumns}
              data={filteredAiCosts.sort((a, b) => b.usageDate.localeCompare(a.usageDate))}
            />
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
