const SAFE_TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

function sanitizedSlot(row) {
  const start = String(row?.start_time || '');
  const end = String(row?.end_time || '');
  const actualEnd = row?.actual_end_time == null ? null : String(row.actual_end_time);
  if (!SAFE_TIME.test(start) || !SAFE_TIME.test(end) || (actualEnd && !SAFE_TIME.test(actualEnd))) return null;
  return { start_time: start, end_time: end, actual_end_time: actualEnd };
}

export function mergeBusySlots(...groups) {
  const unique = new Map();
  for (const row of groups.flat()) {
    const slot = sanitizedSlot(row);
    if (!slot) continue;
    const key = `${slot.start_time}|${slot.end_time}|${slot.actual_end_time || ''}`;
    unique.set(key, slot);
  }
  return [...unique.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
}
