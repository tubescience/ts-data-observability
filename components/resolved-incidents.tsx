"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ResolvedIncidentDetail } from "@/components/resolved-incident-detail"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"
import { useTagColors, TagBadges } from "@/components/tag-colors"

interface ResolvedIncident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  tags: string[]
  severity: string
  failureCount: number
  resolutionNotes: string | null
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
      render: (_, row) => (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${severityColor(row.severity)}`}>
          {row.severity}
        </span>
      ),
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

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch {
    return iso.slice(0, 16).replace("T", " ")
  }
}
