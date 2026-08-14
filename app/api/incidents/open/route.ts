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
      WITH names AS (
        SELECT DISTINCT client_id::VARCHAR AS id, client_name AS name, 'SPEND_CLIENT' AS check_type
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE client_id IS NOT NULL AND client_name IS NOT NULL
        UNION ALL
        SELECT DISTINCT account_id::VARCHAR, account_name, 'SPEND_ACCOUNT'
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE account_id IS NOT NULL AND account_name IS NOT NULL
      )
      SELECT
        i.INCIDENT_ID, i.INCIDENT_KEY, i.CHECK_TYPE, i.TARGET_TABLE,
        i.GROUP_VALUE, i.SEVERITY, i.STATUS, i.FAILURE_COUNT,
        i.LAST_METRIC, i.LAST_THRESHOLD,
        CONVERT_TIMEZONE('America/Los_Angeles', i.FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.LAST_SEEN) as LAST_SEEN_PST,
        n.name AS GROUP_NAME,
        m.TAGS
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
      LEFT JOIN names n ON n.id = i.GROUP_VALUE::VARCHAR AND n.check_type = i.CHECK_TYPE
      LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS m ON m.MONITOR_ID = i.MONITOR_ID
      WHERE i.STATUS = 'OPEN'
      ORDER BY
        CASE i.SEVERITY WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        i.LAST_SEEN DESC
    `)

    const incidents = rows.map((r) => ({
      incidentId: r.INCIDENT_ID,
      incidentKey: r.INCIDENT_KEY,
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      groupValue: r.GROUP_VALUE,
      groupName: r.GROUP_NAME || null,
      severity: r.SEVERITY,
      status: r.STATUS,
      failureCount: r.FAILURE_COUNT,
      lastMetric: r.LAST_METRIC,
      lastThreshold: r.LAST_THRESHOLD,
      firstSeen: toIso(r.FIRST_SEEN_PST),
      lastSeen: toIso(r.LAST_SEEN_PST),
      tags: r.TAGS ? r.TAGS.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
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
