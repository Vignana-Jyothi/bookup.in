/**
 * CalUp — Availability Page
 * Weekly schedule, dynamic buffers, and external calendar busy times
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { ACTIONS } from '../../data/actions';
import { DAYS_OF_WEEK, DAY_FULL_LABELS } from '../../utils/helpers';
import { isSupabaseConfigured } from '../../services/supabase/supabaseClient';
import { dbService } from '../../services/supabase/dbService';
import { merchantSchedulingService } from '../../services/booking/merchantSchedulingService';
import PillButton from '../../components/ui/PillButton';
/* Disabled navigation enhancement (user request):
import PageLinks from '../../components/ui/PageLinks';
*/

export default function Availability() {
  const { state, dispatch, addToast } = useStore();
  const availability = state.availability || {
    schedule: DAYS_OF_WEEK.reduce((acc, day) => ({ ...acc, [day]: { available: day !== 'sunday', start: '09:00', end: '18:00' } }), {}),
    bufferTime: 15,
    minNotice: 2,
    maxAdvanceBooking: 30,
  };
  const gcal = state.googleCalendar || { isConnected: false, email: null };
  const [instructors, setInstructors] = useState([]);
  const [selectedInstructorId, setSelectedInstructorId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveInFlight = useRef(false);
  const selectedInstructor = instructors.find(item => item.id === selectedInstructorId) || null;

  useEffect(() => {
    if (state.auth?.isDemoMode || !isSupabaseConfigured()) return;
    merchantSchedulingService.load()
      .then(result => {
        const loaded = result.instructors || [];
        setInstructors(loaded);
        setSelectedInstructorId(current => current || loaded[0]?.id || '');
      })
      .catch(err => console.error('[Availability] Failed to load instructors:', err));
  }, [state.auth?.isDemoMode]);

  const updateInstructor = patch => {
    setInstructors(items => items.map(item => item.id === selectedInstructorId ? { ...item, ...patch } : item));
  };

  const updateInstructorDay = (day, field, value) => {
    if (!selectedInstructor) return;
    updateInstructor({
      schedule: {
        ...selectedInstructor.schedule,
        [day]: { ...selectedInstructor.schedule?.[day], [field]: value },
      },
    });
  };

  const handleSaveInstructor = async () => {
    if (!selectedInstructor) return;
    try {
      const schedule = {};
      for (const day of DAYS_OF_WEEK) {
        schedule[day] = selectedInstructor.schedule?.[day] || { available: false, start: '09:00', end: '18:00' };
      }
      await merchantSchedulingService.updateInstructor(selectedInstructor.id, {
        bufferTime: selectedInstructor.bufferTime,
        minNotice: selectedInstructor.minNotice,
        maxAdvanceBooking: selectedInstructor.maxAdvanceBooking,
      });
      const result = await merchantSchedulingService.saveAvailability(selectedInstructor.id, schedule);
      setInstructors(result.instructors || instructors);
      addToast('Instructor availability updated');
    } catch (err) {
      addToast(err.message || 'Could not save instructor availability.', 'error');
    }
  };

  const updateDay = (day, field, value) => {
    const newSchedule = {
      ...availability.schedule,
      [day]: { ...availability.schedule[day], [field]: value },
    };
    dispatch({ type: ACTIONS.UPDATE_AVAILABILITY, payload: { schedule: newSchedule } });
  };

  const updateSetting = (field, value) => {
    dispatch({ type: ACTIONS.UPDATE_AVAILABILITY, payload: { [field]: value } });
  };

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const normalizedBuffer = Math.min(240, Math.max(0, Math.round(Number(availability.bufferTime) || 0)));
      if (normalizedBuffer !== availability.bufferTime) {
        dispatch({ type: ACTIONS.UPDATE_AVAILABILITY, payload: { bufferTime: normalizedBuffer } });
      }
      if (state.auth?.isDemoMode) {
        addToast('Demo availability updated on this device. Live booking hours were not changed.', 'info');
        return;
      }
      if (!isSupabaseConfigured() || !state.provider?.id) {
        throw new Error('Saving unavailable');
      }
      const saved = await dbService.saveAvailability(state.provider.id, availability.schedule, {
        bufferTime: normalizedBuffer,
        minNotice: availability.minNotice,
        maxAdvanceBooking: availability.maxAdvanceBooking,
      });
      if (saved !== true) throw new Error('Availability was not saved.');
      addToast('Availability saved.');
    } catch {
      setSaveError('We could not save all your availability changes. Your edits remain here. Try Save Changes again.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
{/* Disabled navigation enhancement (user request):
<PageLinks links={[{ to: '/dashboard/services', label: 'Return to services' }, { to: '/dashboard/booking-page', label: 'View booking link' }]} />
*/}
      {/* Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
            Weekly Hours & Rules
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', margin: '3px 0 0' }}>
            Set when clients can book appointments with you.
          </p>
        </div>
        <PillButton variant="primary" size="md" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </PillButton>
      </div>

      {saveError && <p role="alert">{saveError}</p>}

      {/* Weekly Schedule Card */}
      <div
        className="card"
        style={{
          borderRadius: 'var(--radius-card)',
          background: 'var(--theme-bg-card)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-card)',
          padding: '24px 28px',
        }}
      >
        <div style={{ marginBottom: '18px' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
            Working Days & Hours
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', margin: 0 }}>
            Toggle active days and define your working window for client booking.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {DAYS_OF_WEEK.map(day => {
            const isAvailable = availability.schedule[day]?.available || false;
            return (
              <div
                key={day}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-lg)',
                  background: isAvailable ? 'var(--theme-bg-card-subtle)' : 'transparent',
                  border: '1px solid var(--theme-border)',
                  transition: 'all var(--transition-fast)',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', minWidth: '150px' }}>
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={e => updateDay(day, 'available', e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      accentColor: '#0E0E0E',
                      cursor: 'pointer',
                    }}
                  />
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: '14px', fontWeight: isAvailable ? 700 : 500, color: 'var(--color-text)' }}>
                    {DAY_FULL_LABELS[day]}
                  </span>
                </label>

                {isAvailable ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="time"
                      aria-label={`${DAY_FULL_LABELS[day]} opening time`}
                      value={availability.schedule[day]?.start || '09:00'}
                      onChange={e => updateDay(day, 'start', e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--theme-border)',
                        background: 'var(--theme-bg-card)',
                        fontFamily: 'var(--font-family-mono)',
                        fontSize: '13px',
                        color: 'var(--color-text)',
                      }}
                    />
                    <span style={{ color: 'var(--theme-text-muted)', fontSize: '13px' }}>to</span>
                    <input
                      type="time"
                      aria-label={`${DAY_FULL_LABELS[day]} closing time`}
                      value={availability.schedule[day]?.end || '18:00'}
                      onChange={e => updateDay(day, 'end', e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--theme-border)',
                        background: 'var(--theme-bg-card)',
                        fontFamily: 'var(--font-family-mono)',
                        fontSize: '13px',
                        color: 'var(--color-text)',
                      }}
                    />
                  </div>
                ) : (
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--theme-input-bg)',
                    color: 'var(--theme-text-muted)',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    Unavailable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scheduling Rules Card */}
      <div
        className="card"
        style={{
          borderRadius: 'var(--radius-card)',
          background: 'var(--theme-bg-card)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-card)',
          padding: '24px 28px',
        }}
      >
        <div style={{ marginBottom: '18px' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
            Buffer & Advance Booking Rules
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', margin: 0 }}>
            Fine-tune the dynamic slot calculation engine.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="availability-buffer" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
              Buffer between bookings
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input id="availability-buffer"
                type="number"
                min="0"
                max="240"
                step="5"
                value={availability.bufferTime ?? 0}
                onChange={e => updateSetting('bufferTime', Number(e.target.value))}
                style={{
                  width: '100px',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-card-subtle)',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              />
              <span style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>minutes</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--theme-text-muted)' }}>
              Available starts advance by each service duration plus this break. For example, a 60-minute service with a 15-minute buffer starts every 75 minutes.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="availability-notice" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
              Minimum advance notice
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input id="availability-notice"
                type="number"
                min="0"
                value={availability.minNotice ?? 0}
                onChange={e => updateSetting('minNotice', Number(e.target.value))}
                style={{
                  width: '100px',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-card-subtle)',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              />
              <span style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>hours</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--theme-text-muted)' }}>
              Prevents clients from booking too close to start time
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="availability-horizon" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
              Max advance booking window
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input id="availability-horizon"
                type="number"
                min="1"
                value={availability.maxAdvanceBooking || 30}
                onChange={e => updateSetting('maxAdvanceBooking', Number(e.target.value))}
                style={{
                  width: '100px',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-card-subtle)',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              />
              <span style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>days</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--theme-text-muted)' }}>
              How far into the future clients can book
            </span>
          </div>
        </div>
      </div>

      {instructors.length > 0 && (
        <div className="card" style={{ borderRadius: 'var(--radius-card)', background: 'var(--theme-bg-card)', border: '1px solid var(--theme-border)', boxShadow: 'var(--shadow-card)', padding: '24px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '18px' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: '0 0 4px' }}>Instructor hours and rules</h3>
              <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', margin: 0 }}>These hours intersect with the business hours above.</p>
            </div>
            <select aria-label="Instructor schedule" className="form-input" style={{ width: '220px' }} value={selectedInstructorId} onChange={e => setSelectedInstructorId(e.target.value)}>
              {instructors.map(item => <option key={item.id} value={item.id}>{item.name}{item.isOwner ? ' (merchant default)' : ''}</option>)}
            </select>
          </div>

          {selectedInstructor && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {DAYS_OF_WEEK.map(day => {
                  const hours = selectedInstructor.schedule?.[day] || { available: false, start: '09:00', end: '18:00' };
                  return (
                    <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '10px 14px', border: '1px solid var(--theme-border)', borderRadius: 'var(--radius-lg)' }}>
                      <label style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: '145px' }}>
                        <input type="checkbox" checked={Boolean(hours.available)} onChange={e => updateInstructorDay(day, 'available', e.target.checked)} />
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{DAY_FULL_LABELS[day]}</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="time" className="form-input" style={{ width: '125px' }} aria-label={`${DAY_FULL_LABELS[day]} instructor opening time`} value={hours.start} disabled={!hours.available} onChange={e => updateInstructorDay(day, 'start', e.target.value)} />
                        <span style={{ fontSize: '12px', color: 'var(--theme-text-muted)' }}>to</span>
                        <input type="time" className="form-input" style={{ width: '125px' }} aria-label={`${DAY_FULL_LABELS[day]} instructor closing time`} value={hours.end} disabled={!hours.available} onChange={e => updateInstructorDay(day, 'end', e.target.value)} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginTop: '18px' }}>
                {[
                  ['bufferTime', 'Buffer (minutes)', 0, 240],
                  ['minNotice', 'Minimum notice (hours)', 0, 720],
                  ['maxAdvanceBooking', 'Booking window (days)', 1, 365],
                ].map(([field, label, min, max]) => (
                  <label key={field} style={{ fontSize: '12px', fontWeight: 600 }}>
                    {label}
                    <input type="number" className="form-input" min={min} max={max} value={selectedInstructor[field] ?? (field === 'maxAdvanceBooking' ? availability.maxAdvanceBooking : availability[field] ?? 0)} onChange={e => updateInstructor({ [field]: Number(e.target.value) })} />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
                <PillButton variant="secondary" onClick={handleSaveInstructor}>Save Instructor</PillButton>
              </div>
            </>
          )}
        </div>
      )}

      {/* Busy Times from Google Calendar */}
      <div
        className="card"
        style={{
          borderRadius: 'var(--radius-card)',
          background: 'var(--theme-bg-card)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-card)',
          padding: '24px 28px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            
            <div>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                Google Calendar Busy Times
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--theme-text-muted)', margin: 0 }}>
                Two-way calendar sync automatically blocks candidate booking slots.
              </p>
            </div>
          </div>
          {gcal.isConnected && (
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--theme-badge-bg)',
                color: 'var(--theme-badge-text)',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ✓ Active in Slot Engine
            </span>
          )}
        </div>

        {gcal.isConnected ? (
          <div>
            <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', marginBottom: '14px' }}>
              Events from <strong>{gcal.email}</strong> are checked when calculating booking availability.
            </p>
            <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>
              Calendar conflicts are checked for the selected booking date.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', padding: '12px 0 0' }}>
            <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', margin: 0 }}>
              Google Calendar is currently disconnected. Connect in Settings to auto-block personal meetings and commitments.
            </p>
            <Link to="/dashboard/settings" style={{ textDecoration: 'none' }}>
              <PillButton variant="secondary" size="sm" arrow>
                Connect in Settings
              </PillButton>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

