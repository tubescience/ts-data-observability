import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { incidentId, incidentIds, resolutionNotes } = body

    const ids: number[] = Array.isArray(incidentIds)
      ? incidentIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id))
      : incidentId != null && Number.isInteger(Number(incidentId))
      ? [Number(incidentId)]
      : []

    if (ids.length === 0) {
      return Response.json({ error: "incidentId or incidentIds is required" }, { status: 400 })
    }
    if (!resolutionNotes || !resolutionNotes.trim()) {
      return Response.json({ error: "resolutionNotes is required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_MONITOR")
    await querySnowflake(`
      UPDATE TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
      SET STATUS = 'RESOLVED',
          RESOLVED_AT = CURRENT_TIMESTAMP(),
          RESOLUTION_NOTES = '${resolutionNotes.replace(/'/g, "''")}',
          UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE INCIDENT_ID IN (${ids.join(",")})
    `)

    return Response.json({ success: true, resolvedCount: ids.length })
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/resolve]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to resolve incident" },
      { status: 500 }
    )
  }
}
