---
name: "incident ai resolution"
created: "2026-08-12T19:42:09.254Z"
status: pending
---

# Plan: AI-Powered Incident Diagnosis & Resolution

## Overview

Add a "Diagnose & Suggest Fix" button in the incident detail modal that:

1. Runs live SQL to validate if the issue persists
2. Gathers context (task history, lineage, freshness data)
3. Calls **Snowflake Cortex Complete** to suggest resolution steps

---

## 1. New API Route: `/api/incidents/diagnose`

**File:** `app/api/incidents/diagnose/route.ts`

**Input:** POST body with incident metadata:

```json
{
  "checkType": "FRESHNESS",
  "targetTable": "TS_PROD_DB.TGT_ADPIP_READY.FCT_SPEND",
  "groupValue": null,
  "severity": "HIGH",
  "lastMetric": 180,
  "lastThreshold": 60,
  "failureCount": 5
}
```

**Logic:**

1. Run validation queries based on `checkType`:

   - **FRESHNESS**: `SELECT DATEDIFF('minute', MAX(SYSTEM_UPDATE_DATE), CURRENT_TIMESTAMP()) FROM {table}`
   - **ROW\_COUNT**: `SELECT COUNT(*) FROM {table} WHERE ...`
   - **TASK\_STATUS**: Check `TASK_HISTORY` for recent failures on related tasks
   - **GENERIC**: Check if the metric is still above threshold

2. Gather context:

   - Recent task failures touching the table
   - Last successful load timestamp
   - Upstream dependency status

3. Call Cortex Complete:

```sql
SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', prompt)
```

The prompt includes: incident type, table, current validation results, task history, and asks for structured resolution suggestions.

**Output:**

```json
{
  "validation": {
    "stillFailing": true,
    "currentMetric": 185,
    "threshold": 60,
    "lastLoadTime": "2026-08-12 10:30:00",
    "details": "Table is 185 minutes stale (threshold: 60 min)"
  },
  "context": {
    "recentTaskFailures": [...],
    "lastSuccessfulTask": "..."
  },
  "suggestions": [
    {
      "title": "Resume the suspended task",
      "description": "The task TASK_REFRESH_FCT_SPEND appears suspended since Aug 11",
      "sql": "ALTER TASK ... RESUME"
    },
    {
      "title": "Manually trigger a refresh",
      "description": "Run the Coalesce job manually to catch up",
      "action": "manual"
    }
  ]
}
```

---

## 2. UI: Diagnose Button

In the incident detail actions bar (next to "View Lineage" and "Resolve"), add:

```
[🔍 Diagnose & Suggest Fix]
```

- Amber/orange border button style
- On click: calls POST `/api/incidents/diagnose`
- Shows loading spinner: "Diagnosing... (running validation + AI analysis)"

---

## 3. Diagnosis Results Panel

Rendered inline below the chart when results arrive:

```
┌─────────────────────────────────────────┐
│ 🔍 Diagnosis                            │
│                                         │
│ Status: ⚠️ Still Failing                │
│ Current: 185 min stale (threshold: 60)  │
│ Last load: Aug 12 10:30 AM PST          │
│                                         │
│ ─── Suggested Resolutions ───           │
│                                         │
│ 1. Resume the suspended task            │
│    The task appears suspended since...  │
│    [Copy SQL] ALTER TASK ... RESUME     │
│                                         │
│ 2. Manually trigger refresh             │
│    Run the Coalesce job to catch up     │
│                                         │
│ 3. Check upstream dependency            │
│    STG_FACT_SPEND_LOOKUPS may be stale  │
└─────────────────────────────────────────┘
```

- Green badge if validation shows "Resolved"
- Red/amber badge if "Still Failing"
- Each suggestion has a title, description, and optional SQL (with copy button)

---

## 4. Cortex Complete Prompt Design

```
You are a Snowflake data engineer diagnosing a data pipeline incident.

INCIDENT:
- Type: {checkType}
- Table: {targetTable}
- Severity: {severity}
- Failures: {failureCount} consecutive
- Current metric: {currentMetric} (threshold: {threshold})

CONTEXT:
- Last successful load: {lastLoadTime}
- Recent task failures: {taskFailures}
- Upstream tables: {upstreamInfo}

Provide 2-4 actionable resolution suggestions. For each, provide:
1. A short title
2. A brief explanation
3. If applicable, the exact SQL command to fix it

Format as JSON array.
```

---

## Notes

- `maxDuration = 60` since Cortex Complete + validation queries may take time
- The validation queries use the same `MCP_MONITOR` role
- If validation shows the incident is already resolved, the AI still suggests preventive actions
