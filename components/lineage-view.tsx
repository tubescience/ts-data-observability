"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Search, Plus } from "lucide-react"

interface LineageNode {
  database: string
  schema: string
  name: string
  type: string
  level: number
  fqn: string
  parent_fqn?: string
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

export function LineagePanel({ initialTarget, maxDepth = 5 }: { initialTarget?: string; maxDepth?: number }) {
  const [objectInput, setObjectInput] = useState(initialTarget || "")
  const [searchObject, setSearchObject] = useState(initialTarget || "")
  const [expandedNodes, setExpandedNodes] = useState<Record<string, ExpandedData>>({})
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set())
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [resolving, setResolving] = useState(false)
  const [resolveMatches, setResolveMatches] = useState<ResolveMatch[] | null>(null)
  const [resolveError, setResolveError] = useState("")

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<{ fqn: string; type: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    if (initialTarget || objectInput.length < 2 || objectInput.includes(".")) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lineage/search?q=${encodeURIComponent(objectInput)}`)
        if (res.ok) {
          const json = await res.json()
          setSuggestions(json.results || [])
          setShowSuggestions(true)
        }
      } catch {}
    }, 300)
    return () => clearTimeout(timer)
  }, [objectInput, initialTarget])

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
        // Always fetch depth=5 (all cached levels)
        const r = await fetch(`/api/lineage?object=${encodeURIComponent(searchObject)}&depth=5`)
        if (cancelled) return
        if (!r.ok) {
          const text = await r.text()
          try { setError(JSON.parse(text).error) } catch { setError(text || `Error ${r.status}`) }
          setLoadingPhase("")
          return
        }
        const result: LineageResult = await r.json()

        // Show what we have immediately
        setData({ ...result })

        // If maxDepth is limited (e.g. incident view), auto-collapse level-1 nodes
        if (maxDepth === 1) {
          const toCollapse = new Set<string>()
          for (const n of result.upstream) { if ((n.level || 1) === 1) toCollapse.add(n.fqn) }
          for (const n of result.downstream) { if ((n.level || 1) === 1) toCollapse.add(n.fqn) }
          setCollapsedNodes(toCollapse)
        }
        setData({ ...result })

        // Phase 2: If either side is empty and not in compact mode, try DML (slow)
        if (!initialTarget && (result.upstream.length === 0 || result.downstream.length === 0)) {
          setLoadingPhase("dml")
          const dmlRes = await fetch(`/api/lineage/dml?object=${encodeURIComponent(searchObject)}`)
          if (cancelled) return
          if (dmlRes.ok) {
            const dmlResult = await dmlRes.json()
            const tasks: any[] = dmlResult.tasks || []
            const consumers: any[] = dmlResult.consumers || []
            const upTasks = tasks.filter((t: any) => t.role === "upstream_task")
            const downTasks = tasks.filter((t: any) => t.role === "downstream_task")

            setData((prev) => {
              if (!prev) return prev
              return {
                upstream: prev.upstream.length === 0
                  ? [...dmlResult.upstream, ...upTasks]
                  : prev.upstream,
                downstream: prev.downstream.length === 0
                  ? [...dmlResult.downstream, ...downTasks, ...consumers]
                  : [...prev.downstream, ...consumers],
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
  }, [searchObject, maxDepth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = objectInput.trim()
    if (!input) return

    setResolveMatches(null)
    setResolveError("")
    setSearchObject("")
    setExpandedNodes({}); setCollapsedNodes(new Set())

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
    setExpandedNodes({}); setCollapsedNodes(new Set())
    setTimeout(() => setSearchObject(match.fqn), 0)
  }

  // (expandPhase removed - concurrent expansions don't need a single phase)

  const expandNode = useCallback(async (fqn: string) => {
    if (expandedNodes[fqn]) return
    setExpandingNodes((prev) => new Set(prev).add(fqn))
    try {
      const res = await fetch(`/api/lineage?object=${encodeURIComponent(fqn)}&depth=1`)
      if (!res.ok) return
      const result: LineageResult = await res.json()
      setExpandedNodes((prev) => ({ ...prev, [fqn]: { ...result } }))
    } finally {
      setExpandingNodes((prev) => { const s = new Set(prev); s.delete(fqn); return s })
    }
  }, [expandedNodes])

  const toggleCollapse = useCallback((fqn: string) => {
    setCollapsedNodes((prev) => {
      const s = new Set(prev)
      if (s.has(fqn)) s.delete(fqn)
      else s.add(fqn)
      return s
    })
  }, [])

  // Refresh cache for all nodes currently visible in the graph
  const [refreshing, setRefreshing] = useState(false)
  const refreshCurrentObject = async () => {
    if (!searchObject) return
    setRefreshing(true)
    try {
      // Collect all visible node FQNs (target + upstream + downstream + expanded)
      const allFqns = new Set<string>()
      allFqns.add(searchObject.toUpperCase())
      if (data) {
        for (const n of data.upstream) allFqns.add(n.fqn.toUpperCase())
        for (const n of data.downstream) allFqns.add(n.fqn.toUpperCase())
      }
      for (const expanded of Object.values(expandedNodes)) {
        for (const n of expanded.upstream) allFqns.add(n.fqn.toUpperCase())
        for (const n of expanded.downstream) allFqns.add(n.fqn.toUpperCase())
      }

      await fetch("/api/lineage/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects: Array.from(allFqns) }),
      })
      // Re-trigger lineage load
      const obj = searchObject
      setSearchObject("")
      setExpandedNodes({}); setCollapsedNodes(new Set())
      setTimeout(() => setSearchObject(obj), 100)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      {!initialTarget && (
        <>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative w-full sm:w-[500px]">
              <input
                type="text"
                value={objectInput}
                onChange={(e) => setObjectInput(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="OBJECT_NAME or DATABASE.SCHEMA.OBJECT_NAME"
                className="border border-input rounded-md px-4 py-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full font-mono pr-8"
              />
              {resolving && (
                <Search className="w-4 h-4 absolute right-2.5 top-2.5 text-muted-foreground animate-pulse" />
              )}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-20 max-h-60 overflow-auto">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setObjectInput(s.fqn)
                        setSearchObject(s.fqn)
                        setShowSuggestions(false)
                        setExpandedNodes({}); setCollapsedNodes(new Set())
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-mono hover:bg-muted/50 flex items-center gap-2 border-b border-border last:border-0"
                    >
                      <span className="truncate flex-1">{s.fqn}</span>
                    </button>
                  ))}
                </div>
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
        </>
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
          {/* Refresh + expand status */}
          <div className="flex items-center gap-3">
            {expandingNodes.size > 0 && (
              <span className="text-sm animate-pulse text-muted-foreground">
                Expanding {expandingNodes.size} node{expandingNodes.size > 1 ? "s" : ""}...
              </span>
            )}
            <button
              onClick={refreshCurrentObject}
              disabled={refreshing}
              className="ml-auto px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              {refreshing ? "Refreshing..." : "Refresh Lineage"}
            </button>
          </div>
          <LineageGraph
            target={searchObject}
            upstream={data.upstream}
            downstream={data.downstream}
            expandedNodes={expandedNodes}
            expandingNodes={expandingNodes}
            collapsedNodes={collapsedNodes}
            onExpand={expandNode}
            onToggleCollapse={toggleCollapse}
            status={loadingPhase === "dml" ? "partial" : (loadingPhase || expandingNodes.size > 0) ? "loading" : "complete"}
          />
        </>
      )}
    </div>
  )
}

export function LineageView() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Object Lineage</h2>
      <LineagePanel />
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
  if (t === "AGENT" || t === "RETOOL" || t === "BI_TOOL" || t === "APP" || t === "ETL") return "#0891b2"
  return "#6b7280"
}

function LineageGraph({
  target,
  upstream,
  downstream,
  expandedNodes,
  expandingNodes,
  collapsedNodes,
  onExpand,
  onToggleCollapse,
  status,
}: {
  target: string
  upstream: LineageNode[]
  downstream: LineageNode[]
  expandedNodes: Record<string, ExpandedData>
  expandingNodes: Set<string>
  collapsedNodes: Set<string>
  onExpand: (fqn: string) => void
  onToggleCollapse: (fqn: string) => void
  status: "loading" | "partial" | "complete"
}) {
  const nodeH = 48
  const nodeW = 230
  const hGap = 100
  const vGap = 14

  const { upNodes, downNodes, edges: relationEdges, nodesWithChildren } = buildExpandedTree(upstream, downstream, expandedNodes, target, collapsedNodes)

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
    // Skip self-referencing edges
    if (edge.from.toUpperCase() === edge.to.toUpperCase()) continue

    if (fromPos.x === toPos.x) {
      // Same column — draw a curved line on the left side
      const x = fromPos.x
      const y1 = fromPos.y + nodeH / 2
      const y2 = toPos.y + nodeH / 2
      const curveX = x - 30
      edgePaths.push({
        d: `M ${x} ${y1} C ${curveX} ${y1}, ${curveX} ${y2}, ${x} ${y2}`
      })
    } else {
      const x1 = fromPos.x + nodeW
      const y1 = fromPos.y + nodeH / 2
      const x2 = toPos.x
      const y2 = toPos.y + nodeH / 2
      const midX = x1 + (x2 - x1) / 2

      edgePaths.push({
        d: `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
      })
    }
  }

  const isExpanded = (fqn: string) => fqn in expandedNodes
  const isExpanding = (fqn: string) => expandingNodes.has(fqn)
  const isCollapsed = (fqn: string) => collapsedNodes.has(fqn)
  const hasChildren = (fqn: string) => nodesWithChildren.has(fqn.toUpperCase())

  const [tooltip, setTooltip] = useState<{ node: LineageNode | null; x: number; y: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [showLegend, setShowLegend] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panRef = useRef({ isPanning: false, startX: 0, startY: 0, panX: 0, panY: 0 })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Don't preventDefault — let browser stay responsive
    setScale((s) => Math.min(2, Math.max(0.3, s - e.deltaY * 0.003)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan from direct clicks on the container background (not buttons/nodes)
    if (e.button === 0 && e.target === e.currentTarget) {
      panRef.current = { isPanning: true, startX: e.clientX - pan.x, startY: e.clientY - pan.y, panX: pan.x, panY: pan.y }
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (panRef.current.isPanning) {
      setPan({ x: e.clientX - panRef.current.startX, y: e.clientY - panRef.current.startY })
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    panRef.current.isPanning = false
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
    <div className="rounded-lg bg-[#f8f9fa] dark:bg-zinc-900/50 border border-border relative">
      {/* Controls bar - always visible above graph */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        {/* Color legend */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowLegend(!showLegend) }}
            className="w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 text-xs font-bold flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-600 shadow-sm"
          >?</button>
          {showLegend && (
            <div className="absolute top-8 left-0 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 min-w-[160px] z-20" onClick={(e) => e.stopPropagation()}>
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
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Function / Procedure</span>
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
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#0891b2" }} />
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">Consumer</span>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Zoom + Status */}
        <div className="flex items-center gap-2">
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
              onClick={(e) => { e.stopPropagation(); setScale(1); setPan({ x: 0, y: 0 }) }}
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
      </div>
      {/* Graph area - pan with drag, zoom with scroll */}
      <div
        className="overflow-hidden p-4 relative"
        style={{ cursor: "grab", minHeight: 300 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => { setTooltip(null); setShowLegend(false) }}
      >
      <div className="relative lineage-graph-container" style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width: containerWidth * scale, height: containerHeight * scale, overflow: "visible" }}>
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
              {targetParts[0] && targetSchema ? `${targetParts[0]}.${targetSchema}` : targetSchema}
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
            const collapsed = isCollapsed(node.fqn)
            const nodeHasChildren = hasChildren(node.fqn)
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
                    {node.database ? `${node.database}.${node.schema}` : node.schema}
                  </span>
                </div>
                {expanding && (
                  <div className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-400 shadow flex items-center justify-center" style={{ zIndex: 2 }}>
                    <svg className="w-3 h-3 animate-spin text-amber-600" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {!expanding && nodeHasChildren && !collapsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.fqn) }}
                    className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-400 shadow flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Collapse"
                  >
                    <svg className="w-3 h-3 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="4" y="9" width="12" height="2" rx="1" />
                    </svg>
                  </button>
                )}
                {!expanding && nodeHasChildren && collapsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.fqn) }}
                    className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Expand"
                  >
                    <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                  </button>
                )}
                {!expanding && !nodeHasChildren && !expanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExpand(node.fqn) }}
                    className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Load more"
                  >
                    <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                  </button>
                )}
                {!expanding && !nodeHasChildren && expanded && (
                  <div className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 border border-green-400 shadow flex items-center justify-center" style={{ zIndex: 2 }}>
                    <svg className="w-3 h-3 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
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
            const collapsed = isCollapsed(node.fqn)
            const nodeHasChildren = hasChildren(node.fqn)
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
                    {node.database ? `${node.database}.${node.schema}` : node.schema}
                  </span>
                </div>
                {expanding && (
                  <div className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-400 shadow flex items-center justify-center" style={{ zIndex: 2 }}>
                    <svg className="w-3 h-3 animate-spin text-amber-600" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {!expanding && nodeHasChildren && !collapsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.fqn) }}
                    className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-400 shadow flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Collapse"
                  >
                    <svg className="w-3 h-3 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="4" y="9" width="12" height="2" rx="1" />
                    </svg>
                  </button>
                )}
                {!expanding && nodeHasChildren && collapsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.fqn) }}
                    className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Expand"
                  >
                    <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                  </button>
                )}
                {!expanding && !nodeHasChildren && !expanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onExpand(node.fqn) }}
                    className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-500 shadow flex items-center justify-center hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors"
                    style={{ zIndex: 2 }}
                    title="Load more"
                  >
                    <Plus className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                  </button>
                )}
                {!expanding && !nodeHasChildren && expanded && (
                  <div className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 border border-green-400 shadow flex items-center justify-center" style={{ zIndex: 2 }}>
                    <svg className="w-3 h-3 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
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
  targetFqn: string,
  collapsed: Set<string>
): { upNodes: LineageNode[]; downNodes: LineageNode[]; edges: EdgeRelation[]; nodesWithChildren: Set<string> } {
  const allSeen = new Set<string>()
  allSeen.add(targetFqn.toUpperCase())
  const edges: EdgeRelation[] = []

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

  // Build edges for base upstream nodes using parent_fqn (exact) or level heuristic (fallback)
  for (const node of upNodes) {
    if (node.parent_fqn) {
      edges.push({ from: node.fqn, to: node.parent_fqn, direction: "upstream" })
    } else if ((node.level || 1) === 1) {
      edges.push({ from: node.fqn, to: targetFqn, direction: "upstream" })
    }
  }

  // Build edges for base downstream nodes using parent_fqn (exact) or level heuristic (fallback)
  for (const node of downNodes) {
    if (node.parent_fqn) {
      edges.push({ from: node.parent_fqn, to: node.fqn, direction: "downstream" })
    } else if ((node.level || 1) === 1) {
      edges.push({ from: targetFqn, to: node.fqn, direction: "downstream" })
    }
  }

  // Handle expanded nodes (from "+" clicks)
  for (const [parentFqn, data] of Object.entries(expanded)) {
    const parentUp = upNodes.find((n) => n.fqn.toUpperCase() === parentFqn.toUpperCase())
    const parentDown = downNodes.find((n) => n.fqn.toUpperCase() === parentFqn.toUpperCase())
    const parentNode = parentUp || parentDown

    if (parentNode && data.upstream.length > 0) {
      for (const node of data.upstream) {
        const key = node.fqn.toUpperCase()
        // Always add edge even if node already exists (shows the connection)
        edges.push({ from: node.fqn, to: node.parent_fqn || parentFqn, direction: "upstream" })
        if (!allSeen.has(key)) {
          allSeen.add(key)
          upNodes.push({ ...node, level: (parentNode.level || 1) + 1 })
        }
      }
    }
    if (parentNode && data.downstream.length > 0) {
      for (const node of data.downstream) {
        const key = node.fqn.toUpperCase()
        // Always add edge even if node already exists
        edges.push({ from: node.parent_fqn || parentFqn, to: node.fqn, direction: "downstream" })
        if (!allSeen.has(key)) {
          allSeen.add(key)
          downNodes.push({ ...node, level: (parentNode.level || 1) + 1 })
        }
      }
    }
  }

  // Compute which nodes have children (before collapse filtering)
  const nodesWithChildren = new Set<string>()
  for (const edge of edges) {
    if (edge.direction === "upstream") {
      // from is child, to is parent — parent has children
      nodesWithChildren.add(edge.to.toUpperCase())
    } else {
      // from is parent, to is child — parent has children
      nodesWithChildren.add(edge.from.toUpperCase())
    }
  }

  // Filter out nodes whose parent is collapsed
  // Build parent map from edges
  const parentOf = new Map<string, string>() // child → parent (upstream direction: from is child, to is parent)
  for (const edge of edges) {
    if (edge.direction === "upstream") {
      parentOf.set(edge.from.toUpperCase(), edge.to.toUpperCase())
    } else {
      parentOf.set(edge.to.toUpperCase(), edge.from.toUpperCase())
    }
  }

  // Normalize collapsed set to uppercase for fast lookup
  const collapsedUpper = new Set<string>()
  for (const c of collapsed) collapsedUpper.add(c.toUpperCase())

  const isAncestorCollapsed = (fqn: string): boolean => {
    const visited = new Set<string>()
    let current = parentOf.get(fqn.toUpperCase())
    while (current && !visited.has(current)) {
      visited.add(current)
      if (collapsedUpper.has(current)) return true
      current = parentOf.get(current)
    }
    return false
  }

  const visibleUpNodes = upNodes.filter(n => !isAncestorCollapsed(n.fqn))
  const visibleDownNodes = downNodes.filter(n => !isAncestorCollapsed(n.fqn))

  const visibleFqns = new Set([
    targetFqn.toUpperCase(),
    ...visibleUpNodes.map(n => n.fqn.toUpperCase()),
    ...visibleDownNodes.map(n => n.fqn.toUpperCase()),
  ])

  const visibleEdges = edges.filter(e =>
    visibleFqns.has(e.from.toUpperCase()) && visibleFqns.has(e.to.toUpperCase())
  )

  return { upNodes: visibleUpNodes, downNodes: visibleDownNodes, edges: visibleEdges, nodesWithChildren }
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


