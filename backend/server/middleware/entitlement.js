import { serviceRoleClient } from './auth.js';

function value(data) {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function requireActiveEntitlement(req, res, next) {
  if (!serviceRoleClient) return res.status(503).json({ error: { code: 'SERVICE_TEMPORARILY_UNAVAILABLE', message: 'Subscription storage is unavailable.' } });
  const { data, error } = await serviceRoleClient.rpc('get_merchant_subscription_v1', { p_provider_id: req.providerId });
  if (error) {
    console.error('[Entitlement] Projection failed:', error.message);
    return res.status(503).json({ error: { code: 'SERVICE_TEMPORARILY_UNAVAILABLE', message: 'Subscription status is temporarily unavailable.' } });
  }
  const projection = value(data);
  if (!projection?.allowedActions?.createBookings) {
    return res.status(403).json({
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Active Calup access is required for this action.',
        details: { subscriptionPath: '/dashboard/subscription' },
      },
    });
  }
  req.entitlement = projection.entitlement;
  next();
}
