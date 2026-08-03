"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

interface ResolvedIncident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
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
  const today = getPSTToday()
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [severityFilter, setSeverityFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")

  const { data, isLoading, error } = useQuery<ResolvedIncident[]>({
    queryKey: ["incidents-resolved", dateStart, dateEnd],
    queryFn: () => fetch(`/api/incidents/resolved?dateStart=${dateStart}&dateEnd=${dateEnd}`).then((r) => r.json()),
  })

  const allIncidents = data || []
  const severities = [...new Set(allIncidents.map((i) => i.severity))].sort()
  const checkTypes = [...new Set(allIncidents.map((i) => i.checkType))].sort()

  const incidents = allIncidents.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (checkFilter && i.checkType !== checkFilter) return false
    if (targetFilter && !i.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Resolved Incidents</h2>

      <div className="flex flex-wrap gap-3 items-center">
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
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Severities</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={checkFilter}
          onChange={(e) => setCheckFilter(e.target.value)}
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
      </div>

      {isLoading && <div className="text-muted-foreground">Loading...</div>}
      {error && <div className="text-destructive">Failed to load</div>}

      {!isLoading && !error && incidents.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">No resolved incidents for selected filters</div>
      )}

      {incidents.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-left px-3 py-2 font-medium">Check Type</th>
                <th className="text-left px-3 py-2 font-medium">Target</th>
                <th className="text-left px-3 py-2 font-medium">Resolved At (PST)</th>
                <th className="text-left px-3 py-2 font-medium">Resolution Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {incidents.map((incident) => (
                <tr key={incident.incidentId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${severityColor(incident.severity)}`}>
                      {incident.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{incident.checkType}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={incident.targetTable}>
                    {incident.targetTable}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(incident.resolvedAt)}</td>
                  <td className="px-3 py-2 text-xs max-w-[250px] truncate" title={incident.resolutionNotes || ""}>
                    {incident.resolutionNotes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
