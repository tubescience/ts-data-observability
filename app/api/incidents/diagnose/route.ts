import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_.]/g, "")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { checkType, targetTable, groupValue, severity, lastMetric, lastThreshold, failureCount } = body

    if (!targetTable || !checkType) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    const table = sanitize(targetTable.toUpperCase())
    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    // Phase 1: Live validation based on check type
    let validation: Record<string, any> = { stillFailing: false, details: "" }

    try {
      if (checkType === "FRESHNESS" || checkType === "DATA_FRESHNESS") {
        const rows = await querySnowflake(
          `SELECT DATEDIFF('minute', MAX(COALESCE(SYSTEM_UPDATE_DATE, SYSTEM_CREATE_DATE)), CURRENT_TIMESTAMP()) AS minutes_stale ` +
          `FROM ${table} LIMIT 1`
        )
        const stale = rows[0]?.MINUTES_STALE
        validation = {
          stillFailing: stale != null && lastThreshold != null && stale > lastThreshold,
          currentMetric: stale,
          threshold: lastThreshold,
          details: stale != null ? `Table is ${stale} minutes stale (threshold: ${lastThreshold} min)` : "Could not determine freshness"
        }
      } else if (checkType === "ROW_COUNT") {
        const rows = await querySnowflake(`SELECT COUNT(*) AS cnt FROM ${table}`)
        const cnt = rows[0]?.CNT
        validation = {
          stillFailing: cnt != null && lastThreshold != null && cnt < lastThreshold,
          currentMetric: cnt,
          threshold: lastThreshold,
          details: `Current row count: ${cnt?.toLocaleString()} (threshold: ${lastThreshold?.toLocaleString()})`
        }
      } else {
        validation = {
          stillFailing: true,
          currentMetric: lastMetric,
          threshold: lastThreshold,
          details: `Last metric: ${lastMetric}, threshold: ${lastThreshold}, ${failureCount} consecutive failures`
        }
      }
    } catch (e) {
      validation = {
        stillFailing: true,
        currentMetric: lastMetric,
        threshold: lastThreshold,
        details: `Validation query failed: ${e instanceof Error ? e.message : "unknown error"}`
      }
    }

    // Phase 2: Gather context - recent task failures
    let taskContext = ""
    try {
      const parts = table.split(".")
      const objName = parts[parts.length - 1]
      const tasks = await querySnowflake(
        "SELECT name, state, scheduled_time, error_message " +
        "FROM SNOWFLAKE.ACCOUNT_USAGE.TASK_HISTORY " +
        "WHERE (query_text ILIKE '%" + objName + "%' OR name ILIKE '%" + objName + "%') " +
        "AND scheduled_time > DATEADD('day', -3, CURRENT_TIMESTAMP()) " +
        "ORDER BY scheduled_time DESC LIMIT 5"
      )
      if (tasks.length > 0) {
        taskContext = tasks.map((t) =>
          `- Task: ${t.NAME}, State: ${t.STATE}, Time: ${t.SCHEDULED_TIME}${t.ERROR_MESSAGE ? ", Error: " + t.ERROR_MESSAGE : ""}`
        ).join("\n")
      }
    } catch {}

    // Phase 3: Check upstream freshness
    let upstreamContext = ""
    try {
      const parts = table.split(".")
      const objName = parts[parts.length - 1]
      const schemaName = parts.length >= 2 ? parts[parts.length - 2] : ""
      const deps = await querySnowflake(
        `SELECT REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME, REFERENCED_OBJECT_DOMAIN ` +
        `FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES ` +
        `WHERE REFERENCING_OBJECT_NAME = '${objName}' AND REFERENCING_SCHEMA = '${schemaName}' LIMIT 5`
      )
      if (deps.length > 0) {
        upstreamContext = deps.map((d) =>
          `- ${d.REFERENCED_DATABASE}.${d.REFERENCED_SCHEMA}.${d.REFERENCED_OBJECT_NAME} (${d.REFERENCED_OBJECT_DOMAIN})`
        ).join("\n")
      }
    } catch {}

    // Phase 4: Call Cortex Complete for suggestions
    const prompt = `You are a Snowflake data engineer diagnosing a data pipeline incident. Provide actionable resolution steps.

INCIDENT:
- Type: ${checkType}
- Table: ${table}
- Severity: ${severity}
- Consecutive failures: ${failureCount}
- Current state: ${validation.details}
- Status: ${validation.stillFailing ? "STILL FAILING" : "APPEARS RESOLVED"}

CONTEXT:
${taskContext ? "Recent task activity:\n" + taskContext : "No recent task activity found."}
${upstreamContext ? "Upstream dependencies:\n" + upstreamContext : "No upstream dependencies found in OBJECT_DEPENDENCIES."}
${groupValue ? "Group/partition affected: " + groupValue : ""}

Provide 2-4 actionable suggestions to resolve or prevent this incident. For each suggestion provide:
- "title": short action title (max 8 words)
- "description": brief explanation (1-2 sentences)
- "sql": the exact SQL command if applicable (or null if manual action)
- "priority": "high", "medium", or "low"

Respond ONLY with a valid JSON array of suggestion objects. No other text.`

    let suggestions: any[] = []
    try {
      const aiRows = await querySnowflake(
        `SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', '${prompt.replace(/'/g, "''")}') AS response`
      )
      const raw = aiRows[0]?.RESPONSE || ""
      // Parse the JSON from the response (may have markdown wrapping)
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      suggestions = [{
        title: "AI analysis unavailable",
        description: `Could not generate suggestions: ${e instanceof Error ? e.message : "unknown error"}`,
        sql: null,
        priority: "medium"
      }]
    }

    return Response.json({ validation, suggestions })
  } catch (e) {
    console.error(new Date().toISOString(), "[diagnose]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Diagnosis failed" },
      { status: 500 }
    )
  }
}
