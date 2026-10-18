import { Router } from 'express';
import { requireSupportAdmin } from './adminAuth.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { config } from '../config.js';
import { whatsappMeetingIsConfigured } from '../services/appointmentWhatsApp.js';
import { bookingRefundsEnabled } from '../services/bookingRefundExecution.js';

export const adminSections = ['overview','merchants','bookings','refunds','support','subscriptions','integrations','audit'];
export function adminIntegrationReadiness() {
  return [
    { name: 'Cashfree', short: 'CF', configured: config.isCashfreeConfigured(), note: `${config.cashfreeEnvironment} configuration` },
    { name: 'Google Calendar', short: 'G', configured: config.isGoogleConfigured(), note: 'App configured; merchant authorization is separate' },
    { name: 'WhatsApp', short: 'WA', configured: whatsappMeetingIsConfigured(), note: 'Appointment sender and template configuration' },
    { name: '2Factor SMS', short: 'SMS', configured: config.isTwoFactorConfigured(), note: 'OTP provider configuration; notification fallback remains pending' },
  ];
}
export function createAdminDashboardRouter({ client = serviceRoleClient, authorize = requireSupportAdmin, readiness = adminIntegrationReadiness } = {}) {
  const router = Router();
  router.use(tokenRouteLimiter, authorize);
  router.get('/:section', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const { section } = req.params;
    const { period = 'all', search = '', filter = 'all', offset = '0' } = req.query;
    if (!adminSections.includes(section)) return res.status(404).json({ error: 'Administrator section not found.' });
    if (Object.keys(req.query).some(key => !['period','search','filter','offset'].includes(key)) ||
      !['today','week','month','all'].includes(period) || !['all','financial','overdue'].includes(filter) ||
      typeof search !== 'string' || search.length > 120 || typeof offset !== 'string' || !/^\d{1,6}$/.test(offset) || Number(offset)>100000) {
      return res.status(422).json({ error: 'Check the administrator filters.' });
    }
    if (!client) return res.status(503).json({ error: 'Administrator data is unavailable.' });
    try {
      const { data, error } = await client.rpc('read_calup_admin_dashboard_v1', {
        p_section: section, p_period: period, p_search: search.trim(), p_filter: filter, p_offset: Number(offset),
      });
      if (error || !data) throw new Error('DATA_UNAVAILABLE');
      let snapshot = data;
      // Current unresolved work must include older complaints, irrespective of summary period.
      if (section === 'overview' && period !== 'all') {
        const backlog = await client.rpc('read_calup_admin_dashboard_v1', {
          p_section: section, p_period: 'all', p_search: search.trim(), p_filter: filter, p_offset: Number(offset),
        });
        if (backlog.error || !backlog.data) throw new Error('DATA_UNAVAILABLE');
        snapshot = { ...backlog.data, metrics: data.metrics, since: data.since };
      }
      res.json({ ...snapshot, environment: config.cashfreeEnvironment, integrations: readiness(), capabilities: { bookingRefundApproval: bookingRefundsEnabled() } });
    } catch {
      res.status(503).json({ error: 'Administrator data is temporarily unavailable. Please retry.' });
    }
  });
  return router;
}
