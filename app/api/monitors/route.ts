import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

// Best-effort platform classification for spend monitors, matched against
// tags, target table, and monitor name (in that order of reliability).
// Monitors that aggregate across platforms (e.g. V_SPEND_DAILY) match none
// of these and fall back to "ALL".
const PLATFORM_KEYWORDS: [string, string][] = [
  ["APPLOVIN", "AppLovin"],
  ["YOUTUBE", "Google"],
  ["GOOGLE", "Google"],
  ["META", "Meta"],
  ["FACEBOOK", "Meta"],
  ["TIKTOK", "TikTok"],
  ["SNAPCHAT", "Snapchat"],
  ["PINTEREST", "Pinterest"],
  ["NORTHBEAM", "Northbeam"],
]

function derivePlatform(tags: string[], targetTable: string, monitorName: string): string {
  const haystack = [...tags, targetTable, monitorName].join(" ").toUpperCase()
  for (const [keyword, label] of PLATFORM_KEYWORDS) {
    if (haystack.includes(keyword)) return label
  }
  return "ALL"
}

// Many monitors have no SCHEDULE_CRON/TASK_NAME of their own, but do run on
// a real Snowflake Task named by convention from the monitor name (e.g.
// "SRC Google" -> OBS_TASK_SRC_GOOGLE). Deriving the candidate name and
// looking it up against SHOW TASKS recovers the actual parent cron instead
// of just naming the batch procedure with no schedule attached.
function deriveTaskName(monitorName: string): string {
  return "OBS_TASK_" + monitorName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function parseTaskSchedule(schedule: string | null): string | null {
  if (!schedule) return null
  const match = schedule.match(/^USING CRON (.+)$/i)
  return match ? match[1] : schedule
}

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const [monitorRows, configRows, lastRunRows, procedureRows, taskRows] = await Promise.all([
      querySnowflake(`
        SELECT
          MONITOR_ID, MONITOR_NAME, TARGET_DATABASE, TARGET_SCHEMA,
          TARGET_TABLE, ENABLED, OWNER, DESCRIPTION,
          SCHEDULE_CRON, WAREHOUSE, TASK_NAME, TAGS,
          CONVERT_TIMEZONE('America/Los_Angeles', CREATED_AT) as CREATED_AT_PST,
          -- SOURCE_LAYER: derived from the TARGET_TABLE naming convention.
          CASE
            WHEN STARTSWITH(UPPER(TARGET_TABLE), 'SRC_') THEN 'RAW'
            WHEN STARTSWITH(UPPER(TARGET_TABLE), 'V_') THEN 'REPORTING'
            WHEN STARTSWITH(UPPER(TARGET_TABLE), 'FCT_')
              OR STARTSWITH(UPPER(TARGET_TABLE), 'STG_')
              OR STARTSWITH(UPPER(TARGET_TABLE), 'DIM_') THEN 'STG'
            ELSE 'UNCLASSIFIED'
          END AS SOURCE_LAYER
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_MONITORS
        ORDER BY MONITOR_NAME
      `),
      querySnowflake(`
        SELECT
          CONFIG_ID, MONITOR_ID, CHECK_TYPE, ENABLED, SEVERITY,
          THRESHOLD_PCT, THRESHOLD_VALUE, DATE_COLUMN, KEY_COLUMNS,
          NULL_COLUMNS, SUM_COLUMN, GROUP_BY_COLUMN,
          -- GRANULARITY: derived from GROUP_BY_COLUMN, falling back to CHECK_TYPE
          -- for the dedicated SPEND_* checks that carry the grain in their name.
          CASE
            WHEN GROUP_BY_COLUMN IN ('ACCOUNT_ID', 'ADVERTISER_ID', 'CUSTOMER_ID') OR CHECK_TYPE = 'SPEND_ACCOUNT' THEN 'ACCOUNT'
            WHEN GROUP_BY_COLUMN = 'CLIENT_ID' OR CHECK_TYPE = 'SPEND_CLIENT' THEN 'CLIENT'
            WHEN GROUP_BY_COLUMN = 'PLATFORM' OR CHECK_TYPE = 'SPEND_PLATFORM' THEN 'PLATFORM'
            ELSE 'TABLE-TOTAL'
          END AS GRANULARITY,
          -- DOMAIN: unambiguous for dedicated SPEND_* check types; heuristic
          -- (SUM_COLUMN name match) for the generic SUM_VALUE* family, since
          -- those can validate non-spend metrics too. "COST" is included
          -- alongside "SPEND" since some sources (e.g. AppLovin) name their
          -- spend column COST instead. Everything else defaults to its own
          -- CHECK_TYPE as the domain label.
          CASE
            WHEN CHECK_TYPE IN ('SPEND_ACCOUNT', 'SPEND_CLIENT', 'SPEND_PLATFORM', 'SRC_SPEND_ACCOUNT', 'SRC_SPEND_CLIENT') THEN 'SPEND'
            WHEN CHECK_TYPE IN ('SUM_VALUE_GROUPED', 'SUM_VALUE', 'SUM_TOTAL')
              AND (UPPER(COALESCE(SUM_COLUMN, '')) LIKE '%SPEND%' OR UPPER(COALESCE(SUM_COLUMN, '')) LIKE '%COST%') THEN 'SPEND'
            ELSE CHECK_TYPE
          END AS DOMAIN
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
      // Monitors without their own SCHEDULE_CRON/TASK_NAME still run — usually
      // via a shared batch procedure (e.g. RUN_PATTERN_BATCH) rather than a
      // per-monitor task. Picking the most-run procedure per monitor surfaces
      // that "runs via a parent job" fact instead of showing a bare "—".
      querySnowflake(`
        SELECT MONITOR_ID, PROCEDURE_NAME, COUNT(*) AS RUN_COUNT
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RUN_LOG
        WHERE STATUS = 'SUCCESS'
        GROUP BY MONITOR_ID, PROCEDURE_NAME
      `).catch(() => [] as Record<string, any>[]),
      querySnowflake(`SHOW TASKS IN SCHEMA TS_INGEST_DB.OBSERVABILITY`).catch(() => [] as Record<string, any>[]),
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
        granularity: c.GRANULARITY,
        domain: c.DOMAIN,
      })
    }

    const lastRunByMonitor: Record<number, string> = {}
    for (const r of lastRunRows) {
      if (r.MONITOR_ID) lastRunByMonitor[r.MONITOR_ID] = toIso(r.LAST_RUN) || ""
    }

    const primaryProcedureByMonitor: Record<number, string> = {}
    const topRunCount: Record<number, number> = {}
    for (const r of procedureRows) {
      const mid = r.MONITOR_ID
      if (!mid || !r.PROCEDURE_NAME) continue
      if (r.RUN_COUNT > (topRunCount[mid] || 0)) {
        topRunCount[mid] = r.RUN_COUNT
        primaryProcedureByMonitor[mid] = r.PROCEDURE_NAME
      }
    }

    // SHOW TASKS columns come back lowercase from the driver, unlike SELECT results.
    const scheduleByTaskName: Record<string, string> = {}
    for (const t of taskRows) {
      if (t.name && t.schedule) scheduleByTaskName[String(t.name).toUpperCase()] = t.schedule
    }

    const monitors = monitorRows.map((r) => {
      const tags = r.TAGS ? r.TAGS.split(",").map((t: string) => t.trim()).filter(Boolean) : []

      // Only look up a parent task when the monitor has no schedule of its
      // own — an explicit SCHEDULE_CRON/TASK_NAME always wins.
      let parentTaskName: string | null = null
      let parentSchedule: string | null = null
      if (!r.SCHEDULE_CRON && !r.TASK_NAME) {
        const candidate = deriveTaskName(r.MONITOR_NAME)
        const schedule = scheduleByTaskName[candidate]
        if (schedule) {
          parentTaskName = candidate
          parentSchedule = parseTaskSchedule(schedule)
        }
      }

      return {
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
        sourceLayer: r.SOURCE_LAYER,
        platform: derivePlatform(tags, r.TARGET_TABLE, r.MONITOR_NAME),
        tags,
        createdAt: toIso(r.CREATED_AT_PST),
        lastRun: lastRunByMonitor[r.MONITOR_ID] || null,
        primaryProcedure: primaryProcedureByMonitor[r.MONITOR_ID] || null,
        parentTaskName,
        parentSchedule,
        checks: checksByMonitor[r.MONITOR_ID] || [],
      }
    })

    return Response.json(monitors)
  } catch (e) {
    console.error(new Date().toISOString(), "[monitors]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load monitors" },
      { status: 500 }
    )
  }
}
