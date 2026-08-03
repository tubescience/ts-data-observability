import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dateStart = searchParams.get("dateStart") || new Date().toISOString().slice(0, 10)
    const dateEnd = searchParams.get("dateEnd") || dateStart

    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT
        INCIDENT_ID, INCIDENT_KEY, CHECK_TYPE, TARGET_TABLE,
        GROUP_VALUE, SEVERITY, FAILURE_COUNT, RESOLUTION_NOTES,
        CONVERT_TIMEZONE('America/Los_Angeles', FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', LAST_SEEN) as LAST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', RESOLVED_AT) as RESOLVED_AT_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
      WHERE STATUS = 'RESOLVED'
        AND CONVERT_TIMEZONE('America/Los_Angeles', RESOLVED_AT)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', RESOLVED_AT)::DATE <= '${dateEnd}'
      ORDER BY RESOLVED_AT DESC
    `)

    const incidents = rows.map((r) => ({
      incidentId: r.INCIDENT_ID,
      incidentKey: r.INCIDENT_KEY,
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      groupValue: r.GROUP_VALUE,
      severity: r.SEVERITY,
      failureCount: r.FAILURE_COUNT,
      resolutionNotes: r.RESOLUTION_NOTES,
      firstSeen: toIso(r.FIRST_SEEN_PST),
      lastSeen: toIso(r.LAST_SEEN_PST),
      resolvedAt: toIso(r.RESOLVED_AT_PST),
    }))

    return Response.json(incidents)
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/resolved]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load resolved incidents" },
      { status: 500 }
    )
  }
}
