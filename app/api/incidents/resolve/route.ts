import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { incidentId, resolutionNotes } = body

    if (!incidentId) {
      return Response.json({ error: "incidentId is required" }, { status: 400 })
    }
    if (!resolutionNotes || !resolutionNotes.trim()) {
      return Response.json({ error: "resolutionNotes is required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_ENGINEER")
    await querySnowflake(`
      UPDATE TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
      SET STATUS = 'RESOLVED',
          RESOLVED_AT = CURRENT_TIMESTAMP(),
          RESOLUTION_NOTES = '${resolutionNotes.replace(/'/g, "''")}',
          UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE INCIDENT_ID = ${incidentId}
    `)

    return Response.json({ success: true })
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/resolve]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to resolve incident" },
      { status: 500 }
    )
  }
}
