import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT
        MONITOR_ID, MONITOR_NAME, TASK_NAME, SCHEDULE_CRON,
        ENABLED, WAREHOUSE, TARGET_TABLE
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS
      WHERE TASK_NAME IS NOT NULL
      ORDER BY MONITOR_NAME
    `)

    const tasks = rows.map((r) => ({
      monitorId: r.MONITOR_ID,
      monitorName: r.MONITOR_NAME,
      taskName: r.TASK_NAME,
      scheduleCron: r.SCHEDULE_CRON,
      enabled: r.ENABLED,
      warehouse: r.WAREHOUSE,
      targetTable: r.TARGET_TABLE,
    }))

    return Response.json(tasks)
  } catch (e) {
    console.error(new Date().toISOString(), "[tasks/scheduled]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load scheduled tasks" },
      { status: 500 }
    )
  }
}
