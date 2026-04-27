function severityBoost(item) {
  const payload = item.payload || {};
  const magnitude = Number(payload.mag || payload.magnitude || 0);
  if (magnitude >= 5) return 10 * 60 * 1000;

  const move = Math.abs(Number(payload.change_pct || payload.price_change_percentage_24h || payload.percent_change || 0));
  if (move >= 3) return 10 * 60 * 1000;

  if (item.subscriber_count > 50) return 10 * 60 * 1000;
  return 0;
}

export function rankInbox(items) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.published_at || a.ts || a.timestamp || 0) + severityBoost(a);
    const bTime = Date.parse(b.published_at || b.ts || b.timestamp || 0) + severityBoost(b);
    return bTime - aTime;
  });
}
