// Account/client STATUS from SRC_TS_ACCOUNT_LIST/SRC_TS_CLIENT_LIST (active, not
// active, prospective, active - not delivering) -- surfaced so a volume/spend
// anomaly on a known-inactive or prospective account/client can be triaged at a
// glance, instead of needing to look it up separately.
export function GroupStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const style = lower === "active"
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    : lower === "not active"
    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    : lower === "prospective"
    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" // active - not delivering, etc.
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${style}`}>
      {status}
    </span>
  )
}
