"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

interface CreditResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  checkTimestamp: string | null
}

export function CreditsView() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [checkFilter, setCheckFilter] = useState("CREDITS_BY_WAREHOUSE")
  const [statusFilter, setStatusFilter] = useState("")
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)

  const { data, isLoading, error } = useQuery<CreditResult[]>({
    queryKey: ["credits"],
    queryFn: () => fetch("/api/credits").then((r) => r.json()),
  })

  if (isLoading) return <div className="text-muted-foreground">Loading credits...</div>
  if (error) return <div className="text-destructive">Failed to load credits</div>

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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Credits Status</h2>

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

      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Credits by Group</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={80} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
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
