export const READ_ROLE = "MCP_MONITOR"
export const WRITE_ROLE = "MCP_ENGINEER"
export const DB_SCHEMA = "TS_INGEST_DB.OBSERVABILITY"

export function withReadRole(sql: string): string {
  return `USE ROLE ${READ_ROLE}; ${sql}`
}

export function withWriteRole(sql: string): string {
  return `USE ROLE ${WRITE_ROLE}; ${sql}`
}
