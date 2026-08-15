"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, Radar, Copy, Check } from "lucide-react"
import { useTagColors, TagBadges } from "@/components/tag-colors"
import { IncidentDetail } from "@/components/incident-detail"
import { MonitorDetailPopup } from "@/components/monitor-detail-popup"
import { SeverityBadge } from "@/components/severity-badge"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

interface Incident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  groupName: string | null
  monitorId: number | null
  tags: string[]
  severity: string
  status: string
  failureCount: number
  lastMetric: number | null
  lastThreshold: number | null
  firstSeen: string | null
  lastSeen: string | null
}

function getPSTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

export function OpenIncidents() {
  const tagColors = useTagColors()
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [viewing, setViewing] = useState<Incident | null>(null)
  const [viewingMonitorId, setViewingMonitorId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const today = getPSTToday()
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [dateStart, setDateStart] = useState(sixtyDaysAgo)
  const [dateEnd, setDateEnd] = useState(today)
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery<Incident[]>({
    queryKey: ["incidents-open"],
    queryFn: () => fetch("/api/incidents/open").then((r) => r.json()),
  })

  const resolveMutation = useMutation({
    mutationFn: async ({ incidentId, resolutionNotes }: { incidentId: number; resolutionNotes: string }) => {
      const res = await fetch("/api/incidents/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, resolutionNotes }),
      })
      if (!res.ok) throw new Error("Failed to resolve incident")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents-open"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      setResolving(null)
      setNotes("")
    },
  })

  if (isLoading) return <div className="text-muted-foreground">Loading open incidents...</div>
  if (error) return <div className="text-destructive">Failed to load incidents</div>

  const allIncidents = data || []
  const severities = [...new Set(allIncidents.map((i) => i.severity))].sort()
  const checkTypes = [...new Set(allIncidents.map((i) => i.checkType))].sort()
  const allTags = [...new Set(allIncidents.flatMap((i) => i.tags))].sort()

  const incidents = allIncidents.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (checkFilter && i.checkType !== checkFilter) return false
    if (targetFilter && !i.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (groupFilter && !(i.groupValue || "").toLowerCase().includes(groupFilter.toLowerCase()) && !(i.groupName || "").toLowerCase().includes(groupFilter.toLowerCase())) return false
    if (tagFilter && !i.tags.includes(tagFilter)) return false
    if (dateStart && i.lastSeen && i.lastSeen.slice(0, 10) < dateStart) return false
    if (dateEnd && i.lastSeen && i.lastSeen.slice(0, 10) > dateEnd) return false
    return true
  })

  const columns: TableColumn[] = [
    {
      key: "incidentId",
      label: "ID",
      className: "text-xs font-mono",
      render: (val) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(val)); setCopiedId(val); setTimeout(() => setCopiedId(null), 1500) }}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy Incident ID"
        >
          <span>#{val}</span>
          {copiedId === val ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      ),
    },
    {
      key: "severity",
      label: "Severity",
      render: (_, row) => <SeverityBadge severity={row.severity} />,
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
      key: "tags",
      label: "Tags",
      className: "text-xs",
      hideOnMobile: true,
      render: (_, row) => <TagBadges tags={(row as any).tags || []} colorMap={tagColors} />,
    },
    {
      key: "failureCount",
      label: "Failures",
      className: "text-xs",
    },
    {
      key: "firstSeen",
      label: "First Seen",
      className: "text-xs text-muted-foreground",
      hideOnMobile: true,
      render: (val) => formatPST(val),
    },
    {
      key: "lastSeen",
      label: "Last Seen",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
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
          <button
            onClick={(e) => { e.stopPropagation(); setResolving(row) }}
            className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors min-h-[32px]"
          >
            Resolve
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-semibold">Open Incidents ({incidents.length})</h2>
      </div>

      {/* Responsive filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Severities</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={checkFilter}
          onChange={(e) => setCheckFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Check Types</option>
          {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
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
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
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
        data={incidents}
        keyField="incidentId"
        onRowClick={(row) => setViewing(row)}
        emptyMessage="No open incidents for selected filters"
      />

      {viewing && (
        <IncidentDetail
          incident={viewing}
          onClose={() => setViewing(null)}
          onResolve={(inc) => { setViewing(null); setResolving(inc) }}
        />
      )}

      {viewingMonitorId != null && (
        <MonitorDetailPopup
          monitorId={viewingMonitorId}
          onClose={() => setViewingMonitorId(null)}
        />
      )}

      {resolving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Resolve Incident</h3>
              <button onClick={() => { setResolving(null); setNotes("") }} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Check:</span> {resolving.checkType}</div>
                <div className="break-all"><span className="text-muted-foreground">Target:</span> {resolving.targetTable}</div>
                <div><span className="text-muted-foreground">Severity:</span> <SeverityBadge severity={resolving.severity} /></div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Resolution / Action Taken</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-input rounded-md p-3 text-sm bg-background min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Describe the resolution or action taken..."
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => { setResolving(null); setNotes("") }}
                className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resolveMutation.mutate({ incidentId: resolving.incidentId, resolutionNotes: notes })}
                disabled={!notes.trim() || resolveMutation.isPending}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {resolveMutation.isPending ? "Saving..." : "Save Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
