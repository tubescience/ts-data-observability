"use client"

import { useQuery } from "@tanstack/react-query"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"

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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">14-Day Health Score</h2>

      {trends.length === 0 ? (
        <div className="text-muted-foreground">No trend data available</div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-3">Health Score (%)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value}%`, "Health Score"]}
                />
                <Line type="monotone" dataKey="healthScore" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-3">Passed / Failed / Anomalies</h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="passed" stackId="1" fill="#22c55e" stroke="#22c55e" fillOpacity={0.6} />
                <Area type="monotone" dataKey="failed" stackId="1" fill="#ef4444" stroke="#ef4444" fillOpacity={0.6} />
                <Area type="monotone" dataKey="anomalies" stackId="1" fill="#eab308" stroke="#eab308" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Health</th>
                  <th className="text-left px-3 py-2 font-medium">Passed</th>
                  <th className="text-left px-3 py-2 font-medium">Failed</th>
                  <th className="text-left px-3 py-2 font-medium">Anomalies</th>
                  <th className="text-left px-3 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...trends].reverse().map((t) => (
                  <tr key={t.date} className="hover:bg-muted/30">
                    <td className="px-3 py-2">{t.date}</td>
                    <td className="px-3 py-2">
                      <span className={t.healthScore >= 90 ? "text-green-500" : t.healthScore >= 70 ? "text-yellow-500" : "text-red-500"}>
                        {t.healthScore}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-green-600">{t.passed}</td>
                    <td className="px-3 py-2 text-red-600">{t.failed}</td>
                    <td className="px-3 py-2 text-yellow-600">{t.anomalies}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
