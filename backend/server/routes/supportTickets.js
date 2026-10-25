import crypto from 'node:crypto';
import { Router } from 'express';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { requireSupportAdmin } from './adminAuth.js';
export { requireSupportAdmin } from './adminAuth.js';
import { tokenRouteLimiter, bookingCreateLimiter } from '../middleware/rateLimiter.js';
import { customerRequestIsTrusted, getCustomerAccess } from '../utils/customerAccess.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const actions = new Set(['reply', 'acknowledge', 'resolve', 'close', 'reopen', 'escalate']);
const errors = {
  REFUND_REVIEW_PENDING: [409, 'This refund request must be decided and reconciled before closing its support case.'],
  NOT_FOUND: [404, 'Ticket not found.'],
  AUTH_REQUIRED: [401, 'Verify your booking again to access support.'],
  FORBIDDEN: [403, 'You cannot perform this ticket action.'],
  VALIDATION_FAILED: [422, 'Check the ticket details and try again.'],
  TICKET_WINDOW_CLOSED: [409, 'The 15-day complaint window has ended. Contact support@calup.app for an exceptional review.'],
  TOO_MANY_OPEN_TICKETS: [409, 'You already have five active tickets. Continue an existing conversation.'],
  VERSION_CONFLICT: [409, 'This ticket has changed. Refresh it before trying again.'],
  IDEMPOTENCY_CONFLICT: [409, 'This retry does not match the original request.'],
  TICKET_CLOSED: [409, 'Reopen this ticket before replying.'],
  INVALID_TRANSITION: [409, 'This action is not available for the current ticket status.'],
  REOPEN_WINDOW_CLOSED: [409, 'The reopening window has ended. Contact support@calup.app.'],
  RESOLUTION_REQUIRED: [422, 'Enter a resolution of at least 10 characters.'],
  REASON_REQUIRED: [422, 'Enter a reason of at least 10 characters.'],
  ESCALATION_NOT_ELIGIBLE: [409, 'This ticket is not eligible for escalation.'],
};

export async function resolveCustomerSupportContext(req, client) {
  const access = getCustomerAccess(req);
  let kind = req.headers['x-support-context'] === 'payment' ? null : access?.kind;
  let tokenHash = kind === 'management' && access.token ? hash(access.token) : null;
  if (!['reference', 'management'].includes(kind)) {
    if (req.headers['x-support-context'] !== 'payment') return null;
    const cookie = String(req.headers.cookie || '').split(';').find(pair => pair.trim().startsWith('calup_attempt_v1='));
    if (!cookie) return null;
    try {
      const token = decodeURIComponent(cookie.trim().slice('calup_attempt_v1='.length));
      if (!token || token.length > 512) return null;
      kind = 'attempt';
      tokenHash = hash(token);
    } catch { return null; }
  }
  const { data, error } = await client.rpc('support_customer_context_v1', {
    p_kind: kind, p_reference: access?.bookingId || null, p_phone: access?.phone || null, p_token_hash: tokenHash,
  });
  if (error) throw error;
  return data;
}

export function createSupportTicketsRouter(actor, { client = serviceRoleClient, merchantAuth = requireProviderAuth, adminAuth = requireSupportAdmin, customerContext = resolveCustomerSupportContext } = {}) {
  if (!['customer', 'merchant', 'admin'].includes(actor)) throw new Error('Invalid support actor');
  const router = Router();
  router.use(tokenRouteLimiter);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!client) return res.status(503).json({ error: 'Support storage is unavailable.' });
    next();
  });
  if (actor === 'merchant') router.use(merchantAuth);
  if (actor === 'admin') router.use(adminAuth);
  router.use(async (req, res, next) => {
    if (actor === 'customer' && req.method !== 'GET' && !customerRequestIsTrusted(req)) {
      return res.status(403).json({ error: 'Open support from the Calup booking page.' });
    }
    try {
      if (actor === 'customer') {
        req.supportContext = await customerContext(req, client);
        if (!req.supportContext) return res.status(401).json({ error: 'Verify your booking or payment again to access support.' });
      }
      next();
    } catch {
      return res.status(503).json({ error: 'Support is temporarily unavailable.' });
    }
  });

  async function operate(req, res, action) {
    const id = req.params.id || null;
    if (id && !uuidPattern.test(id)) return res.status(404).json({ error: 'Ticket not found.' });
    const payload = action === 'list' ? { offset: Number(req.query.offset || 0) } : action === 'get' ? {} : req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['offset', 'category', 'subject', 'body', 'version'].includes(key)) ||
      (action === 'list' && (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 10000)) ||
      (payload.body !== undefined && (typeof payload.body !== 'string' || payload.body.length > 6000)) ||
      (payload.subject !== undefined && (typeof payload.subject !== 'string' || payload.subject.length > 160)) ||
      (payload.category !== undefined && typeof payload.category !== 'string') ||
      (payload.version !== undefined && (!Number.isInteger(payload.version) || payload.version < 1))) {
      return res.status(422).json({ error: 'Invalid ticket details.' });
    }
    const key = req.headers['idempotency-key'] || null;
    if (!['get', 'list'].includes(action) && (typeof key !== 'string' || !/^[\w-]{16,128}$/.test(key))) {
      return res.status(422).json({ error: 'A valid Idempotency-Key is required.' });
    }
    try {
      const context = req.supportContext || null;
      const { data, error } = await client.rpc('support_ticket_operation_v1', {
        p_actor: actor, p_actor_id: actor === 'customer' ? context.key : req.user.id,
        p_provider_id: actor === 'customer' ? context.providerId : req.providerId || null,
        p_context: context, p_action: action, p_ticket_id: id, p_payload: payload, p_key: key,
      });
      if (error) {
        const entry = Object.entries(errors).find(([code]) => error.message === code);
        if (entry) return res.status(entry[1][0]).json({ error: { code: entry[0], message: entry[1][1] } });
        throw error;
      }
      return res.status(action === 'create' ? 201 : 200).json({ data });
    } catch (error) {
      console.error('[Support] Operation failed', { code: error?.code || 'unknown' });
      return res.status(503).json({ error: 'Support is temporarily unavailable. Retry with the same request.' });
    }
  }
  router.get('/', (req, res) => operate(req, res, 'list'));
  router.get('/:id', (req, res) => operate(req, res, 'get'));
  router.post('/', bookingCreateLimiter, (req, res) => operate(req, res, 'create'));
  router.post('/:id/:action', (req, res) => {
    if (!actions.has(req.params.action)) return res.status(404).json({ error: 'Ticket action not found.' });
    return operate(req, res, req.params.action);
  });
  return router;
}
