import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || ""
  if (q.length < 2) {
    return Response.json({ results: [] })
  }

  const safe = q.toUpperCase().replace(/[^A-Z0-9_%]/g, "")

  try {
    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    const rows = await querySnowflake(`
      SELECT object_fqn AS fqn, MIN(related_type) AS type
      FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
      WHERE object_fqn ILIKE '%${safe}%'
      GROUP BY object_fqn
      ORDER BY object_fqn
      LIMIT 15
    `)

    const results = rows.map((r) => ({ fqn: r.FQN, type: r.TYPE }))
    return Response.json({ results })
  } catch (e) {
    return Response.json({ results: [], error: e instanceof Error ? e.message : "Search failed" })
  }
}
