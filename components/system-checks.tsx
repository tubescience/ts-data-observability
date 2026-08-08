"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

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

  const columns: TableColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (_, row) => <StatusBadge status={row.status} />,
    },
    { key: "checkType", label: "Check Type", className: "font-mono text-xs" },
    {
      key: "targetTable",
      label: "Target",
      className: "max-w-[200px] truncate text-xs",
      render: (val) => <span title={val}>{val}</span>,
    },
    {
      key: "metricValue",
      label: "Value",
      className: "text-xs",
      render: (val) => val != null ? val.toFixed(2) : "—",
    },
    {
      key: "threshold",
      label: "Threshold",
      className: "text-xs",
      hideOnMobile: true,
      render: (val) => val != null ? val.toFixed(2) : "—",
    },
    {
      key: "checkTimestamp",
      label: "Time (PST)",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">System Checks (Last 24h)</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={checkTypeFilter}
          onChange={(e) => setCheckTypeFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Check Types</option>
          {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Filter target..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-48"
        />
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
      </div>

      <ResponsiveTable
        columns={columns}
        data={checks}
        keyField="resultId"
        emptyMessage="No checks for selected filters"
      />
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
