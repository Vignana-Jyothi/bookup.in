/**
 * CalUp — Policies & Refunds Configuration Page
 *
 * Implements granular coach policy controls:
 * - Full refund window (hours)
 * - Partial refund window (hours) & percentage (%)
 * - No refund window (derived from partial refund window)
 * - No-show grace period (minutes)
 * - Maximum reschedules & minimum notice
 * - Payment verification timeout (hours)
 * - Live plain-language policy preview
 */

import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../data/store';
import { ACTIONS } from '../../data/actions';
import { isSupabaseConfigured } from '../../services/supabase/supabaseClient';
import { dbService } from '../../services/supabase/dbService';
import { DEFAULT_POLICY, validatePolicy, generatePolicyText } from '../../utils/policyEngine';
import PillButton from '../../components/ui/PillButton';

export default function Policies() {
  const { state, dispatch, addToast } = useStore();
  const providerId = state.provider?.id;

  const [policy, setPolicy] = useState({
    full_refund_hours: DEFAULT_POLICY.full_refund_hours,
    partial_refund_hours: DEFAULT_POLICY.partial_refund_hours,
    partial_refund_percent: DEFAULT_POLICY.partial_refund_percent,
    no_show_grace_minutes: DEFAULT_POLICY.no_show_grace_minutes,
    max_reschedules: DEFAULT_POLICY.max_reschedules,
    reschedule_min_hours_before: DEFAULT_POLICY.reschedule_min_hours_before,
    payment_verification_timeout_hours: DEFAULT_POLICY.payment_verification_timeout_hours,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load existing policy from database on mount
  useEffect(() => {
    async function loadPolicy() {
      if (providerId) {
        try {
          const loaded = await dbService.getPolicy(providerId);
          if (loaded) {
            setPolicy({
              full_refund_hours: loaded.full_refund_hours ?? DEFAULT_POLICY.full_refund_hours,
              partial_refund_hours: loaded.partial_refund_hours ?? DEFAULT_POLICY.partial_refund_hours,
              partial_refund_percent: loaded.partial_refund_percent ?? DEFAULT_POLICY.partial_refund_percent,
              no_show_grace_minutes: loaded.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes,
              max_reschedules: loaded.max_reschedules ?? DEFAULT_POLICY.max_reschedules,
              reschedule_min_hours_before: loaded.reschedule_min_hours_before ?? DEFAULT_POLICY.reschedule_min_hours_before,
              payment_verification_timeout_hours: loaded.payment_verification_timeout_hours ?? DEFAULT_POLICY.payment_verification_timeout_hours,
            });
          }
        } catch (err) {
          console.warn('Failed to load policy:', err);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    }
    loadPolicy();
  }, [providerId]);

  const updateField = (field, value) => {
    setPolicy(prev => ({
      ...prev,
      [field]: Number(value),
    }));
  };

  // Plain language preview generated live as coach edits
  const plainLanguageText = useMemo(() => {
    return generatePolicyText(policy);
  }, [policy]);

  // Derived: no refund below hours
  const noRefundBelowHours = policy.partial_refund_hours;

  const handleSave = async () => {
    const validation = validatePolicy(policy);
    if (!validation.valid) {
      addToast(validation.errors[0], 'error');
      return;
    }

    setIsSaving(true);
    try {
      if (providerId) {
        await dbService.savePolicy(providerId, {
          ...policy,
          policyText: plainLanguageText,
        });
      }

      dispatch({
        type: ACTIONS.UPDATE_POLICIES,
        payload: {
          ...policy,
          policyText: plainLanguageText,
        },
      });

      addToast('Booking & refund policies saved successfully ✓');
    } catch (err) {
      console.error('Failed to save policy:', err);
      addToast(err.message || 'Failed to save policies.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--color-text)' }}>
            Booking & Refund Policies
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Set authoritative cancellation, refund, reschedule, and no-show rules for all client sessions.
          </p>
        </div>
        <PillButton variant="primary" size="md" onClick={handleSave} disabled={isSaving || loading}>
          {isSaving ? 'Saving...' : 'Save Policy'}
        </PillButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        {/* Settings Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Card 1: Cancellation & Refunds */}
          <div className="card card-padding" style={{ background: '#FFFFFF', borderRadius: '18px', border: '1px solid #E8E7E0' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#0E0E0E' }}>
              Cancellation & Refund Windows
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>100% Refund Window</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    style={{ width: 120 }}
                    value={policy.full_refund_hours}
                    onChange={e => updateField('full_refund_hours', e.target.value)}
                  />
                  <span style={{ fontSize: '14px', color: '#666' }}>hours before session start</span>
                </div>
                <span className="form-hint" style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                  Clients who cancel at least this many hours prior receive a 100% refund.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Partial Refund Window & Percentage</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      min="0"
                      className="form-input"
                      style={{ width: 90 }}
                      value={policy.partial_refund_hours}
                      onChange={e => updateField('partial_refund_hours', e.target.value)}
                    />
                    <span style={{ fontSize: '13px', color: '#666' }}>hours to</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    {policy.full_refund_hours} hours:
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="form-input"
                      style={{ width: 90 }}
                      value={policy.partial_refund_percent}
                      onChange={e => updateField('partial_refund_percent', e.target.value)}
                    />
                    <span style={{ fontSize: '14px', fontWeight: 600 }}>% refund</span>
                  </div>
                </div>
                <span className="form-hint" style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                  Cancellations between {policy.partial_refund_hours}h and {policy.full_refund_hours}h receive a {policy.partial_refund_percent}% refund.
                </span>
              </div>

              {/* Derived non-refundable indicator */}
              <div style={{ padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B' }}>
                  🔒 Non-Refundable Cutoff: Under {noRefundBelowHours} hours
                </div>
                <div style={{ fontSize: '12px', color: '#7F1D1D', marginTop: 2 }}>
                  Automatically derived: Cancellations under {noRefundBelowHours} hour{noRefundBelowHours === 1 ? '' : 's'} receive 0% refund.
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Reschedules & Late Arrival */}
          <div className="card card-padding" style={{ background: '#FFFFFF', borderRadius: '18px', border: '1px solid #E8E7E0' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#0E0E0E' }}>
              Reschedule & Attendance Rules
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Maximum Reschedules Allowed</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    style={{ width: 120 }}
                    value={policy.max_reschedules}
                    onChange={e => updateField('max_reschedules', e.target.value)}
                  />
                  <span style={{ fontSize: '14px', color: '#666' }}>reschedules per booking</span>
                </div>
                <span className="form-hint" style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                  After this limit, clients cannot reschedule and must cancel under policy terms.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Reschedule Minimum Notice</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    style={{ width: 120 }}
                    value={policy.reschedule_min_hours_before}
                    onChange={e => updateField('reschedule_min_hours_before', e.target.value)}
                  />
                  <span style={{ fontSize: '14px', color: '#666' }}>hours before session start</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>No-Show Grace Period</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    style={{ width: 120 }}
                    value={policy.no_show_grace_minutes}
                    onChange={e => updateField('no_show_grace_minutes', e.target.value)}
                  />
                  <span style={{ fontSize: '14px', color: '#666' }}>minutes after start</span>
                </div>
                <span className="form-hint" style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                  "Mark No-Show" button stays locked until session start + {policy.no_show_grace_minutes} min.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Payment Verification Timeout</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    style={{ width: 120 }}
                    value={policy.payment_verification_timeout_hours}
                    onChange={e => updateField('payment_verification_timeout_hours', e.target.value)}
                  />
                  <span style={{ fontSize: '14px', color: '#666' }}>hours to verify payment</span>
                </div>
                <span className="form-hint" style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                  If payment is not confirmed within this window, the slot hold expires.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card card-padding" style={{ background: '#F9F8F4', borderRadius: '18px', border: '1.5px solid #D8D7CF' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span style={{ fontSize: '18px' }}>📜</span>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 800, margin: 0, color: '#0E0E0E' }}>
                Client-Facing Policy Preview
              </h3>
            </div>
            
            <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px', lineHeight: 1.5 }}>
              This exact plain-language text is displayed to clients before booking and stored immutably in their booking snapshot.
            </p>

            <div style={{ background: '#FFFFFF', border: '1px solid #E5E5DE', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', lineHeight: 1.6, color: '#1A1A1A' }}>
              {plainLanguageText.split('\n').map((line, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span>{line}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', padding: '14px', background: 'rgba(198, 241, 53, 0.25)', border: '1px solid rgba(198, 241, 53, 0.8)', borderRadius: '12px', fontSize: '13px', color: '#166534' }}>
              🛡️ <strong>Snapshot Guarantee</strong>: When a client books, your current policy is permanently snapshotted into their booking record. Future edits will never retroactively change rules for existing bookings.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
