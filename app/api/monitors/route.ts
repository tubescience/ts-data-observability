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
    const [monitorRows, configRows, lastRunRows] = await Promise.all([
      querySnowflake(`
        SELECT
          MONITOR_ID, MONITOR_NAME, TARGET_DATABASE, TARGET_SCHEMA,
          TARGET_TABLE, ENABLED, OWNER, DESCRIPTION,
          SCHEDULE_CRON, WAREHOUSE, TASK_NAME, TAGS,
          CONVERT_TIMEZONE('America/Los_Angeles', CREATED_AT) as CREATED_AT_PST
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS
        ORDER BY MONITOR_NAME
      `),
      querySnowflake(`
        SELECT
          CONFIG_ID, MONITOR_ID, CHECK_TYPE, ENABLED, SEVERITY,
          THRESHOLD_PCT, THRESHOLD_VALUE, DATE_COLUMN, KEY_COLUMNS,
          NULL_COLUMNS, SUM_COLUMN, GROUP_BY_COLUMN
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG
        ORDER BY MONITOR_ID, CHECK_TYPE
      `),
      querySnowflake(`
        SELECT MONITOR_ID,
          CONVERT_TIMEZONE('America/Los_Angeles', MAX(RUN_START)) AS LAST_RUN
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RUN_LOG
        WHERE STATUS = 'SUCCESS'
        GROUP BY MONITOR_ID
      `).catch(() => [] as Record<string, any>[]),
    ])

    const checksByMonitor: Record<number, any[]> = {}
    for (const c of configRows) {
      const mid = c.MONITOR_ID
      if (!checksByMonitor[mid]) checksByMonitor[mid] = []
      checksByMonitor[mid].push({
        configId: c.CONFIG_ID,
        checkType: c.CHECK_TYPE,
        enabled: c.ENABLED,
        severity: c.SEVERITY,
        thresholdPct: c.THRESHOLD_PCT,
        thresholdValue: c.THRESHOLD_VALUE,
        dateColumn: c.DATE_COLUMN,
        keyColumns: c.KEY_COLUMNS,
        nullColumns: c.NULL_COLUMNS,
        sumColumn: c.SUM_COLUMN,
        groupByColumn: c.GROUP_BY_COLUMN,
      })
    }

    const lastRunByMonitor: Record<number, string> = {}
    for (const r of lastRunRows) {
      if (r.MONITOR_ID) lastRunByMonitor[r.MONITOR_ID] = toIso(r.LAST_RUN) || ""
    }

    const monitors = monitorRows.map((r) => ({
      monitorId: r.MONITOR_ID,
      monitorName: r.MONITOR_NAME,
      targetDatabase: r.TARGET_DATABASE,
      targetSchema: r.TARGET_SCHEMA,
      targetTable: r.TARGET_TABLE,
      enabled: r.ENABLED,
      owner: r.OWNER,
      description: r.DESCRIPTION,
      scheduleCron: r.SCHEDULE_CRON,
      warehouse: r.WAREHOUSE,
      taskName: r.TASK_NAME,
      tags: r.TAGS ? r.TAGS.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      createdAt: toIso(r.CREATED_AT_PST),
      lastRun: lastRunByMonitor[r.MONITOR_ID] || null,
      checks: checksByMonitor[r.MONITOR_ID] || [],
    }))

    return Response.json(monitors)
  } catch (e) {
    console.error(new Date().toISOString(), "[monitors]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load monitors" },
      { status: 500 }
    )
  }
}
