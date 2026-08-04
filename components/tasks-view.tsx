"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Clock, CheckCircle, XCircle } from "lucide-react"

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-semibold">Tasks & Pipelines</h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("scheduled")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "scheduled"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Scheduled Tasks ({scheduledTasks.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
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
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Monitor</th>
                    <th className="text-left px-3 py-2 font-medium">Task Name</th>
                    <th className="text-left px-3 py-2 font-medium">Schedule (Cron)</th>
                    <th className="text-left px-3 py-2 font-medium">Warehouse</th>
                    <th className="text-left px-3 py-2 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scheduledTasks.map((t) => (
                    <tr key={t.monitorId} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        {t.enabled ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-xs">{t.monitorName}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.taskName}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {t.scheduleCron}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.warehouse}</td>
                      <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={t.targetTable}>{t.targetTable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "results" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-600 font-medium">{passCount} passing</span>
            {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failing</span>}
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

          {isLoading && <div className="text-muted-foreground">Loading...</div>}
          {error && <div className="text-destructive">Failed to load</div>}

          {!isLoading && !error && results.length === 0 ? (
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
