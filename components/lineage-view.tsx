"use client"

import { useState, useCallback, useEffect } from "react"
import { ArrowUp, ArrowDown, List, Search, Plus } from "lucide-react"

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
  const [showList, setShowList] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveMatches, setResolveMatches] = useState<ResolveMatch[] | null>(null)
  const [resolveError, setResolveError] = useState("")
  const [expandedNodes, setExpandedNodes] = useState<Record<string, ExpandedData>>({})
  const [expandingNode, setExpandingNode] = useState<string | null>(null)

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
            const dmlResult: LineageResult = await dmlRes.json()
            setData((prev) => {
              if (!prev) return prev
              return {
                upstream: prev.upstream.length === 0 ? dmlResult.upstream : prev.upstream,
                downstream: prev.downstream.length === 0 ? dmlResult.downstream : prev.downstream,
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
          const dmlResult: LineageResult = await dmlRes.json()
          const merged = {
            upstream: result.upstream.length === 0 ? dmlResult.upstream : result.upstream,
            downstream: result.downstream.length === 0 ? dmlResult.downstream : result.downstream,
          }
          setExpandedNodes((prev) => ({ ...prev, [fqn]: merged }))
        }
      }
    } finally {
      setExpandingNode(null)
      setExpandPhase("")
    }
  }, [expandedNodes])

  // Collect all nodes including expanded
  const allUpstream = data ? collectAll(data.upstream, expandedNodes, "upstream") : []
  const allDownstream = data ? collectAll(data.downstream, expandedNodes, "downstream") : []

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

          {/* Toggle for list view */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowList(!showList)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <List className="w-4 h-4" />
              {showList ? "Hide" : "Show"} List View
            </button>
            <span className="text-xs text-muted-foreground">
              {allUpstream.length} upstream, {allDownstream.length} downstream
            </span>
          </div>

          {showList && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LineageSection
                title="Upstream (depends on)"
                icon={<ArrowUp className="w-4 h-4" />}
                nodes={allUpstream}
                color="blue"
              />
              <LineageSection
                title="Downstream (depended by)"
                icon={<ArrowDown className="w-4 h-4" />}
                nodes={allDownstream}
                color="amber"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function collectAll(
  baseNodes: LineageNode[],
  expanded: Record<string, ExpandedData>,
  direction: "upstream" | "downstream"
): LineageNode[] {
  const all = [...baseNodes]
  const seen = new Set(baseNodes.map((n) => n.fqn))
  for (const [, data] of Object.entries(expanded)) {
    for (const node of data[direction]) {
      if (!seen.has(node.fqn)) {
        seen.add(node.fqn)
        all.push(node)
      }
    }
  }
  return all
}

function getSchemaColor(schema: string, type?: string): string {
  const t = type?.toUpperCase() || ""
  if (t === "VIEW" || t === "MATERIALIZED VIEW") return "#27ae60"
  if (t === "TABLE") return "#2563eb"
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
  const nodeH = 58
  const nodeW = 240
  const hGap = 120
  const vGap = 16

  const { upNodes, downNodes } = buildExpandedTree(upstream, downstream, expandedNodes, target)

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

  // Compute positions for SVG lines
  type NodePos = { x: number; y: number; fqn: string; side: "up" | "down" | "target" }
  const positions: NodePos[] = []

  // Target
  positions.push({ x: targetX, y: centerY - nodeH / 2, fqn: "__TARGET__", side: "target" })

  // Upstream
  upLevels.forEach((level, colI) => {
    const colX = colXPositions[colI]
    const nodes = upByLevel[level]
    nodes.forEach((node, ni) => {
      positions.push({ x: colX, y: getNodeY(ni, nodes.length), fqn: node.fqn, side: "up" })
    })
  })

  // Downstream
  downLevels.forEach((level, colI) => {
    const colIdx = targetColIdx + 1 + colI
    const colX = colXPositions[colIdx]
    const nodes = downByLevel[level]
    nodes.forEach((node, ni) => {
      positions.push({ x: colX, y: getNodeY(ni, nodes.length), fqn: node.fqn, side: "down" })
    })
  })

  // Build edge paths (orthogonal routing)
  type EdgePath = { d: string }
  const edgePaths: EdgePath[] = []

  // Upstream edges: each upstream node connects right-side to the next column's left-side
  upLevels.forEach((level, colI) => {
    const colX = colXPositions[colI]
    const nodes = upByLevel[level]
    const nextColIdx = colI + 1
    const nextX = colXPositions[nextColIdx]
    const nextNodes = nextColIdx === targetColIdx
      ? [{ _y: centerY - nodeH / 2 }]
      : (upByLevel[upLevels[colI + 1]] || []).map((_, ni, arr) => ({ _y: getNodeY(ni, arr.length) }))

    const midX = colX + nodeW + (hGap - 40) / 2

    nodes.forEach((_, ni) => {
      const y1 = getNodeY(ni, nodes.length) + nodeH / 2
      const targetNodeY = nextColIdx === targetColIdx
        ? centerY
        : getNodeY(Math.min(ni, nextNodes.length - 1), nextNodes.length) + nodeH / 2
      const y2 = targetNodeY

      edgePaths.push({
        d: `M ${colX + nodeW} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${nextX} ${y2}`
      })
    })
  })

  // Downstream edges
  downLevels.forEach((level, colI) => {
    const colIdx = targetColIdx + 1 + colI
    const colX = colXPositions[colIdx]
    const nodes = downByLevel[level]
    const prevColIdx = colIdx - 1
    const prevX = colXPositions[prevColIdx]
    const prevNodes = prevColIdx === targetColIdx
      ? [{ _y: centerY - nodeH / 2 }]
      : (downByLevel[downLevels[colI - 1]] || []).map((_, ni, arr) => ({ _y: getNodeY(ni, arr.length) }))

    const midX = prevX + nodeW + (hGap - 40) / 2

    nodes.forEach((_, ni) => {
      const y2 = getNodeY(ni, nodes.length) + nodeH / 2
      const sourceY = prevColIdx === targetColIdx
        ? centerY
        : getNodeY(Math.min(ni, prevNodes.length - 1), prevNodes.length) + nodeH / 2
      const y1 = sourceY

      edgePaths.push({
        d: `M ${prevX + nodeW} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${colX} ${y2}`
      })
    })
  })

  const isExpanded = (fqn: string) => fqn in expandedNodes
  const isExpanding = (fqn: string) => expandingNode === fqn

  const targetParts = target.split(".")
  const targetObjName = targetParts[targetParts.length - 1] || target
  const targetSchema = targetParts.length >= 2 ? targetParts[targetParts.length - 2] : ""
  const targetType = ""

  return (
    <div className="rounded-lg overflow-x-auto overflow-y-visible bg-[#f8f9fa] dark:bg-zinc-900/50 border border-border p-6 relative">
      {/* Status legend */}
      <div className="absolute top-3 right-3 z-10">
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
      <div className="relative" style={{ width: containerWidth, height: containerHeight, margin: "0 auto" }}>
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
          className="absolute rounded-lg shadow-md border border-gray-200 dark:border-zinc-700"
          style={{ left: targetX, top: centerY - nodeH / 2, width: nodeW, height: nodeH, zIndex: 1, borderLeftWidth: 5, borderLeftColor: getSchemaColor(targetSchema, targetType), background: "var(--card, white)" }}
        >
          <div className="flex flex-col justify-center px-3 h-full min-w-0">
            <span className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
              {targetObjName}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
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
                className="absolute rounded-lg shadow-md border border-gray-200 dark:border-zinc-700"
                style={{ left: colX, top: y, width: nodeW, height: nodeH, zIndex: 1, borderLeftWidth: 5, borderLeftColor: getSchemaColor(node.schema, node.type), background: "var(--card, white)" }}
              >
                <div className="flex flex-col justify-center px-3 h-full min-w-0 flex-1">
                  <span className="font-bold text-[13px] text-gray-900 dark:text-gray-100 truncate">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {node.schema}
                  </span>
                  {node.process && (
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate" title={node.process}>
                      {node.process}
                    </span>
                  )}
                </div>
                {!expanded && (
                  <button
                    onClick={() => onExpand(node.fqn)}
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
                className="absolute rounded-lg shadow-md border border-gray-200 dark:border-zinc-700"
                style={{ left: colX, top: y, width: nodeW, height: nodeH, zIndex: 1, borderLeftWidth: 5, borderLeftColor: getSchemaColor(node.schema, node.type), background: "var(--card, white)" }}
              >
                <div className="flex flex-col justify-center px-3 h-full min-w-0 flex-1">
                  <span className="font-bold text-[13px] text-gray-900 dark:text-gray-100 truncate">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {node.schema}
                  </span>
                  {node.process && (
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate" title={node.process}>
                      {node.process}
                    </span>
                  )}
                </div>
                {!expanded && (
                  <button
                    onClick={() => onExpand(node.fqn)}
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
      </div>
    </div>
  )
}

function buildExpandedTree(
  baseUp: LineageNode[],
  baseDown: LineageNode[],
  expanded: Record<string, ExpandedData>,
  targetFqn: string
): { upNodes: LineageNode[]; downNodes: LineageNode[] } {
  const allSeen = new Set<string>()
  allSeen.add(targetFqn.toUpperCase())

  const upNodes: LineageNode[] = []
  for (const node of baseUp) {
    const key = node.fqn.toUpperCase()
    if (!allSeen.has(key)) {
      allSeen.add(key)
      upNodes.push(node)
    }
  }

  const downNodes: LineageNode[] = []
  for (const node of baseDown) {
    const key = node.fqn.toUpperCase()
    if (!allSeen.has(key)) {
      allSeen.add(key)
      downNodes.push(node)
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
        }
      }
    }
    if (parentDown) {
      for (const node of data.downstream) {
        const key = node.fqn.toUpperCase()
        if (!allSeen.has(key)) {
          allSeen.add(key)
          downNodes.push({ ...node, level: parentDown.level + 1 })
        }
      }
    }
  }

  return { upNodes, downNodes }
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

  const grouped = groupByLevel(nodes)
  const levels = Object.keys(grouped).map(Number).sort((a, b) => a - b)

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
          {levels.map((level) =>
            grouped[level].map((node, i) => (
              <div key={`${level}-${i}`} className="px-4 py-2.5 hover:bg-muted/30 flex items-center gap-3">
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-muted text-muted-foreground">
                  L{level}
                </span>
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${typeColor(node.type)}`}>
                  {node.type}
                </span>
                <span className="font-mono text-xs truncate" title={node.fqn}>
                  {node.fqn}
                </span>
              </div>
            ))
          )}
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
