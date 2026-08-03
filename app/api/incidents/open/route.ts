import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT
        INCIDENT_ID, INCIDENT_KEY, CHECK_TYPE, TARGET_TABLE,
        GROUP_VALUE, SEVERITY, STATUS, FAILURE_COUNT,
        LAST_METRIC, LAST_THRESHOLD,
        CONVERT_TIMEZONE('America/Los_Angeles', FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', LAST_SEEN) as LAST_SEEN_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
      WHERE STATUS = 'OPEN'
      ORDER BY
        CASE SEVERITY WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        LAST_SEEN DESC
    `)

    const incidents = rows.map((r) => ({
      incidentId: r.INCIDENT_ID,
      incidentKey: r.INCIDENT_KEY,
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      groupValue: r.GROUP_VALUE,
      severity: r.SEVERITY,
      status: r.STATUS,
      failureCount: r.FAILURE_COUNT,
      lastMetric: r.LAST_METRIC,
      lastThreshold: r.LAST_THRESHOLD,
      firstSeen: toIso(r.FIRST_SEEN_PST),
      lastSeen: toIso(r.LAST_SEEN_PST),
    }))

    return Response.json(incidents)
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/open]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load open incidents" },
      { status: 500 }
    )
  }
}
