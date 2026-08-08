"use client"

import { useQuery } from "@tanstack/react-query"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

interface TrendPoint {
  date: string
  passed: number
  failed: number
  anomalies: number
  total: number
  healthScore: number
}

export function TrendsView() {
  const { data, isLoading, error } = useQuery<TrendPoint[]>({
    queryKey: ["trends"],
    queryFn: () => fetch("/api/trends").then((r) => r.json()),
  })

  if (isLoading) return <div className="text-muted-foreground">Loading trends...</div>
  if (error) return <div className="text-destructive">Failed to load trends</div>

  const trends = data || []

  const columns: TableColumn[] = [
    { key: "date", label: "Date", className: "text-xs" },
    {
      key: "healthScore",
      label: "Health",
      render: (val) => (
        <span className={val >= 90 ? "text-green-500" : val >= 70 ? "text-yellow-500" : "text-red-500"}>
          {val}%
        </span>
      ),
    },
    { key: "passed", label: "Passed", className: "text-green-600 text-xs" },
    { key: "failed", label: "Failed", className: "text-red-600 text-xs" },
    { key: "anomalies", label: "Anomalies", className: "text-yellow-600 text-xs", hideOnMobile: true },
    { key: "total", label: "Total", className: "text-muted-foreground text-xs", hideOnMobile: true },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold">14-Day Health Score</h2>

      {trends.length === 0 ? (
        <div className="text-muted-foreground">No trend data available</div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
            <h3 className="text-sm font-medium mb-3">Health Score (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trends} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={35} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }}
                  formatter={(value: number) => [`${value}%`, "Health Score"]}
                />
                <Line type="monotone" dataKey="healthScore" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
            <h3 className="text-sm font-medium mb-3">Passed / Failed / Anomalies</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trends} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={35} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
                <Area type="monotone" dataKey="passed" stackId="1" fill="#22c55e" stroke="#22c55e" fillOpacity={0.6} />
                <Area type="monotone" dataKey="failed" stackId="1" fill="#ef4444" stroke="#ef4444" fillOpacity={0.6} />
                <Area type="monotone" dataKey="anomalies" stackId="1" fill="#eab308" stroke="#eab308" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <ResponsiveTable
            columns={columns}
            data={[...trends].reverse()}
            keyField="date"
          />
        </>
      )}
    </div>
  )
}
