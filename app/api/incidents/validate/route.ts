import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { incidentId } = body
    const id = Number(incidentId)

    if (!Number.isInteger(id)) {
      return Response.json({ error: "incidentId is required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`CALL TS_INGEST_DB.OBSERVABILITY.VALIDATE_INCIDENT(${id})`)

    return Response.json({ rows })
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/validate]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to validate incident" },
      { status: 500 }
    )
  }
}
