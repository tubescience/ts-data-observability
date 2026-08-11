"use client"

import { useState, useCallback, useEffect } from "react"
import { Search, Plus } from "lucide-react"

interface LineageNode {
  database: string
  schema: string
  name: string
  type: string
  level: number
  fqn: string
  process?: string
  role?: string
  warehouse?: string
}

interface LineageResult {
  upstream: LineageNode[]
  downstream: LineageNode[]
}

interface ResolveMatch {
  database: string
  schema: string
  name: string
  fqn: string
}

// Expanded nodes track: key is fqn, value is the extra lineage loaded for that node
interface ExpandedData {
  upstream: LineageNode[]
  downstream: LineageNode[]
}

export function LineageView() {
  const [objectInput, setObjectInput] = useState("")
  const [searchObject, setSearchObject] = useState("")
  const [depth, setDepth] = useState(1)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, ExpandedData>>({})
  const [expandingNode, setExpandingNode] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveMatches, setResolveMatches] = useState<ResolveMatch[] | null>(null)
  const [resolveError, setResolveError] = useState("")

  // Progressive loading state
  const [data, setData] = useState<LineageResult | null>(null)
  const [loadingPhase, setLoadingPhase] = useState<"" | "deps" | "dml">("")
  const [error, setError] = useState("")

  // Load lineage progressively when searchObject changes
  useEffect(() => {
    if (!searchObject) return
    let cancelled = false

    const load = async () => {
      setData(null)
      setError("")
      setLoadingPhase("deps")

      try {
        // Phase 1: OBJECT_DEPENDENCIES (fast)
        const r = await fetch(`/api/lineage?object=${encodeURIComponent(searchObject)}&depth=${depth}`)
        if (cancelled) return
        if (!r.ok) { const e = await r.json(); setError(e.error); setLoadingPhase(""); return }
        const result: LineageResult = await r.json()

        // Show what we have immediately
        setData({ ...result })

        // Phase 2: If either side is empty, try DML (slow)
        if (result.upstream.length === 0 || result.downstream.length === 0) {
          setLoadingPhase("dml")
          const dmlRes = await fetch(`/api/lineage/dml?object=${encodeURIComponent(searchObject)}`)
          if (cancelled) return
          if (dmlRes.ok) {
            const dmlResult = await dmlRes.json()
            const tasks: any[] = dmlResult.tasks || []
            const upTasks = tasks.filter((t: any) => t.role === "upstream_task")
            const downTasks = tasks.filter((t: any) => t.role === "downstream_task")

            setData((prev) => {
              if (!prev) return prev
              return {
                upstream: prev.upstream.length === 0
                  ? [...dmlResult.upstream, ...upTasks]
                  : prev.upstream,
                downstream: prev.downstream.length === 0
                  ? [...dmlResult.downstream, ...downTasks]
                  : prev.downstream,
              }
            })
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load lineage")
      } finally {
        if (!cancelled) setLoadingPhase("")
      }
    }

    load()
    return () => { cancelled = true }
  }, [searchObject, depth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = objectInput.trim()
    if (!input) return

    setResolveMatches(null)
    setResolveError("")
    setSearchObject("")
    setExpandedNodes({})

    const parts = input.split(".")
    if (parts.length >= 2) {
      setTimeout(() => setSearchObject(input), 0)
      return
    }

    setResolving(true)
    try {
      const res = await fetch(`/api/lineage/resolve?name=${encodeURIComponent(input)}`)
      const json = await res.json()
      if (!res.ok) {
        setResolveError(json.error || "Failed to resolve object")
        return
      }
      const matches: ResolveMatch[] = json.matches
      if (matches.length === 0) {
        setResolveError(`No object found matching "${input}"`)
      } else if (matches.length === 1) {
        setObjectInput(matches[0].fqn)
        setSearchObject("")
        setTimeout(() => setSearchObject(matches[0].fqn), 0)
      } else {
        setResolveMatches(matches)
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Resolution failed")
    } finally {
      setResolving(false)
    }
  }

  const selectMatch = (match: ResolveMatch) => {
    setObjectInput(match.fqn)
    setSearchObject("")
    setResolveMatches(null)
    setExpandedNodes({})
    setTimeout(() => setSearchObject(match.fqn), 0)
  }

  const [expandPhase, setExpandPhase] = useState<"" | "deps" | "dml">("")

  const expandNode = useCallback(async (fqn: string) => {
    if (expandedNodes[fqn]) return
    setExpandingNode(fqn)
    setExpandPhase("deps")
    try {
      const res = await fetch(`/api/lineage?object=${encodeURIComponent(fqn)}&depth=1`)
      if (!res.ok) return
      const result: LineageResult = await res.json()

      // Show immediate results
      setExpandedNodes((prev) => ({ ...prev, [fqn]: { ...result } }))

      // If no upstream found, fall back to DML lineage
      if (result.upstream.length === 0 || result.downstream.length === 0) {
        setExpandPhase("dml")
        const dmlRes = await fetch(`/api/lineage/dml?object=${encodeURIComponent(fqn)}`)
        if (dmlRes.ok) {
          const dmlResult = await dmlRes.json()
          const tasks: any[] = dmlResult.tasks || []
          const upTasks = tasks.filter((t: any) => t.role === "upstream_task")
          const downTasks = tasks.filter((t: any) => t.role === "downstream_task")
          const merged = {
            upstream: result.upstream.length === 0 ? [...dmlResult.upstream, ...upTasks] : result.upstream,
            downstream: result.downstream.length === 0 ? [...dmlResult.downstream, ...downTasks] : result.downstream,
          }
          setExpandedNodes((prev) => ({ ...prev, [fqn]: merged }))
        }
      }
    } finally {
      setExpandingNode(null)
      setExpandPhase("")
    }
  }, [expandedNodes])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Object Lineage</h2>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative w-full sm:w-96">
          <input
            type="text"
            value={objectInput}
            onChange={(e) => setObjectInput(e.target.value)}
            placeholder="OBJECT_NAME or DATABASE.SCHEMA.OBJECT_NAME"
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full font-mono pr-8"
          />
          {resolving && (
            <Search className="w-4 h-4 absolute right-2.5 top-2.5 text-muted-foreground animate-pulse" />
          )}
        </div>
        <button
          type="submit"
          disabled={!objectInput.trim() || resolving}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Show Lineage
        </button>
      </form>

      {resolving && <div className="text-muted-foreground text-sm animate-pulse">Loading DB and Schema...</div>}
      {resolveError && <div className="text-destructive text-sm">{resolveError}</div>}

      {resolveMatches && (
        <div className="border border-border rounded-lg p-4 space-y-2">
          <p className="text-sm text-muted-foreground">Multiple objects found. Select one:</p>
          <div className="space-y-1">
            {resolveMatches.map((m, i) => (
              <button
                key={i}
                onClick={() => selectMatch(m)}
                className="block w-full text-left px-3 py-2 text-sm font-mono rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors"
              >
                {m.fqn}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadingPhase === "deps" && (
        <div className="text-muted-foreground text-sm animate-pulse">
          Loading lineage...
        </div>
      )}
      {loadingPhase === "dml" && (
        <div className="text-amber-600 dark:text-amber-400 text-sm animate-pulse">
          Loading lineage (taking more time to identify lineage)...
        </div>
      )}
      {error && <div className="text-destructive text-sm">{error}</div>}

      {data && (
        <>
          {/* Graph shown by default (inline) */}
          {expandingNode && (
            <div className={`text-sm animate-pulse ${expandPhase === "dml" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {expandPhase === "dml"
                ? `Expanding ${expandingNode.split(".").pop()} (taking more time to identify lineage)...`
                : `Expanding ${expandingNode.split(".").pop()}...`}
            </div>
          )}
          <LineageGraph
            target={searchObject}
            upstream={data.upstream}
            downstream={data.downstream}
            expandedNodes={expandedNodes}
            expandingNode={expandingNode}
            onExpand={expandNode}
            status={loadingPhase === "dml" || expandPhase === "dml" ? "partial" : loadingPhase || expandPhase ? "loading" : "complete"}
          />
        </>
      )}
    </div>
  )
}

function getSchemaColor(schema: string, type?: string): string {
  const t = type?.toUpperCase() || ""
  if (t === "VIEW" || t === "MATERIALIZED VIEW") return "#27ae60"
  if (t === "TABLE") return "#2563eb"
  if (t === "DYNAMIC TABLE") return "#eab308"
  if (t === "PROCEDURE" || t === "FUNCTION") return "#7c3aed"
  if (t === "PIPE" || t === "STREAM") return "#e67e22"
  if (t === "TASK") return "#db2777"
  return "#6b7280"
}

function LineageGraph({
  target,
  upstream,
  downstream,
  expandedNodes,
  expandingNode,
  onExpand,
  status,
}: {
  target: string
  upstream: LineageNode[]
  downstream: LineageNode[]
  expandedNodes: Record<string, ExpandedData>
  expandingNode: string | null
  onExpand: (fqn: string) => void
  status: "loading" | "partial" | "complete"
}) {
  const nodeH = 48
  const nodeW = 200
  const hGap = 100
  const vGap = 14

  const { upNodes, downNodes, edges: relationEdges } = buildExpandedTree(upstream, downstream, expandedNodes, target)

  const upByLevel = groupByLevel(upNodes)
  const downByLevel = groupByLevel(downNodes)

  const upLevels = Object.keys(upByLevel).map(Number).sort((a, b) => b - a)
  const downLevels = Object.keys(downByLevel).map(Number).sort((a, b) => a - b)

  const totalColumns = Math.max(upLevels.length, 0) + 1 + Math.max(downLevels.length, 0)
  const containerWidth = totalColumns * nodeW + (totalColumns - 1) * hGap + 80

  const maxNodesInColumn = Math.max(
    1,
    ...upLevels.map((l) => upByLevel[l].length),
    ...downLevels.map((l) => downByLevel[l].length)
  )
  const containerHeight = Math.max(maxNodesInColumn * (nodeH + vGap) + 60, 200)
  const centerY = containerHeight / 2

  // Column x positions
  const colXPositions: number[] = []
  for (let i = 0; i < totalColumns; i++) {
    colXPositions.push(40 + i * (nodeW + hGap))
  }

  const targetColIdx = upLevels.length
  const targetX = colXPositions[targetColIdx] ?? 40

  function getNodeY(index: number, total: number): number {
    const totalHeight = total * nodeH + (total - 1) * vGap
    const startY = centerY - totalHeight / 2
    return startY + index * (nodeH + vGap)
  }

  // Build edge paths from actual parent-child relationships
  type EdgePath = { d: string }
  const edgePaths: EdgePath[] = []

  // Build a position lookup: fqn → {x, y, side}
  const nodePositions = new Map<string, { x: number; y: number }>()
  nodePositions.set(target.toUpperCase(), { x: targetX, y: centerY - nodeH / 2 })

  upLevels.forEach((level, colI) => {
    const colX = colXPositions[colI]
    const nodes = upByLevel[level]
    nodes.forEach((node, ni) => {
      nodePositions.set(node.fqn.toUpperCase(), { x: colX, y: getNodeY(ni, nodes.length) })
    })
  })

  downLevels.forEach((level, colI) => {
    const colIdx = targetColIdx + 1 + colI
    const colX = colXPositions[colIdx]
    const nodes = downByLevel[level]
    nodes.forEach((node, ni) => {
      nodePositions.set(node.fqn.toUpperCase(), { x: colX, y: getNodeY(ni, nodes.length) })
    })
  })

  // Draw edges based on actual relationships
  for (const edge of relationEdges) {
    const fromPos = nodePositions.get(edge.from.toUpperCase())
    const toPos = nodePositions.get(edge.to.toUpperCase())
    if (!fromPos || !toPos) continue

    const x1 = fromPos.x + nodeW
    const y1 = fromPos.y + nodeH / 2
    const x2 = toPos.x
    const y2 = toPos.y + nodeH / 2
    const midX = x1 + (x2 - x1) / 2

    edgePaths.push({
      d: `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
    })
  }

  const isExpanded = (fqn: string) => fqn in expandedNodes
  const isExpanding = (fqn: string) => expandingNode === fqn

  const [tooltip, setTooltip] = useState<{ node: LineageNode | null; x: number; y: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [showLegend, setShowLegend] = useState(false)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setScale((s) => Math.min(2, Math.max(0.3, s - e.deltaY * 0.002)))
    }
  }, [])

  const handleNodeClick = (node: LineageNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const container = (e.currentTarget as HTMLElement).closest(".lineage-graph-container")
    const containerRect = container?.getBoundingClientRect() || rect
    setTooltip({
      node,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
    })
  }

  const targetParts = target.split(".")
  const targetObjName = targetParts[targetParts.length - 1] || target
  const targetSchema = targetParts.length >= 2 ? targetParts[targetParts.length - 2] : ""
  const targetType = ""

  return (
    <div className="rounded-lg overflow-auto bg-[#f8f9fa] dark:bg-zinc-900/50 border border-border p-6 relative" onClick={() => { setTooltip(null); setShowLegend(false) }} onWheel={handleWheel}>
      {/* Color legend */}
      <div className="absolute top-3 left-3 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); setShowLegend(!showLegend) }}
          className="w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 text-xs font-bold flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-600 shadow-sm"
        >?</button>
        {showLegend && (
          <div className="absolute top-8 left-0 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Node Colors</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#27ae60" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">View</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#2563eb" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Table</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#eab308" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Dynamic Table</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#7c3aed" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Procedure / Function</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#e67e22" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Pipe / Stream</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#db2777" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Task</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#6b7280" }} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">Other / Unknown</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Status legend */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 mr-2">
          <button
            onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(2, s + 0.15)) }}
            className="w-6 h-6 rounded bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 text-xs font-bold flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-600"
          >+</button>
          <span className="text-[10px] text-gray-500 w-8 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(0.3, s - 0.15)) }}
            className="w-6 h-6 rounded bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 text-xs font-bold flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-600"
          >-</button>
          <button
            onClick={(e) => { e.stopPropagation(); setScale(1) }}
            className="ml-1 px-1.5 h-6 rounded bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 text-[10px] flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-600"
          >Reset</button>
        </div>
        {status === "partial" && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Partial Result
          </span>
        )}
        {status === "loading" && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Loading
          </span>
        )}
        {status === "complete" && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Complete
          </span>
        )}
      </div>
      <div className="relative lineage-graph-container" style={{ width: containerWidth * scale, height: containerHeight * scale, margin: "0 auto", overflow: "visible" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: containerWidth, height: containerHeight, position: "relative" }}>
        {/* SVG for connection lines */}
        <svg
          width={containerWidth}
          height={containerHeight}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 0 }}
        >
          {edgePaths.map((edge, i) => (
            <path
              key={`edge-${i}`}
              d={edge.d}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={1.5}
              strokeDasharray="6 3"
            />
          ))}
        </svg>

        {/* Target node */}
        <div
          className="absolute rounded-lg shadow-md border-2 border-white dark:border-gray-300 cursor-pointer hover:shadow-lg transition-shadow ring-1 ring-gray-300 dark:ring-zinc-500"
          style={{ left: targetX, top: centerY - nodeH / 2, width: nodeW, height: nodeH, zIndex: 1, background: "var(--card, white)" }}
          onClick={(e) => handleNodeClick({ database: targetParts[0] || "", schema: targetSchema, name: targetObjName, type: "OBJECT SOURCE", level: 0, fqn: target }, e)}
        >
          <div className="flex flex-col justify-center px-3 h-full min-w-0">
            <span className="font-bold text-[13px] text-gray-900 dark:text-gray-100 truncate">
              {targetObjName}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {targetSchema}
            </span>
          </div>
        </div>

        {/* Upstream nodes */}
        {upLevels.map((level, colI) => {
          const colX = colXPositions[colI]
          const nodes = upByLevel[level]
          return nodes.map((node, ni) => {
            const y = getNodeY(ni, nodes.length)
            const expanded = isExpanded(node.fqn)
            const expanding = isExpanding(node.fqn)
            return (
              <div
                key={`up-${level}-${ni}`}
                className="absolute rounded-lg shadow-md border border-gray-200 dark:border-zinc-700 cursor-pointer hover:shadow-lg transition-shadow"
                style={{ left: colX, top: y, width: nodeW, height: nodeH, zIndex: 1, borderLeftWidth: 5, borderLeftColor: getSchemaColor(node.schema, node.type), background: "var(--card, white)" }}
                onClick={(e) => handleNodeClick(node, e)}
              >
                <div className="flex flex-col justify-center px-3 h-full min-w-0 flex-1">
                  <span className="font-bold text-[13px] text-gray-900 dark:text-gray-100 truncate">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {node.schema}
                  </span>
                </div>
                {!expanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExpand(node.fqn) }}
                    className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                  >
                    {expanding ? (
                      <span className="text-[10px] text-gray-400 animate-pulse">...</span>
                    ) : (
                      <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                    )}
                  </button>
                )}
              </div>
            )
          })
        })}

        {/* Downstream nodes */}
        {downLevels.map((level, colI) => {
          const colIdx = targetColIdx + 1 + colI
          const colX = colXPositions[colIdx]
          const nodes = downByLevel[level]
          return nodes.map((node, ni) => {
            const y = getNodeY(ni, nodes.length)
            const expanded = isExpanded(node.fqn)
            const expanding = isExpanding(node.fqn)
            return (
              <div
                key={`down-${level}-${ni}`}
                className="absolute rounded-lg shadow-md border border-gray-200 dark:border-zinc-700 cursor-pointer hover:shadow-lg transition-shadow"
                style={{ left: colX, top: y, width: nodeW, height: nodeH, zIndex: 1, borderLeftWidth: 5, borderLeftColor: getSchemaColor(node.schema, node.type), background: "var(--card, white)" }}
                onClick={(e) => handleNodeClick(node, e)}
              >
                <div className="flex flex-col justify-center px-3 h-full min-w-0 flex-1">
                  <span className="font-bold text-[13px] text-gray-900 dark:text-gray-100 truncate">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {node.schema}
                  </span>
                </div>
                {!expanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExpand(node.fqn) }}
                    className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                  >
                    {expanding ? (
                      <span className="text-[10px] text-gray-400 animate-pulse">...</span>
                    ) : (
                      <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                    )}
                  </button>
                )}
              </div>
            )
          })
        })}

        {/* Empty state */}
        {upstream.length === 0 && (
          <div
            className="absolute text-sm text-gray-400"
            style={{ left: targetX - hGap - 60, top: centerY - 10 }}
          >
            No upstream
          </div>
        )}
        {downstream.length === 0 && (
          <div
            className="absolute text-sm text-gray-400"
            style={{ left: targetX + nodeW + hGap - 60, top: centerY - 10 }}
          >
            No downstream
          </div>
        )}

        {/* Tooltip */}
        {tooltip && tooltip.node && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
          >
            <div className="bg-gray-900 text-white rounded-lg shadow-xl px-4 py-3 text-sm min-w-[220px] max-w-[320px]">
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5 font-medium whitespace-nowrap">Name</td>
                    <td className="text-white py-0.5 font-semibold">{tooltip.node.name}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5 font-medium whitespace-nowrap">Location</td>
                    <td className="text-white py-0.5">{tooltip.node.schema}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5 font-medium whitespace-nowrap">Database</td>
                    <td className="text-white py-0.5">{tooltip.node.database}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-400 pr-3 py-0.5 font-medium whitespace-nowrap">Type</td>
                    <td className="text-white py-0.5">{tooltip.node.type || "—"}</td>
                  </tr>
                  {tooltip.node.process && (
                    <tr>
                      <td className="text-gray-400 pr-3 py-0.5 font-medium whitespace-nowrap">Process</td>
                      <td className="text-white py-0.5">{tooltip.node.process}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-center">
              <div className="w-3 h-3 bg-gray-900 rotate-45 -mt-1.5" />
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

interface EdgeRelation {
  from: string // parent fqn
  to: string   // child fqn
  direction: "upstream" | "downstream"
}

function buildExpandedTree(
  baseUp: LineageNode[],
  baseDown: LineageNode[],
  expanded: Record<string, ExpandedData>,
  targetFqn: string
): { upNodes: LineageNode[]; downNodes: LineageNode[]; edges: EdgeRelation[] } {
  const allSeen = new Set<string>()
  allSeen.add(targetFqn.toUpperCase())
  const edges: EdgeRelation[] = []

  const upNodes: LineageNode[] = []
  for (const node of baseUp) {
    const key = node.fqn.toUpperCase()
    if (!allSeen.has(key)) {
      allSeen.add(key)
      upNodes.push(node)
      // Level 1 upstream nodes connect to target
      edges.push({ from: node.fqn, to: targetFqn, direction: "upstream" })
    }
  }

  const downNodes: LineageNode[] = []
  for (const node of baseDown) {
    const key = node.fqn.toUpperCase()
    if (!allSeen.has(key)) {
      allSeen.add(key)
      downNodes.push(node)
      // Level 1 downstream nodes connect from target
      edges.push({ from: targetFqn, to: node.fqn, direction: "downstream" })
    }
  }

  for (const [parentFqn, data] of Object.entries(expanded)) {
    const parentUp = upNodes.find((n) => n.fqn === parentFqn)
    const parentDown = downNodes.find((n) => n.fqn === parentFqn)

    if (parentUp) {
      for (const node of data.upstream) {
        const key = node.fqn.toUpperCase()
        if (!allSeen.has(key)) {
          allSeen.add(key)
          upNodes.push({ ...node, level: parentUp.level + 1 })
          edges.push({ from: node.fqn, to: parentFqn, direction: "upstream" })
        }
      }
    }
    if (parentDown) {
      for (const node of data.downstream) {
        const key = node.fqn.toUpperCase()
        if (!allSeen.has(key)) {
          allSeen.add(key)
          downNodes.push({ ...node, level: parentDown.level + 1 })
          edges.push({ from: parentFqn, to: node.fqn, direction: "downstream" })
        }
      }
    }
  }

  return { upNodes, downNodes, edges }
}

function groupByLevel(nodes: LineageNode[]): Record<number, LineageNode[]> {
  const map: Record<number, LineageNode[]> = {}
  for (const node of nodes) {
    const l = node.level || 1
    if (!map[l]) map[l] = []
    map[l].push(node)
  }
  return map
}


