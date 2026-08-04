"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, XCircle, ChevronDown, ChevronRight, BarChart3 } from "lucide-react"
import { MonitorHistory } from "@/components/monitor-history"

interface Check {
  configId: number
  checkType: string
  enabled: boolean
  severity: string
  thresholdPct: number | null
  thresholdValue: number | null
  dateColumn: string | null
  keyColumns: string | null
  nullColumns: string | null
  sumColumn: string | null
  groupByColumn: string | null
}

interface Monitor {
  monitorId: number
  monitorName: string
  targetDatabase: string
  targetSchema: string
  targetTable: string
  enabled: boolean
  owner: string
  description: string | null
  scheduleCron: string | null
  warehouse: string | null
  taskName: string | null
  createdAt: string | null
  checks: Check[]
}

export function MonitorsView() {
  const { data, isLoading, error } = useQuery<Monitor[]>({
    queryKey: ["monitors"],
    queryFn: () => fetch("/api/monitors").then((r) => r.json()),
  })

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>("")  
  const [historyMonitor, setHistoryMonitor] = useState<Monitor | null>(null)

  if (isLoading) return <div className="text-muted-foreground">Loading monitors...</div>
  if (error) return <div className="text-destructive">Failed to load monitors</div>

  const allMonitors = data || []

  const allCheckTypes = [...new Set(allMonitors.flatMap((m) => m.checks.map((c) => c.checkType)))].sort()

  const monitors = allMonitors.filter((m) => {
    if (statusFilter === "enabled" && !m.enabled) return false
    if (statusFilter === "disabled" && m.enabled) return false
    if (checkTypeFilter && !m.checks.some((c) => c.checkType === checkTypeFilter)) return false
    return true
  })

  const enabledCount = monitors.filter((m) => m.enabled).length

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-semibold">Monitors ({monitors.length})</h2>
        <span className="text-sm text-muted-foreground">{enabledCount} enabled</span>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Statuses</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          value={checkTypeFilter}
          onChange={(e) => setCheckTypeFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Check Types</option>
          {allCheckTypes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {monitors.map((m) => (
          <div key={m.monitorId} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(m.monitorId)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
            >
              {expanded.has(m.monitorId) ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              {m.enabled ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium">{m.monitorName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.targetDatabase}.{m.targetSchema}.{m.targetTable}
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {m.checks.length} check{m.checks.length !== 1 ? "s" : ""}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 hidden md:block">
                {m.scheduleCron || "—"}
              </div>
            </button>

            {expanded.has(m.monitorId) && (
              <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div><span className="text-muted-foreground">Owner:</span> {m.owner}</div>
                    <div><span className="text-muted-foreground">Warehouse:</span> {m.warehouse || "—"}</div>
                    <div><span className="text-muted-foreground">Schedule:</span> {m.scheduleCron || "—"}</div>
                    <div><span className="text-muted-foreground">Task:</span> {m.taskName || "—"}</div>
                  </div>
                  <button
                    onClick={() => setHistoryMonitor(m)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    History
                  </button>
                </div>
                {m.description && (
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                )}

                {m.checks.length > 0 && (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Enabled</th>
                          <th className="text-left px-2 py-1.5 font-medium">Check Type</th>
                          <th className="text-left px-2 py-1.5 font-medium">Severity</th>
                          <th className="text-left px-2 py-1.5 font-medium">Threshold</th>
                          <th className="text-left px-2 py-1.5 font-medium">Columns</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {m.checks.map((c) => (
                          <tr key={c.configId} className="hover:bg-muted/30">
                            <td className="px-2 py-1.5">
                              {c.enabled ? (
                                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{c.checkType}</td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex px-1.5 py-0.5 rounded font-medium ${severityColor(c.severity)}`}>
                                {c.severity}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              {c.thresholdPct != null && `${c.thresholdPct}%`}
                              {c.thresholdValue != null && c.thresholdPct == null && c.thresholdValue}
                              {c.thresholdPct == null && c.thresholdValue == null && "—"}
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {[c.dateColumn, c.keyColumns, c.nullColumns, c.sumColumn, c.groupByColumn]
                                .filter(Boolean)
                                .join(", ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {historyMonitor && (
        <MonitorHistory
          monitorId={historyMonitor.monitorId}
          monitorName={historyMonitor.monitorName}
          targetTable={`${historyMonitor.targetDatabase}.${historyMonitor.targetSchema}.${historyMonitor.targetTable}`}
          onClose={() => setHistoryMonitor(null)}
        />
      )}
    </div>
  )
}

function severityColor(severity: string): string {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  }
  return colors[severity] || "bg-gray-100 text-gray-800"
}
