"use client"

import { useQuery } from "@tanstack/react-query"

interface TagMeta {
  name: string
  color: string
}

export function useTagColors() {
  const { data } = useQuery<TagMeta[]>({
    queryKey: ["tags"],
    queryFn: () => fetch("/api/tags").then((r) => r.json()),
    staleTime: 60000,
  })

  const colorMap = new Map<string, string>()
  for (const t of data || []) {
    colorMap.set(t.name, t.color)
  }

  return colorMap
}

export function TagBadge({ tag, colorMap }: { tag: string; colorMap: Map<string, string> }) {
  const color = colorMap.get(tag) || "#6b7280"
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {tag}
    </span>
  )
}

export function TagBadges({ tags, colorMap }: { tags: string[]; colorMap: Map<string, string> }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => <TagBadge key={t} tag={t} colorMap={colorMap} />)}
    </div>
  )
}
