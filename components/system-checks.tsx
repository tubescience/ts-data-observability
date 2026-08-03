"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

interface Check {
  resultId: number
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  severity: string | null
  groupValue: string | null
  checkTimestamp: string | null
}

export function SystemChecks() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [statusFilter, setStatusFilter] = useState("")
  const [checkTypeFilter, setCheckTypeFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)

  const { data, isLoading, error } = useQuery<Check[]>({
    queryKey: ["checks"],
    queryFn: () => fetch("/api/checks").then((r) => r.json()),
  })

  if (isLoading) return <div className="text-muted-foreground">Loading system checks...</div>
  if (error) return <div className="text-destructive">Failed to load checks</div>

  const allChecks = data || []
  const statuses = [...new Set(allChecks.map((c) => c.status))].sort()
  const checkTypes = [...new Set(allChecks.map((c) => c.checkType))].sort()

  const checks = allChecks.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false
    if (checkTypeFilter && c.checkType !== checkTypeFilter) return false
    if (targetFilter && !c.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (dateStart && c.checkTimestamp && c.checkTimestamp.slice(0, 10) < dateStart) return false
    if (dateEnd && c.checkTimestamp && c.checkTimestamp.slice(0, 10) > dateEnd) return false
    return true
  })

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">System Checks (Last 24h)</h2>

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
          value={checkTypeFilter}
          onChange={(e) => setCheckTypeFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Check Types</option>
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

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Check Type</th>
              <th className="text-left px-3 py-2 font-medium">Target</th>
              <th className="text-left px-3 py-2 font-medium">Value</th>
              <th className="text-left px-3 py-2 font-medium">Threshold</th>
              <th className="text-left px-3 py-2 font-medium">Time (PST)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {checks.map((c) => (
              <tr key={c.resultId} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{c.checkType}</td>
                <td className="px-3 py-2 max-w-[200px] truncate text-xs" title={c.targetTable}>
                  {c.targetTable}
                </td>
                <td className="px-3 py-2 text-xs">{c.metricValue != null ? c.metricValue.toFixed(2) : "—"}</td>
                <td className="px-3 py-2 text-xs">{c.threshold != null ? c.threshold.toFixed(2) : "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(c.checkTimestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PASS: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    FAIL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    ERROR: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    ANOMALY: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    SKIP: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    RESOLVED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-800"}`}>
      {status}
    </span>
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
