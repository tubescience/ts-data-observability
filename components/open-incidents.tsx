"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, X } from "lucide-react"

interface Incident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
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
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [notes, setNotes] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const today = getPSTToday()
  const [dateStart, setDateStart] = useState(today)
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

  const incidents = allIncidents.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (checkFilter && i.checkType !== checkFilter) return false
    if (targetFilter && !i.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (groupFilter && !(i.groupValue || "").toLowerCase().includes(groupFilter.toLowerCase())) return false
    if (dateStart && i.lastSeen && i.lastSeen.slice(0, 10) < dateStart) return false
    if (dateEnd && i.lastSeen && i.lastSeen.slice(0, 10) > dateEnd) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Open Incidents ({incidents.length})</h2>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
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
          placeholder="Search target..."
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-40"
        />
        <input
          type="text"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          placeholder="Search group..."
          className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-36"
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

      {incidents.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center">No open incidents for selected filters</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-left px-3 py-2 font-medium">Check Type</th>
                <th className="text-left px-3 py-2 font-medium">Target</th>
                <th className="text-left px-3 py-2 font-medium">Group</th>
                <th className="text-left px-3 py-2 font-medium">Failures</th>
                <th className="text-left px-3 py-2 font-medium">First Seen</th>
                <th className="text-left px-3 py-2 font-medium">Last Seen</th>
                <th className="text-left px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {incidents.map((incident) => (
                <tr key={incident.incidentId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <SeverityBadge severity={incident.severity} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{incident.checkType}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={incident.targetTable}>
                    {incident.targetTable}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{incident.groupValue || "—"}</td>
                  <td className="px-3 py-2">{incident.failureCount}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(incident.firstSeen)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatPST(incident.lastSeen)}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setResolving(incident)}
                      className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resolving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Resolve Incident</h3>
              <button onClick={() => { setResolving(null); setNotes("") }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
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
                  className="w-full border border-input rounded-md p-2 text-sm bg-background min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Describe the resolution or action taken..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => { setResolving(null); setNotes("") }}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resolveMutation.mutate({ incidentId: resolving.incidentId, resolutionNotes: notes })}
                disabled={!notes.trim() || resolveMutation.isPending}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
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

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${colors[severity] || "bg-gray-100 text-gray-800"}`}>
      {severity === "CRITICAL" && <AlertTriangle className="w-3 h-3" />}
      {severity}
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
