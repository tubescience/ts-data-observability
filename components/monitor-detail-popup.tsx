"use client"

import { useQuery } from "@tanstack/react-query"
import { X, Radar, CheckCircle, XCircle } from "lucide-react"
import { useTagColors, TagBadge } from "@/components/tag-colors"
import { SeverityBadge } from "@/components/severity-badge"

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
  tags: string[]
  lastRun: string | null
  checks: Check[]
}

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch { return "—" }
}

export function MonitorDetailPopup({ monitorId, onClose }: { monitorId: number; onClose: () => void }) {
  const tagColors = useTagColors()
  const { data, isLoading, error } = useQuery<Monitor[]>({
    queryKey: ["monitors"],
    queryFn: () => fetch("/api/monitors").then((r) => r.json()),
  })

  const monitor = (data || []).find((m) => m.monitorId === monitorId)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] sm:p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-semibold flex items-center gap-2">
            <Radar className="w-4 h-4 text-primary shrink-0" />
            Monitor
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2 -mr-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {isLoading && <div className="text-muted-foreground py-8 text-center">Loading monitor...</div>}
          {error && <div className="text-destructive py-4 text-center">Failed to load monitor</div>}

          {!isLoading && !error && !monitor && (
            <div className="text-muted-foreground py-8 text-center">
              Monitor {monitorId} not found — it may have been renamed or removed.
            </div>
          )}

          {monitor && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {monitor.enabled ? (
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    {monitor.monitorName}
                    <span className="text-xs font-normal text-muted-foreground">#{monitor.monitorId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 break-all">
                    {monitor.targetDatabase}.{monitor.targetSchema}.{monitor.targetTable}
                  </div>
                </div>
                {monitor.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {monitor.tags.map((t) => (
                      <TagBadge key={t} tag={t} colorMap={tagColors} />
                    ))}
                  </div>
                )}
              </div>

              {monitor.description && (
                <div className="text-xs text-muted-foreground">{monitor.description}</div>
              )}

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Owner:</span> {monitor.owner}</div>
                <div><span className="text-muted-foreground">Warehouse:</span> {monitor.warehouse || "—"}</div>
                <div><span className="text-muted-foreground">Schedule:</span> {monitor.scheduleCron || "—"}</div>
                <div><span className="text-muted-foreground">Last Run:</span> {formatPST(monitor.lastRun)}</div>
                <div><span className="text-muted-foreground">Task:</span> {monitor.taskName || "—"}</div>
              </div>

              {monitor.checks.length > 0 && (
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
                      {monitor.checks.map((c) => (
                        <tr key={c.configId} className="hover:bg-muted/30">
                          <td className="px-2 py-1.5">
                            {c.enabled ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          </td>
                          <td className="px-2 py-1.5 font-mono">{c.checkType}</td>
                          <td className="px-2 py-1.5">
                            <SeverityBadge severity={c.severity} />
                          </td>
                          <td className="px-2 py-1.5">
                            {c.thresholdPct != null && `${c.thresholdPct}%`}
                            {c.thresholdValue != null && c.thresholdPct == null && c.thresholdValue}
                            {c.thresholdPct == null && c.thresholdValue == null && "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {[c.dateColumn, c.keyColumns, c.nullColumns, c.sumColumn, c.groupByColumn].filter(Boolean).join(", ") || "—"}
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
      </div>
    </div>
  )
}
