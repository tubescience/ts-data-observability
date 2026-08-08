"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Clock, CheckCircle, XCircle } from "lucide-react"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

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

interface ScheduledTask {
  monitorId: number
  monitorName: string
  taskName: string
  scheduleCron: string
  enabled: boolean
  warehouse: string
  targetTable: string
}

export function TasksView() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [statusFilter, setStatusFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [activeTab, setActiveTab] = useState<"results" | "scheduled">("scheduled")

  const { data, isLoading, error } = useQuery<TaskResult[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch("/api/tasks").then((r) => r.json()),
  })

  const { data: scheduledData, isLoading: scheduledLoading } = useQuery<ScheduledTask[]>({
    queryKey: ["tasks-scheduled"],
    queryFn: () => fetch("/api/tasks/scheduled").then((r) => r.json()),
  })

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

  const scheduledTasks = scheduledData || []
  const enabledTasks = scheduledTasks.filter((t) => t.enabled).length

  const scheduledColumns: TableColumn[] = [
    {
      key: "enabled",
      label: "Status",
      render: (val) => val ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />,
    },
    { key: "monitorName", label: "Monitor", className: "font-medium text-xs" },
    { key: "taskName", label: "Task", className: "font-mono text-xs", hideOnMobile: true },
    {
      key: "scheduleCron",
      label: "Schedule",
      className: "text-xs",
      render: (val) => (
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3 text-muted-foreground" />
          {val}
        </span>
      ),
    },
    { key: "warehouse", label: "Warehouse", className: "text-xs text-muted-foreground", hideOnMobile: true },
    {
      key: "targetTable",
      label: "Target",
      className: "text-xs max-w-[200px] truncate",
      render: (val) => <span title={val}>{val}</span>,
    },
  ]

  const resultsColumns: TableColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (_, row) => (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${statusColor(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    { key: "checkType", label: "Type", className: "font-mono text-xs" },
    {
      key: "targetTable",
      label: "Target",
      className: "text-xs max-w-[250px] truncate",
      render: (val) => <span title={val}>{val}</span>,
    },
    { key: "groupValue", label: "Group", className: "text-xs text-muted-foreground", hideOnMobile: true, render: (val) => val || "—" },
    {
      key: "checkTimestamp",
      label: "Time (PST)",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">Tasks & Pipelines</h2>

      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab("scheduled")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === "scheduled"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Scheduled ({scheduledTasks.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === "results"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Check Results
        </button>
      </div>

      {activeTab === "scheduled" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-600 font-medium">{enabledTasks} enabled</span>
            {scheduledTasks.length - enabledTasks > 0 && (
              <span className="text-muted-foreground">{scheduledTasks.length - enabledTasks} disabled</span>
            )}
          </div>
          {scheduledLoading ? (
            <div className="text-muted-foreground">Loading scheduled tasks...</div>
          ) : (
            <ResponsiveTable columns={scheduledColumns} data={scheduledTasks} keyField="monitorId" />
          )}
        </div>
      )}

      {activeTab === "results" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-600 font-medium">{passCount} passing</span>
            {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failing</span>}
          </div>

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
              value={checkFilter}
              onChange={(e) => setCheckFilter(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
            >
              <option value="">All Types</option>
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

          {isLoading && <div className="text-muted-foreground">Loading...</div>}
          {error && <div className="text-destructive">Failed to load</div>}

          {!isLoading && !error && (
            <ResponsiveTable columns={resultsColumns} data={results} emptyMessage="No results for selected filters" />
          )}
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
