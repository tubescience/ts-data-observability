"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Radar, Lightbulb } from "lucide-react"
import { ResolvedIncidentDetail } from "@/components/resolved-incident-detail"
import { MonitorDetailPopup } from "@/components/monitor-detail-popup"
import { SuggestedResolutionPopup } from "@/components/suggested-resolution-popup"
import { SeverityBadge } from "@/components/severity-badge"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"
import { useTagColors, TagBadges } from "@/components/tag-colors"

interface ResolvedIncident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  monitorId: number | null
  tags: string[]
  severity: string
  failureCount: number
  resolutionNotes: string | null
  suggestedResolution: string | null
  suggestedResolutionReason: string | null
  firstSeen: string | null
  lastSeen: string | null
  resolvedAt: string | null
}

function getPSTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

export function ResolvedIncidents() {
  const tagColors = useTagColors()
  const today = getPSTToday()
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [severityFilter, setSeverityFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const [viewing, setViewing] = useState<ResolvedIncident | null>(null)
  const [viewingMonitorId, setViewingMonitorId] = useState<number | null>(null)
  const [viewingSuggestion, setViewingSuggestion] = useState<ResolvedIncident | null>(null)

  const { data, isLoading, error } = useQuery<ResolvedIncident[]>({
    queryKey: ["incidents-resolved", dateStart, dateEnd],
    queryFn: () => fetch(`/api/incidents/resolved?dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
  })

  const allIncidents = data || []
  const severities = [...new Set(allIncidents.map((i) => i.severity))].sort()
  const checkTypes = [...new Set(allIncidents.map((i) => i.checkType))].sort()
  const allTags = [...new Set(allIncidents.flatMap((i) => i.tags || []))].sort()

  const incidents = allIncidents.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (checkFilter && i.checkType !== checkFilter) return false
    if (targetFilter && !i.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (tagFilter && !(i.tags || []).includes(tagFilter)) return false
    return true
  })

  const columns: TableColumn[] = [
    {
      key: "severity",
      label: "Severity",
      render: (_, row) => <SeverityBadge severity={row.severity} />,
    },
    { key: "checkType", label: "Check Type", className: "font-mono text-xs" },
    {
      key: "targetTable",
      label: "Target",
      className: "max-w-[200px] truncate text-xs",
      render: (val) => <span title={val}>{val}</span>,
    },
    {
      key: "resolvedAt",
      label: "Resolved At",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
    {
      key: "tags",
      label: "Tags",
      className: "text-xs",
      hideOnMobile: true,
      render: (_, row) => <TagBadges tags={(row as any).tags || []} colorMap={tagColors} />,
    },
    {
      key: "resolutionNotes",
      label: "Notes",
      className: "text-xs max-w-[250px] truncate",
      hideOnMobile: true,
      render: (val) => val || "—",
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
            onClick={(e) => { e.stopPropagation(); setViewingSuggestion(row) }}
            className={`p-1.5 border border-border rounded hover:bg-accent transition-colors min-h-[32px] ${
              (row as any).suggestedResolution ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
            title={(row as any).suggestedResolution ? "View Suggested Resolution" : "No suggested resolution"}
          >
            <Lightbulb className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">Resolved Incidents</h2>

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
          placeholder="Filter target..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-48"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading...</div>}
      {error && <div className="text-destructive">Failed to load</div>}

      {!isLoading && !error && (
        <ResponsiveTable
          columns={columns}
          data={incidents}
          keyField="incidentId"
          onRowClick={(row) => setViewing(row)}
          emptyMessage="No resolved incidents for selected filters"
        />
      )}

      {viewing && (
        <ResolvedIncidentDetail
          incident={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {viewingMonitorId != null && (
        <MonitorDetailPopup
          monitorId={viewingMonitorId}
          onClose={() => setViewingMonitorId(null)}
        />
      )}

      {viewingSuggestion && (
        <SuggestedResolutionPopup
          resolution={viewingSuggestion.suggestedResolution}
          reason={viewingSuggestion.suggestedResolutionReason}
          onClose={() => setViewingSuggestion(null)}
        />
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
