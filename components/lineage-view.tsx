"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUp, ArrowDown, X, GitBranch } from "lucide-react"

interface LineageNode {
  database: string
  schema: string
  name: string
  type: string
  fqn: string
}

interface LineageResult {
  upstream: LineageNode[]
  downstream: LineageNode[]
}

export function LineageView() {
  const [objectInput, setObjectInput] = useState("")
  const [searchObject, setSearchObject] = useState("")
  const [showGraph, setShowGraph] = useState(false)

  const { data, isLoading, error } = useQuery<LineageResult>({
    queryKey: ["lineage", searchObject],
    queryFn: () =>
      fetch(`/api/lineage?object=${encodeURIComponent(searchObject)}`).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)))
        return r.json()
      }),
    enabled: !!searchObject,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (objectInput.trim()) setSearchObject(objectInput.trim())
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Object Lineage</h2>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          value={objectInput}
          onChange={(e) => setObjectInput(e.target.value)}
          placeholder="DATABASE.SCHEMA.OBJECT_NAME"
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-96 font-mono"
        />
        <button
          type="submit"
          disabled={!objectInput.trim()}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Show Lineage
        </button>
      </form>

      {isLoading && <div className="text-muted-foreground">Loading lineage...</div>}
      {error && <div className="text-destructive text-sm">{(error as Error).message}</div>}

      {data && (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGraph(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-primary text-primary hover:bg-primary/10 transition-colors"
            >
              <GitBranch className="w-4 h-4" />
              View Graph
            </button>
            <span className="text-xs text-muted-foreground">
              {data.upstream.length} upstream, {data.downstream.length} downstream
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LineageSection
              title="Upstream (depends on)"
              icon={<ArrowUp className="w-4 h-4" />}
              nodes={data.upstream}
              color="blue"
            />
            <LineageSection
              title="Downstream (depended by)"
              icon={<ArrowDown className="w-4 h-4" />}
              nodes={data.downstream}
              color="amber"
            />
          </div>

          {showGraph && (
            <LineageGraph
              target={searchObject}
              upstream={data.upstream}
              downstream={data.downstream}
              onClose={() => setShowGraph(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

function LineageGraph({
  target,
  upstream,
  downstream,
  onClose,
}: {
  target: string
  upstream: LineageNode[]
  downstream: LineageNode[]
  onClose: () => void
}) {
  const nodeHeight = 40
  const nodeWidth = 260
  const horizontalGap = 180
  const verticalGap = 12

  const maxSide = Math.max(upstream.length, downstream.length, 1)
  const svgHeight = Math.max(maxSide * (nodeHeight + verticalGap) + 80, 300)
  const svgWidth = nodeWidth * 3 + horizontalGap * 2 + 40

  const centerX = svgWidth / 2
  const centerY = svgHeight / 2

  const upstreamX = 20
  const targetX = centerX - nodeWidth / 2
  const downstreamX = svgWidth - nodeWidth - 20

  function getNodeY(index: number, total: number): number {
    const totalHeight = total * nodeHeight + (total - 1) * verticalGap
    const startY = centerY - totalHeight / 2
    return startY + index * (nodeHeight + verticalGap)
  }

  const targetName = target.split(".").pop() || target

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Lineage Graph</h3>
            <span className="text-xs text-muted-foreground font-mono ml-2">{target}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-auto">
          <svg width={svgWidth} height={svgHeight} className="mx-auto">
            {/* Connection lines - upstream to target */}
            {upstream.map((_, i) => {
              const y = getNodeY(i, upstream.length) + nodeHeight / 2
              return (
                <path
                  key={`up-line-${i}`}
                  d={`M ${upstreamX + nodeWidth} ${y} C ${upstreamX + nodeWidth + horizontalGap / 2} ${y}, ${targetX - horizontalGap / 2} ${centerY}, ${targetX} ${centerY}`}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  opacity={0.6}
                  markerEnd="url(#arrow-blue)"
                />
              )
            })}

            {/* Connection lines - target to downstream */}
            {downstream.map((_, i) => {
              const y = getNodeY(i, downstream.length) + nodeHeight / 2
              return (
                <path
                  key={`down-line-${i}`}
                  d={`M ${targetX + nodeWidth} ${centerY} C ${targetX + nodeWidth + horizontalGap / 2} ${centerY}, ${downstreamX - horizontalGap / 2} ${y}, ${downstreamX} ${y}`}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  opacity={0.6}
                  markerEnd="url(#arrow-amber)"
                />
              )
            })}

            {/* Arrow markers */}
            <defs>
              <marker id="arrow-blue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
              </marker>
              <marker id="arrow-amber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
              </marker>
            </defs>

            {/* Upstream nodes */}
            {upstream.map((node, i) => {
              const y = getNodeY(i, upstream.length)
              return (
                <g key={`up-${i}`}>
                  <rect
                    x={upstreamX}
                    y={y}
                    width={nodeWidth}
                    height={nodeHeight}
                    rx={6}
                    fill="var(--card)"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                  />
                  <text x={upstreamX + 8} y={y + 16} fontSize={9} fill="#3b82f6" fontWeight="bold">
                    {node.type}
                  </text>
                  <text x={upstreamX + 8} y={y + 30} fontSize={10} fill="currentColor" className="fill-foreground">
                    {node.name.length > 32 ? node.name.slice(0, 30) + "…" : node.name}
                  </text>
                </g>
              )
            })}

            {/* Center target node */}
            <rect
              x={targetX}
              y={centerY - nodeHeight / 2}
              width={nodeWidth}
              height={nodeHeight}
              rx={6}
              fill="var(--primary)"
              opacity={0.15}
              stroke="var(--primary)"
              strokeWidth={2}
            />
            <text
              x={centerX}
              y={centerY - 4}
              textAnchor="middle"
              fontSize={9}
              fill="var(--primary)"
              fontWeight="bold"
            >
              TARGET
            </text>
            <text
              x={centerX}
              y={centerY + 12}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
              className="fill-foreground"
              fontWeight="600"
            >
              {targetName.length > 28 ? targetName.slice(0, 26) + "…" : targetName}
            </text>

            {/* Downstream nodes */}
            {downstream.map((node, i) => {
              const y = getNodeY(i, downstream.length)
              return (
                <g key={`down-${i}`}>
                  <rect
                    x={downstreamX}
                    y={y}
                    width={nodeWidth}
                    height={nodeHeight}
                    rx={6}
                    fill="var(--card)"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                  />
                  <text x={downstreamX + 8} y={y + 16} fontSize={9} fill="#f59e0b" fontWeight="bold">
                    {node.type}
                  </text>
                  <text x={downstreamX + 8} y={y + 30} fontSize={10} fill="currentColor" className="fill-foreground">
                    {node.name.length > 32 ? node.name.slice(0, 30) + "…" : node.name}
                  </text>
                </g>
              )
            })}

            {/* Labels */}
            {upstream.length === 0 && (
              <text x={upstreamX + nodeWidth / 2} y={centerY} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
                No upstream
              </text>
            )}
            {downstream.length === 0 && (
              <text x={downstreamX + nodeWidth / 2} y={centerY} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
                No downstream
              </text>
            )}
          </svg>
        </div>
      </div>
    </div>
  )
}

function LineageSection({
  title,
  icon,
  nodes,
  color,
}: {
  title: string
  icon: React.ReactNode
  nodes: LineageNode[]
  color: "blue" | "amber"
}) {
  const headerColor = color === "blue"
    ? "text-blue-600 dark:text-blue-400"
    : "text-amber-600 dark:text-amber-400"

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-muted/50 flex items-center gap-2">
        <span className={headerColor}>{icon}</span>
        <h3 className={`text-sm font-semibold ${headerColor}`}>{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{nodes.length} object{nodes.length !== 1 ? "s" : ""}</span>
      </div>
      {nodes.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">No dependencies found</div>
      ) : (
        <div className="divide-y divide-border">
          {nodes.map((node, i) => (
            <div key={i} className="px-4 py-2.5 hover:bg-muted/30 flex items-center gap-3">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${typeColor(node.type)}`}>
                {node.type}
              </span>
              <span className="font-mono text-xs truncate" title={node.fqn}>
                {node.fqn}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function typeColor(type: string): string {
  const colors: Record<string, string> = {
    TABLE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    VIEW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PROCEDURE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    PIPE: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    FUNCTION: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    STAGE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    STREAM: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    TASK: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
  }
  return colors[type?.toUpperCase()] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
}
