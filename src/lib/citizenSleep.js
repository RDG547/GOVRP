export function sleepProgress(needs, now = Date.now()) {
  if (!needs?.sleep_started_at || !needs.sleep_due_at) return { sleeping: false, value: Number(needs?.sleep || 0), remaining: 0 };
  const start = Date.parse(needs.sleep_started_at), due = Date.parse(needs.sleep_due_at);
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return { sleeping: false, value: Number(needs.sleep || 0), remaining: 0 };
  const progress = Math.max(0, Math.min(1, (now - start) / (due - start)));
  return { sleeping: now < due, value: Number(needs.sleep_start_value) + (100 - Number(needs.sleep_start_value)) * progress, remaining: Math.max(0, Math.ceil((due - now) / 1000)) };
}
