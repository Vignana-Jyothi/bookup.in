/**
 * CalUp — Policies API Routes
 * Endpoints for managing coach policy settings and retrieving policy rules.
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { DEFAULT_POLICY, validatePolicy, generatePolicyText } from '../services/policyEngine.js';

const router = Router();

function getSupabaseClient() {
  if (serviceRoleClient) return serviceRoleClient;
  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return null;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET /api/policies
 * Authenticated coach fetches their policy settings.
 */
router.get('/', requireProviderAuth, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const providerId = req.providerId;
  try {
    const { data: policy, error } = await supabase
      .from('cancellation_policies')
      .select('*')
      .eq('provider_id', providerId)
      .maybeSingle();

    if (error) throw error;

    const merged = {
      ...DEFAULT_POLICY,
      ...(policy || {}),
    };

    return res.json({
      success: true,
      policy: merged,
      plainLanguage: generatePolicyText(merged),
    });
  } catch (err) {
    console.error('[Policies] GET failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch policy' });
  }
});

/**
 * PUT /api/policies
 * Authenticated coach saves their policy settings with server-side validation.
 */
router.put('/', requireProviderAuth, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const providerId = req.providerId;
  const body = req.body || {};

  const validation = validatePolicy(body);
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.errors.join(' '),
      errors: validation.errors,
    });
  }

  const plainText = generatePolicyText(body);

  const payload = {
    provider_id: providerId,
    full_refund_hours: Number(body.full_refund_hours ?? DEFAULT_POLICY.full_refund_hours),
    partial_refund_hours: Number(body.partial_refund_hours ?? DEFAULT_POLICY.partial_refund_hours),
    partial_refund_percent: Number(body.partial_refund_percent ?? DEFAULT_POLICY.partial_refund_percent),
    no_show_grace_minutes: Number(body.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes),
    max_reschedules: Number(body.max_reschedules ?? DEFAULT_POLICY.max_reschedules),
    reschedule_min_hours_before: Number(body.reschedule_min_hours_before ?? DEFAULT_POLICY.reschedule_min_hours_before),
    payment_verification_timeout_hours: Number(body.payment_verification_timeout_hours ?? DEFAULT_POLICY.payment_verification_timeout_hours),
    policy_text: plainText,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('cancellation_policies')
      .upsert(payload, { onConflict: 'provider_id' })
      .select('*')
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      policy: data,
      plainLanguage: plainText,
      message: 'Policy updated successfully.',
    });
  } catch (err) {
    console.error('[Policies] PUT failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to save policy' });
  }
});

/**
 * GET /api/public/policies/:providerId
 * Public endpoint to fetch policy for booking page.
 */
router.get('/public/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  try {
    const { data: policy } = await supabase
      .from('cancellation_policies')
      .select('*')
      .eq('provider_id', providerId)
      .maybeSingle();

    const merged = {
      ...DEFAULT_POLICY,
      ...(policy || {}),
    };

    return res.json({
      success: true,
      policy: merged,
      plainLanguage: generatePolicyText(merged),
    });
  } catch (err) {
    return res.json({
      success: true,
      policy: DEFAULT_POLICY,
      plainLanguage: generatePolicyText(DEFAULT_POLICY),
    });
  }
});

export default router;
