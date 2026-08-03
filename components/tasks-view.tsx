"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

interface TaskResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  severity: string | null
  groupValue: string | null
  checkTimestamp: string | null
}

export function TasksView() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [statusFilter, setStatusFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)

  const { data, isLoading, error } = useQuery<TaskResult[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch("/api/tasks").then((r) => r.json()),
  })

  if (isLoading) return <div className="text-muted-foreground">Loading tasks...</div>
  if (error) return <div className="text-destructive">Failed to load tasks</div>

  const allResults = data || []
  const statuses = [...new Set(allResults.map((r) => r.status))].sort()
  const checkTypes = [...new Set(allResults.map((r) => r.checkType))].sort()

  const results = allResults.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false
    if (checkFilter && r.checkType !== checkFilter) return false
    if (targetFilter && !r.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (dateStart && r.checkTimestamp && r.checkTimestamp.slice(0, 10) < dateStart) return false
    if (dateEnd && r.checkTimestamp && r.checkTimestamp.slice(0, 10) > dateEnd) return false
    return true
  })

  const passCount = results.filter((r) => r.status === "PASS").length
  const failCount = results.filter((r) => r.status === "FAIL" || r.status === "ERROR").length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-semibold">Tasks & Pipelines</h2>
        <span className="text-sm text-green-600 font-medium">{passCount} passing</span>
        {failCount > 0 && <span className="text-sm text-red-600 font-medium">{failCount} failing</span>}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={checkFilter}
          onChange={(e) => setCheckFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Types</option>
          {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Filter target..."
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
        />
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
      </div>

      {results.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center">No results for selected filters</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Target</th>
                <th className="text-left px-3 py-2 font-medium">Group</th>
                <th className="text-left px-3 py-2 font-medium">Time (PST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {results.map((r, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${statusColor(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.checkType}</td>
                  <td className="px-3 py-2 text-xs max-w-[250px] truncate" title={r.targetTable}>{r.targetTable}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.groupValue || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(r.checkTimestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    PASS: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    FAIL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    ERROR: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  }
  return colors[status] || "bg-gray-100 text-gray-800"
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
