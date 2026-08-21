"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, X, Radar, ArrowUp, ArrowDown, Minus } from "lucide-react"
import { MonitorDetailPopup } from "@/components/monitor-detail-popup"
import { SeverityBadge } from "@/components/severity-badge"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"
import { formatTick } from "@/components/chart-utils"

interface Anomaly {
  resultId: number
  checkType: string
  targetTable: string
  groupValue: string | null
  groupName: string | null
  severity: string
  metricValue: number | null
  threshold: number | null
  details: Record<string, any> | null
  monitorId: number | null
  checkTimestamp: string | null
  incidentId: number | null
  isResolved: boolean
  isStaleOrphan: boolean
}

function getPSTDateOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
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

function ThresholdIndicator({ metric, threshold }: { metric: number | null; threshold: number | null }) {
  if (metric == null || threshold == null) return <span className="text-muted-foreground">—</span>
  const diff = metric - threshold
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus
  const color = diff < 0 ? "text-red-500" : diff > 0 ? "text-blue-500" : "text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${color}`} title={`Value ${formatTick(metric)} vs threshold ${formatTick(threshold)}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {formatTick(metric)}
    </span>
  )
}

function formatDetailKey(key: string): string {
  return key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function AnomalyDetailPopup({ anomaly, onClose }: { anomaly: Anomaly; onClose: () => void }) {
  const entries = anomaly.details ? Object.entries(anomaly.details) : []
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            Anomaly Details
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Check Type</span>
              <p className="font-mono text-xs mt-0.5">{anomaly.checkType}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Severity</span>
              <p className="mt-0.5"><SeverityBadge severity={anomaly.severity} /></p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Target</span>
              <p className="text-xs mt-0.5 break-all">{anomaly.targetTable}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Group</span>
              <p className="text-xs mt-0.5">{anomaly.groupValue || "—"}</p>
              {anomaly.groupName && <p className="text-xs font-medium text-foreground">{anomaly.groupName}</p>}
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Value</span>
              <p className="mt-0.5"><ThresholdIndicator metric={anomaly.metricValue} threshold={anomaly.threshold} /></p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Detected At</span>
              <p className="text-xs mt-0.5">{formatPST(anomaly.checkTimestamp)}</p>
            </div>
          </div>

          {entries.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Details</span>
              <div className="mt-1 border border-border rounded-md divide-y divide-border">
                {entries.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">{formatDetailKey(key)}</span>
                    <span className="font-mono">{typeof value === "number" ? formatTick(value) : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function AnomaliesView() {
  const today = getPSTDateOffset(0)
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [checkTypeFilter, setCheckTypeFilter] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const [hideResolved, setHideResolved] = useState(true)
  const [viewing, setViewing] = useState<Anomaly | null>(null)
  const [viewingMonitorId, setViewingMonitorId] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery<Anomaly[]>({
    queryKey: ["anomalies", dateStart, dateEnd],
    queryFn: () => fetch(`/api/anomalies?dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
  })

  const allAnomalies = data || []
  const checkTypes = [...new Set(allAnomalies.map((a) => a.checkType))].sort()
  const severities = [...new Set(allAnomalies.map((a) => a.severity))].sort()

  const resolvedCount = allAnomalies.filter((a) => a.isResolved).length
  const staleOrphanCount = allAnomalies.filter((a) => a.isStaleOrphan).length

  const anomalies = allAnomalies.filter((a) => {
    if (hideResolved && (a.isResolved || a.isStaleOrphan)) return false
    if (checkTypeFilter && a.checkType !== checkTypeFilter) return false
    if (severityFilter && a.severity !== severityFilter) return false
    if (targetFilter && !a.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (groupFilter && !(a.groupValue || "").toLowerCase().includes(groupFilter.toLowerCase()) && !(a.groupName || "").toLowerCase().includes(groupFilter.toLowerCase())) return false
    return true
  })

  const columns: TableColumn[] = [
    {
      key: "checkTimestamp",
      label: "Detected At",
      className: "text-xs whitespace-nowrap",
      render: (val) => formatPST(val),
    },
    {
      key: "severity",
      label: "Severity",
      render: (_, row) => (
        <div className="flex items-center gap-1.5">
          <SeverityBadge severity={row.severity} />
          {(row as any).isResolved && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 whitespace-nowrap">
              Resolved
            </span>
          )}
          {(row as any).isStaleOrphan && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap"
              title="No incident was ever opened for this result -- it self-corrected before the next incident sync cycle"
            >
              Self-corrected
            </span>
          )}
        </div>
      ),
    },
    {
      key: "checkType",
      label: "Check Type",
      className: "font-mono text-xs",
    },
    {
      key: "targetTable",
      label: "Target",
      className: "max-w-[200px] truncate text-xs",
      render: (val) => <span title={val}>{val}</span>,
    },
    {
      key: "groupValue",
      label: "Group",
      className: "text-xs",
      hideOnMobile: true,
      render: (val, row) => val ? (
        <span>{(row as any).groupName ? <><span className="font-medium text-foreground">{(row as any).groupName}</span>{" "}<span className="text-muted-foreground">({val})</span></> : val}</span>
      ) : "—",
    },
    {
      key: "metricValue",
      label: "vs Threshold",
      className: "text-xs",
      render: (_, row) => <ThresholdIndicator metric={(row as any).metricValue} threshold={(row as any).threshold} />,
    },
    {
      key: "action",
      label: "Action",
      render: (_, row) => (
        <div className="flex items-center gap-1.5">
          {(row as any).monitorId != null && (
            <button
              onClick={(e) => { e.stopPropagation(); setViewingMonitorId((row as any).monitorId) }}
              className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded hover:bg-accent transition-colors min-h-[32px]"
              title="View Monitor"
            >
              <Radar className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-semibold">
          Anomalies ({anomalies.length})
          {(resolvedCount > 0 || staleOrphanCount > 0) && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {resolvedCount} resolved, {staleOrphanCount} self-corrected {hideResolved ? "hidden" : "shown"}
            </span>
          )}
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
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
        <select
          value={checkTypeFilter}
          onChange={(e) => setCheckTypeFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Check Types</option>
          {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Severities</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Search target..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-40"
        />
        <input
          type="text"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          placeholder="Search group..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-36"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap px-1">
          <input
            type="checkbox"
            checked={hideResolved}
            onChange={(e) => setHideResolved(e.target.checked)}
            className="rounded border-input"
          />
          Hide resolved
        </label>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading anomalies...</div>}
      {error && <div className="text-destructive">Failed to load anomalies</div>}

      {!isLoading && !error && (
        <ResponsiveTable
          columns={columns}
          data={anomalies}
          keyField="resultId"
          onRowClick={(row) => setViewing(row)}
          emptyMessage="No anomalies for selected filters"
        />
      )}

      {viewing && (
        <AnomalyDetailPopup anomaly={viewing} onClose={() => setViewing(null)} />
      )}

      {viewingMonitorId != null && (
        <MonitorDetailPopup
          monitorId={viewingMonitorId}
          onClose={() => setViewingMonitorId(null)}
        />
      )}
    </div>
  )
}
