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
    const sp = request.nextUrl.searchParams
    const dateStart = sp.get("dateStart") || new Date().toISOString().slice(0, 10)
    const dateEnd = sp.get("dateEnd") || dateStart

    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      WITH client_names AS (
        SELECT DISTINCT client_id::VARCHAR AS id, client_name AS name
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE client_id IS NOT NULL AND client_name IS NOT NULL
      ), account_names AS (
        SELECT DISTINCT account_id::VARCHAR AS id, account_name AS name
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE account_id IS NOT NULL AND account_name IS NOT NULL
      ), client_check_types AS (
        SELECT check_type FROM VALUES ('SPEND_CLIENT'), ('SRC_SPEND_CLIENT') AS t(check_type)
      ), account_check_types AS (
        SELECT check_type FROM VALUES ('SPEND_ACCOUNT'), ('SRC_SPEND_ACCOUNT'), ('SUM_VALUE_GROUPED'), ('DATA_RECENCY') AS t(check_type)
      ), names AS (
        SELECT c.id, c.name, ct.check_type FROM client_names c CROSS JOIN client_check_types ct
        UNION ALL
        SELECT a.id, a.name, ct.check_type FROM account_names a CROSS JOIN account_check_types ct
      )
      SELECT
        r.RESULT_ID, r.CHECK_TYPE, r.TARGET_TABLE, r.GROUP_VALUE, r.SEVERITY,
        r.METRIC_VALUE, r.THRESHOLD, r.DETAILS, c.MONITOR_ID,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST,
        n.name AS GROUP_NAME,
        i.INCIDENT_ID, i.STATUS AS INCIDENT_STATUS,
        (i.INCIDENT_ID IS NULL AND r.CHECK_TIMESTAMP < DATEADD('HOUR', -2, CURRENT_TIMESTAMP())) AS IS_STALE_ORPHAN
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG c ON r.CONFIG_ID = c.CONFIG_ID
      LEFT JOIN names n ON n.id = r.GROUP_VALUE::VARCHAR AND n.check_type = r.CHECK_TYPE
      LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
        ON i.CHECK_TYPE = r.CHECK_TYPE
        AND i.TARGET_TABLE = r.TARGET_TABLE
        AND i.GROUP_VALUE = r.GROUP_VALUE
        AND r.CHECK_TIMESTAMP BETWEEN i.FIRST_SEEN AND i.LAST_SEEN
      WHERE r.STATUS = 'ANOMALY'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY r.RESULT_ID ORDER BY i.FIRST_SEEN DESC NULLS LAST) = 1
      ORDER BY r.CHECK_TIMESTAMP DESC
    `)

    const anomalies = rows.map((r) => ({
      resultId: r.RESULT_ID,
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      groupValue: r.GROUP_VALUE,
      groupName: r.GROUP_NAME || null,
      severity: r.SEVERITY,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      details: r.DETAILS,
      monitorId: r.MONITOR_ID ?? null,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
      incidentId: r.INCIDENT_ID ?? null,
      isResolved: r.INCIDENT_STATUS === "RESOLVED",
      // No incident was ever opened for this result AND it's old enough that a later sync
      // cycle would already have picked it up if it were still failing -- i.e. a transient
      // blip that self-corrected before SYNC_INCIDENTS' latest-per-key logic ever saw it.
      isStaleOrphan: r.IS_STALE_ORPHAN === true,
    }))

    return Response.json(anomalies)
  } catch (e) {
    console.error(new Date().toISOString(), "[anomalies]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load anomalies" },
      { status: 500 }
    )
  }
}
