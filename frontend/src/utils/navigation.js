/* Disabled navigation enhancement (user request):
const RETURN_KEY = 'calup-settings-recovery-return';

export function merchantBookingPath(slug) {
  return typeof slug === 'string' && /^[A-Za-z0-9._~-]+$/.test(slug) ? `/book/${encodeURIComponent(slug)}?fresh=1` : null;
}

export function rememberSettingsReturn() {
  try { sessionStorage.setItem(RETURN_KEY, '/dashboard/settings'); } catch { /* Storage may be blocked. * / }
}

export function settingsReturnPath() {
  try { return sessionStorage.getItem(RETURN_KEY) === '/dashboard/settings' ? '/dashboard/settings' : null; } catch { return null; }
}

export function clearSettingsReturn() {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* No credentials are stored. * / }
}

export function appointmentFilters(search) {
  const params = new URLSearchParams(search);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const from = validDate(params.get('from')) ? params.get('from') : '';
  const to = validDate(params.get('to')) ? params.get('to') : '';
  return { query: (params.get('q') || '').slice(0, 200), from, to: to && (!from || to >= from) ? to : '' };
}

*/
