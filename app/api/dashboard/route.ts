import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    const [summaryRows, openRows, openAnomaliesRows, resolvedTodayRows, byCheckTypeRows, recentTrendRows] = await Promise.all([
      querySnowflake(`
        SELECT STATUS, COUNT(*) as CNT
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE CHECK_TIMESTAMP >= CONVERT_TIMEZONE('America/Los_Angeles', CURRENT_TIMESTAMP())::DATE
        GROUP BY STATUS
      `),
      querySnowflake(`
        SELECT COUNT(*) as CNT FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS WHERE STATUS = 'OPEN'
      `),
      // Same "open" definition as the Anomalies tab's default view: exclude anomalies whose
      // incident was already resolved, and exclude stale orphans (no incident ever opened,
      // and old enough that a self-correction is why none exists).
      querySnowflake(`
        SELECT COUNT(*) as CNT FROM (
          SELECT r.RESULT_ID, i.STATUS AS INCIDENT_STATUS,
            (i.INCIDENT_ID IS NULL AND r.CHECK_TIMESTAMP < DATEADD('HOUR', -2, CURRENT_TIMESTAMP())) AS IS_STALE_ORPHAN
          FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
          LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS i
            ON i.CHECK_TYPE = r.CHECK_TYPE
            AND i.TARGET_TABLE = r.TARGET_TABLE
            AND i.GROUP_VALUE = r.GROUP_VALUE
            AND r.CHECK_TIMESTAMP BETWEEN i.FIRST_SEEN AND i.LAST_SEEN
          WHERE r.STATUS = 'ANOMALY'
            AND r.CHECK_TIMESTAMP >= CONVERT_TIMEZONE('America/Los_Angeles', CURRENT_TIMESTAMP())::DATE
          QUALIFY ROW_NUMBER() OVER (PARTITION BY r.RESULT_ID ORDER BY i.FIRST_SEEN DESC NULLS LAST) = 1
        )
        WHERE NOT IS_STALE_ORPHAN AND COALESCE(INCIDENT_STATUS, 'OPEN') != 'RESOLVED'
      `),
      querySnowflake(`
        SELECT COUNT(*) as CNT FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
        WHERE STATUS = 'RESOLVED'
        AND CONVERT_TIMEZONE('America/Los_Angeles', RESOLVED_AT)::DATE = CONVERT_TIMEZONE('America/Los_Angeles', CURRENT_TIMESTAMP())::DATE
      `),
      querySnowflake(`
        SELECT CHECK_TYPE, STATUS, COUNT(*) as CNT
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE CHECK_TIMESTAMP >= CONVERT_TIMEZONE('America/Los_Angeles', CURRENT_TIMESTAMP())::DATE
        GROUP BY CHECK_TYPE, STATUS
        ORDER BY CHECK_TYPE
      `),
      querySnowflake(`
        SELECT
          CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE as DT,
          COUNT(CASE WHEN STATUS = 'PASS' THEN 1 END) as PASSED,
          COUNT(CASE WHEN STATUS IN ('FAIL','ERROR') THEN 1 END) as FAILED
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE CHECK_TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
          AND STATUS IN ('PASS','FAIL','ERROR')
        GROUP BY 1
        ORDER BY 1
      `),
    ])

    const summary: Record<string, number> = {}
    for (const row of summaryRows) {
      summary[row.STATUS] = row.CNT
    }

    const passed = summary["PASS"] || 0
    const failed = (summary["FAIL"] || 0) + (summary["ERROR"] || 0)
    const anomaliesRaw = summary["ANOMALY"] || 0
    const openAnomalies = openAnomaliesRows[0]?.CNT || 0
    const total = passed + failed + anomaliesRaw
    const healthScore = total > 0 ? Math.round((passed / total) * 100) : 100

    // Group by check type
    const byCheckType: Record<string, { pass: number; fail: number }> = {}
    for (const row of byCheckTypeRows) {
      if (!byCheckType[row.CHECK_TYPE]) byCheckType[row.CHECK_TYPE] = { pass: 0, fail: 0 }
      if (row.STATUS === "PASS") byCheckType[row.CHECK_TYPE].pass += row.CNT
      else if (row.STATUS === "FAIL" || row.STATUS === "ERROR") byCheckType[row.CHECK_TYPE].fail += row.CNT
    }

    const checkTypeBreakdown = Object.entries(byCheckType)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.fail - a.fail)

    // 7-day trend
    const weekTrend = recentTrendRows.map((r) => ({
      date: r.DT instanceof Date ? r.DT.toISOString().slice(0, 10) : String(r.DT).slice(0, 10),
      passed: r.PASSED,
      failed: r.FAILED,
    }))

    return Response.json({
      healthScore,
      passed,
      failed,
      anomalies: openAnomalies,
      openIncidents: openRows[0]?.CNT || 0,
      resolvedToday: resolvedTodayRows[0]?.CNT || 0,
      checkTypeBreakdown,
      weekTrend,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[dashboard]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load dashboard" },
      { status: 500 }
    )
  }
}
