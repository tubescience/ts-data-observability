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
      WITH client_names AS (
        SELECT ID AS id, NAME AS name
        FROM TS_INGEST_DB.OBSERVABILITY.NAME_LOOKUP_CACHE WHERE ENTITY_TYPE = 'CLIENT'
      ), account_names AS (
        SELECT ID AS id, NAME AS name
        FROM TS_INGEST_DB.OBSERVABILITY.NAME_LOOKUP_CACHE WHERE ENTITY_TYPE = 'ACCOUNT'
      ), client_check_types AS (
        -- SUM_VALUE_GROUPED/DATA_RECENCY are ambiguous: the same monitor can have
        -- separate configs grouping by CLIENT_ID, ACCOUNT_ID, or PLATFORM, and the
        -- incident itself doesn't record which -- so try client names for these too.
        SELECT check_type FROM VALUES ('SPEND_CLIENT'), ('SRC_SPEND_CLIENT'), ('SUM_VALUE_GROUPED'), ('DATA_RECENCY') AS t(check_type)
      ), account_check_types AS (
        SELECT check_type FROM VALUES ('SPEND_ACCOUNT'), ('SRC_SPEND_ACCOUNT'), ('SUM_VALUE_GROUPED'), ('DATA_RECENCY') AS t(check_type)
      ), names AS (
        SELECT c.id, c.name, ct.check_type FROM client_names c CROSS JOIN client_check_types ct
        UNION ALL
        SELECT a.id, a.name, ct.check_type FROM account_names a CROSS JOIN account_check_types ct
      )
      SELECT
        i.INCIDENT_ID, i.INCIDENT_KEY, i.CHECK_TYPE, i.TARGET_TABLE,
        i.GROUP_VALUE, i.SEVERITY, i.FAILURE_COUNT, i.RESOLUTION_NOTES, i.MONITOR_ID,
        i.SUGGESTED_RESOLUTION, i.SUGGESTED_RESOLUTION_REASON,
        CONVERT_TIMEZONE('America/Los_Angeles', i.FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.LAST_SEEN) as LAST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.RESOLVED_AT) as RESOLVED_AT_PST,
        n.name AS GROUP_NAME,
        m.TAGS
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
      LEFT JOIN names n ON n.id = i.GROUP_VALUE::VARCHAR AND n.check_type = i.CHECK_TYPE
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
      groupName: r.GROUP_NAME || null,
      monitorId: r.MONITOR_ID ?? null,
      severity: r.SEVERITY,
      failureCount: r.FAILURE_COUNT,
      resolutionNotes: r.RESOLUTION_NOTES,
      suggestedResolution: r.SUGGESTED_RESOLUTION || null,
      suggestedResolutionReason: r.SUGGESTED_RESOLUTION_REASON || null,
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
