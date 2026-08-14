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
        i.INCIDENT_ID, i.INCIDENT_KEY, i.CHECK_TYPE, i.TARGET_TABLE,
        i.GROUP_VALUE, i.SEVERITY, i.FAILURE_COUNT, i.RESOLUTION_NOTES,
        CONVERT_TIMEZONE('America/Los_Angeles', i.FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.LAST_SEEN) as LAST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.RESOLVED_AT) as RESOLVED_AT_PST,
        m.TAGS
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
      LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS m ON m.MONITOR_ID = i.MONITOR_ID
      WHERE i.STATUS = 'RESOLVED'
        AND CONVERT_TIMEZONE('America/Los_Angeles', i.RESOLVED_AT)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', i.RESOLVED_AT)::DATE <= '${dateEnd}'
      ORDER BY i.RESOLVED_AT DESC
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
      tags: r.TAGS ? r.TAGS.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
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
