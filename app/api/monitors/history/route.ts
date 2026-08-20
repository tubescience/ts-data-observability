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
    const monitorId = searchParams.get("monitorId")
    const dateStart = searchParams.get("dateStart") || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const dateEnd = searchParams.get("dateEnd") || new Date().toISOString().slice(0, 10)

    if (!monitorId) {
      return Response.json({ error: "monitorId is required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_MONITOR")
    // Name resolution used to scan V_SPEND_DAILY (300M+ rows) for DISTINCT
    // account/client ids — 3-10s per request. SRC_TS_ACCOUNT_LIST (~760 rows)
    // and SRC_TS_CLIENT_LIST (~230 rows) are the small dimension tables
    // behind it and carry the same id->name mapping plus the account's
    // owning CLIENT_ID, so this also gives us the account->client rollup
    // needed for the "by client" grouping — in under a second.
    const rows = await querySnowflake(`
      WITH account_info AS (
        SELECT
          a.ACCOUNT_ID::VARCHAR AS account_id,
          a.ACCOUNT_NAME AS account_name,
          a.CLIENT_ID::VARCHAR AS client_id,
          c.CLIENT_NAME AS client_name
        FROM TS_PROD_DB.INGEST.SRC_TS_ACCOUNT_LIST a
        LEFT JOIN TS_PROD_DB.INGEST.SRC_TS_CLIENT_LIST c ON c.CLIENT_ID = a.CLIENT_ID
      ), client_info AS (
        SELECT CLIENT_ID::VARCHAR AS client_id, CLIENT_NAME AS client_name
        FROM TS_PROD_DB.INGEST.SRC_TS_CLIENT_LIST
      )
      SELECT
        r.CHECK_TYPE,
        r.TARGET_TABLE,
        r.STATUS,
        r.METRIC_VALUE,
        r.THRESHOLD,
        r.GROUP_VALUE,
        COALESCE(ai.account_name, ci.client_name) AS GROUP_NAME,
        CASE WHEN ai.account_id IS NOT NULL THEN 'account' WHEN ci.client_id IS NOT NULL THEN 'client' ELSE NULL END AS GROUP_KIND,
        ai.client_id AS GROUP_CLIENT_ID,
        COALESCE(ai.client_name, ci.client_name) AS GROUP_CLIENT_NAME,
        -- THRESHOLD is the comparison baseline (e.g. yesterday's value); the
        -- allowed swing (threshold_pct) is per-row in DETAILS since it can be
        -- customized per account, falling back to the check's configured
        -- THRESHOLD_PCT when DETAILS doesn't carry it.
        COALESCE(r.DETAILS:threshold_pct::FLOAT, cfg.THRESHOLD_PCT) AS EFFECTIVE_THRESHOLD_PCT,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE as CHECK_DATE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG cfg ON r.CONFIG_ID = cfg.CONFIG_ID
      LEFT JOIN account_info ai ON ai.account_id = r.GROUP_VALUE::VARCHAR
      LEFT JOIN client_info ci ON ci.client_id = r.GROUP_VALUE::VARCHAR
      WHERE cfg.MONITOR_ID = ${Number(monitorId)}
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
      ORDER BY r.CHECK_TIMESTAMP ASC
    `)

    const results = rows.map((r) => {
      const pct = r.EFFECTIVE_THRESHOLD_PCT
      const hasBand = r.THRESHOLD != null && pct != null
      return {
        checkType: r.CHECK_TYPE,
        targetTable: r.TARGET_TABLE,
        status: r.STATUS,
        metricValue: r.METRIC_VALUE,
        threshold: r.THRESHOLD,
        thresholdMin: hasBand ? r.THRESHOLD * (1 - pct / 100) : null,
        thresholdMax: hasBand ? r.THRESHOLD * (1 + pct / 100) : null,
        groupValue: r.GROUP_VALUE,
        groupName: r.GROUP_NAME || null,
        groupKind: r.GROUP_KIND || null,
        groupClientId: r.GROUP_CLIENT_ID || null,
        groupClientName: r.GROUP_CLIENT_NAME || null,
        checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
        checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
      }
    })

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[monitors/history]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load monitor history" },
      { status: 500 }
    )
  }
}
