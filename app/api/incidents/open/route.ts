import { querySnowflake } from "@/lib/snowflake"
import { computeThresholdBand } from "@/lib/threshold-band"
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
      WITH client_names AS (
        -- Sourced from NAME_LOOKUP_CACHE (refreshed daily by OBS_TASK_REFRESH_NAME_CACHE)
        -- instead of rebuilding this DISTINCT scan on every dashboard request -- this
        -- CTE alone ran ~1,400x/month across both warehouses for data that changes rarely.
        SELECT ID AS id, NAME AS name
        FROM TS_INGEST_DB.OBSERVABILITY.NAME_LOOKUP_CACHE WHERE ENTITY_TYPE = 'CLIENT'
      ), account_names AS (
        SELECT ID AS id, NAME AS name
        FROM TS_INGEST_DB.OBSERVABILITY.NAME_LOOKUP_CACHE WHERE ENTITY_TYPE = 'ACCOUNT'
      ), client_check_types AS (
        -- SUM_VALUE_GROUPED/DATA_RECENCY are ambiguous: the same monitor can have
        -- separate configs grouping by CLIENT_ID, ACCOUNT_ID, or PLATFORM, and the
        -- incident itself doesn't record which -- so try client names for these too.
        -- Safe because client_id and account_id are disjoint namespaces (verified:
        -- no id exists as both), so at most one of the two lookups ever matches.
        SELECT check_type FROM VALUES ('SPEND_CLIENT'), ('SRC_SPEND_CLIENT'), ('SUM_VALUE_GROUPED'), ('DATA_RECENCY') AS t(check_type)
      ), account_check_types AS (
        SELECT check_type FROM VALUES ('SPEND_ACCOUNT'), ('SRC_SPEND_ACCOUNT'), ('SUM_VALUE_GROUPED'), ('DATA_RECENCY') AS t(check_type)
      ), names AS (
        SELECT c.id, c.name, ct.check_type FROM client_names c CROSS JOIN client_check_types ct
        UNION ALL
        SELECT a.id, a.name, ct.check_type FROM account_names a CROSS JOIN account_check_types ct
      ), cfg_dedup AS (
        -- OBSERVABILITY_CONFIG isn't guaranteed unique per (MONITOR_ID, CHECK_TYPE) --
        -- some have multiple CONFIG_ID rows (legacy duplicates). Joining on the raw
        -- table fans out incidents that match more than one, so pick just one.
        SELECT MONITOR_ID, CHECK_TYPE, THRESHOLD_PCT
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG
        QUALIFY ROW_NUMBER() OVER (PARTITION BY MONITOR_ID, CHECK_TYPE ORDER BY CONFIG_ID DESC) = 1
      )
      SELECT
        i.INCIDENT_ID, i.INCIDENT_KEY, i.CHECK_TYPE, i.TARGET_TABLE,
        i.GROUP_VALUE, i.SEVERITY, i.STATUS, i.FAILURE_COUNT,
        i.LAST_METRIC, i.LAST_THRESHOLD, i.MONITOR_ID,
        i.SUGGESTED_RESOLUTION, i.SUGGESTED_RESOLUTION_REASON,
        CONVERT_TIMEZONE('America/Los_Angeles', i.FIRST_SEEN) as FIRST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.LAST_SEEN) as LAST_SEEN_PST,
        CONVERT_TIMEZONE('America/Los_Angeles', i.CREATED_AT) as CREATED_AT_PST,
        n.name AS GROUP_NAME,
        i.TAGS AS INCIDENT_TAGS,
        m.TAGS AS MONITOR_TAGS,
        -- The real pass/fail band varies by check: some (ROW_COUNT/VOLUME baseline
        -- mode) already compute and store their own lower/upper; SUM_VALUE_GROUPED's
        -- day-of-week baseline anomaly check flags |z-score| >= 3 from the DOW mean
        -- (LAST_THRESHOLD there is just yesterday's raw value, not a real limit); and
        -- some fall back to a plain +/- pct band. See lib/threshold-band.ts.
        i.LAST_DETAILS:lower::FLOAT AS LAST_LOWER,
        i.LAST_DETAILS:upper::FLOAT AS LAST_UPPER,
        i.LAST_DETAILS:dow_baseline_mean::FLOAT AS LAST_DOW_MEAN,
        i.LAST_DETAILS:dow_baseline_std::FLOAT AS LAST_DOW_STD,
        COALESCE(i.LAST_DETAILS:threshold_pct::FLOAT, cfg.THRESHOLD_PCT) AS EFFECTIVE_THRESHOLD_PCT
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
      LEFT JOIN names n ON n.id = i.GROUP_VALUE::VARCHAR AND n.check_type = i.CHECK_TYPE
      LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS m ON m.MONITOR_ID = i.MONITOR_ID
      LEFT JOIN cfg_dedup cfg ON cfg.MONITOR_ID = i.MONITOR_ID AND cfg.CHECK_TYPE = i.CHECK_TYPE
      WHERE i.STATUS = 'OPEN'
      ORDER BY
        CASE i.SEVERITY WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        i.LAST_SEEN DESC
    `)

    const incidents = rows.map((r) => {
      const band = computeThresholdBand({
        lower: r.LAST_LOWER,
        upper: r.LAST_UPPER,
        dowBaselineMean: r.LAST_DOW_MEAN,
        dowBaselineStd: r.LAST_DOW_STD,
        threshold: r.LAST_THRESHOLD,
        thresholdPct: r.EFFECTIVE_THRESHOLD_PCT,
      })
      return {
        incidentId: r.INCIDENT_ID,
        incidentKey: r.INCIDENT_KEY,
        checkType: r.CHECK_TYPE,
        targetTable: r.TARGET_TABLE,
        groupValue: r.GROUP_VALUE,
        groupName: r.GROUP_NAME || null,
        monitorId: r.MONITOR_ID ?? null,
        severity: r.SEVERITY,
        status: r.STATUS,
        failureCount: r.FAILURE_COUNT,
        lastMetric: r.LAST_METRIC,
        lastThreshold: r.LAST_THRESHOLD,
        thresholdMin: band.min,
        thresholdMax: band.max,
        suggestedResolution: r.SUGGESTED_RESOLUTION || null,
        suggestedResolutionReason: r.SUGGESTED_RESOLUTION_REASON || null,
        firstSeen: toIso(r.FIRST_SEEN_PST),
        lastSeen: toIso(r.LAST_SEEN_PST),
        createdAt: toIso(r.CREATED_AT_PST),
        tags: Array.from(
          new Set(
            [r.MONITOR_TAGS, r.INCIDENT_TAGS]
              .filter(Boolean)
              .flatMap((s: string) => s.split(",").map((t) => t.trim()))
              .filter(Boolean)
          )
        ),
      }
    })

    return Response.json(incidents)
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/open]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load open incidents" },
      { status: 500 }
    )
  }
}
