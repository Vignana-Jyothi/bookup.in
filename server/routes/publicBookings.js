/**
 * BookUp — Public Customer Booking Management & Booking Creation API (Phase 4)
 *
 * Public Customer Endpoints:
 * - POST /api/public/bookings                         (Create booking + synchronous WhatsApp notifications)
 * - POST /api/public/bookings/create                  (Alias for booking creation)
 * - GET  /api/public/bookings/manage/:token           (Retrieve appointment by secure token)
 * - POST /api/public/bookings/manage/:token/reschedule (Reschedule appointment + reset reminder)
 * - POST /api/public/bookings/manage/:token/cancel    (Cancel appointment)
 *
 * Security:
 * - Authorizes access exclusively via cryptographically secure management token hash.
 * - Does not require customer authentication or login.
 * - Never exposes auth IDs, provider user_ids, database keys, or calendar credentials.
 * - Never logs raw management tokens.
 * - Dual persistence support: stores management_token_hash / management_token_encrypted
 *   in dedicated columns when available, with notes fallback for pre-migration safety.
 * - WhatsApp failures are safely caught and NEVER alter or roll back the booking.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { googleCalendarService } from '../services/googleCalendar.js';
import { richAutomateService } from '../services/richAutomate.js';
import { emailService } from '../services/email.js';

const router = Router();

const DAYS_LIST = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Backend Supabase client (using service role key if available, falling back to general key)
function getSupabaseClient() {
  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return null;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// In-memory concurrency lock per provider to serialize simultaneous slot bookings and eliminate TOCTOU races
const providerLocks = new Map();
async function withProviderLock(providerId, fn) {
  const currentLock = providerLocks.get(providerId) || Promise.resolve();
  let release;
  const newLock = new Promise(resolve => { release = resolve; });
  providerLocks.set(providerId, currentLock.then(() => newLock));
  await currentLock;
  try {
    return await fn();
  } finally {
    release();
    if (providerLocks.get(providerId) === newLock) {
      providerLocks.delete(providerId);
    }
  }
}

/**
 * SHA-256 hash helper for management token
 */
export function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Internal helper to lookup booking strictly by token hash
 * (with fallback to notes mgmt_hash tag for pre-migration records)
 */
async function findBookingByToken(supabase, token) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);
  if (!tokenHash) return null;

  let data = null;

  // 1. Check management_token_hash column (authoritative)
  try {
    const { data: hashColMatch, error: hashErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('management_token_hash', tokenHash)
      .maybeSingle();
    if (!hashErr && hashColMatch) data = hashColMatch;
  } catch (_e) {
    // Column may be pending migration
  }

  // 2. Backward compatibility fallback: Check notes column for [mgmt_hash:<tokenHash>]
  if (!data) {
    try {
      const { data: noteMatch, error: noteErr } = await supabase
        .from('bookings')
        .select('*, services (*), providers (*)')
        .ilike('notes', `%[mgmt_hash:${tokenHash}]%`)
        .maybeSingle();
      if (!noteErr && noteMatch) data = noteMatch;
    } catch (_e) {
      // Notes query fallback
    }
  }

  return data;
}

/**
 * POST /api/public/bookings (or /api/public/bookings/create)
 * Authoritative booking creation with conflict detection and synchronous WhatsApp notifications.
 */
async function handleCreateBooking(req, res) {
  const {
    providerId,
    serviceId,
    customerName,
    customerEmail,
    customerPhone,
    customerWhatsApp,
    bookingDate,
    startTime,
    notes = '',
    managementToken: providedToken,
    meetingType: requestedMeetingType,
    locationAddress: requestedLocationAddress,
    mapsLink: requestedMapsLink,
  } = req.body;

  if (!providerId || !serviceId || !customerName || !customerPhone || !bookingDate || !startTime) {
    return res.status(400).json({
      success: false,
      error: 'Missing required booking fields (providerId, serviceId, customerName, customerPhone, bookingDate, startTime)',
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !/^\d{2}:\d{2}$/.test(startTime)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid date (YYYY-MM-DD) or time (HH:mm) format',
    });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database service is unavailable' });
  }

  try {
    // 1. Fetch Authoritative Service Details
    const { data: service, error: svcErr } = await supabase
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('provider_id', providerId)
      .eq('active', true)
      .single();

    if (svcErr || !service) {
      console.error('[PublicBookings] Service verification failed:', {
        serviceId,
        providerId,
        svcErr: svcErr ? { message: svcErr.message, code: svcErr.code, details: svcErr.details, hint: svcErr.hint } : null,
        serviceFound: Boolean(service),
      });
      return res.status(400).json({
        success: false,
        error: svcErr ? `Database error during service lookup: ${svcErr.message}` : 'Invalid or inactive service',
        dbError: svcErr?.message,
        dbCode: svcErr?.code,
        dbDetails: svcErr?.details,
      });
    }

    // 2. Fetch Authoritative Provider Details
    const { data: provider, error: provErr } = await supabase
      .from('providers')
      .select('*')
      .eq('id', providerId)
      .single();

    if (provErr || !provider) {
      console.error('[PublicBookings] Provider verification failed:', {
        providerId,
        provErr: provErr ? { message: provErr.message, code: provErr.code, details: provErr.details } : null,
        providerFound: Boolean(provider),
      });
      return res.status(400).json({
        success: false,
        error: provErr ? `Database error during provider lookup: ${provErr.message}` : 'Provider not found',
        dbError: provErr?.message,
        dbCode: provErr?.code,
        dbDetails: provErr?.details,
      });
    }

    const duration = Number(service.duration) || 60;

    const [h, m] = startTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + duration;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    // 3. Google Calendar busy intervals conflict check (pre-RPC, non-blocking)
    try {
      const tz = provider.timezone || 'Asia/Kolkata';
      const gcalBusy = await googleCalendarService.getBusyIntervals(providerId, bookingDate, tz);
      if (gcalBusy?.connected && Array.isArray(gcalBusy.busyTimes) && gcalBusy.busyTimes.length > 0) {
        const conflictsWithGcal = gcalBusy.busyTimes.some(b => {
          const bStart = Number(b.start.split(':')[0]) * 60 + Number(b.start.split(':')[1]);
          const bEnd = Number(b.end.split(':')[0]) * 60 + Number(b.end.split(':')[1]);
          return startMin < bEnd && endMin > bStart;
        });

        if (conflictsWithGcal) {
          return res.status(409).json({
            success: false,
            error: 'Selected time slot conflicts with provider calendar.',
          });
        }
      }
    } catch (_gcalErr) {
      // Non-blocking fallback if calendar provider service is unreachable
    }

    // 4. Generate or use management token
    const rawToken = (providedToken && typeof providedToken === 'string' && providedToken.trim().length >= 16)
      ? providedToken.trim()
      : crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(rawToken);
    const tokenEncrypted = encryptToken(rawToken);

    // 5. Resolve meeting type for the booking
    let resolvedMeetingType = 'online';
    if (requestedMeetingType === 'in-person' || requestedMeetingType === 'online') {
      resolvedMeetingType = requestedMeetingType;
    } else if (service.meeting_type === 'in-person') {
      resolvedMeetingType = 'in-person';
    } else {
      resolvedMeetingType = service.meeting_type || 'online';
    }
    const resolvedLocation = resolvedMeetingType === 'in-person'
      ? (requestedLocationAddress || service.location_address || provider.default_location_address || null)
      : null;
    const resolvedMapsLink = resolvedMeetingType === 'in-person' && resolvedLocation
      ? (requestedMapsLink || service.maps_link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resolvedLocation)}`)
      : null;

    // 6. ATOMIC BOOKING CREATION via PL/pgSQL RPC
    // Eliminates the TOCTOU race: conflict check + insert happen inside a single
    // Postgres transaction with row-level locking (SELECT ... FOR UPDATE).
    const baseNotes = notes ? notes.trim() : '';
    const encodedNotes = `${baseNotes}\n[mgmt_hash:${tokenHash}]\n[mgmt_enc:${tokenEncrypted}]\n[mode:${resolvedMeetingType}]\n[loc:${resolvedLocation || ''}]\n[maps:${resolvedMapsLink || ''}]`.trim();
    let newBooking = null;
    let rpcEndTime = endTime;

    await withProviderLock(providerId, async () => {
      try {
        // Attempt 1: Call 13-parameter atomic RPC (Phase 1 migration)
        const { data: rpcResult, error: rpcError } = await supabase.rpc('create_booking_atomic', {
          p_provider_id: providerId,
          p_service_id: serviceId,
          p_customer_name: customerName.trim(),
          p_customer_email: customerEmail?.trim() || '',
          p_customer_phone: customerPhone.trim(),
          p_customer_whatsapp: (customerWhatsApp || customerPhone).trim(),
          p_booking_date: bookingDate,
          p_start_time: startTime,
          p_notes: encodedNotes,
          p_management_token_hash: tokenHash,
          p_meeting_type: resolvedMeetingType,
          p_location_address: resolvedLocation,
          p_maps_link: resolvedMapsLink,
        });

        if (!rpcError) {
          const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

          if (!result?.success) {
            // Conflict detected atomically
            if (result?.error?.includes('no longer available') || result?.error?.includes('slot')) {
              return res.status(409).json({ success: false, error: result.error });
            }
            return res.status(400).json({ success: false, error: result.error || 'Booking creation failed' });
          }

          newBooking = { id: result.bookingId };
          rpcEndTime = result.endTime || endTime;
        } else {
          // Fallback: If RPC encounters function compilation, overload, or locking conflict (e.g. 0A000)
          console.warn(`[PublicBookings] Atomic RPC error (${rpcError.code}: ${rpcError.message}) - executing resilient direct conflict check & insertion fallback`);

          // 1. Conflict check
          // TODO(hardcoded): 30-minute slot reservation expiry window for unpaid bookings awaiting payment screenshot
          const PAYMENT_RESERVATION_EXPIRY_MS = 30 * 60 * 1000;

          const { data: existingBookings, error: checkErr } = await supabase
            .from('bookings')
            .select('id, start_time, end_time, actual_end_time, payment_status, created_at')
            .eq('provider_id', providerId)
            .eq('booking_date', bookingDate)
            .in('status', ['confirmed', 'completed', 'pending_payment'])
            .neq('payment_status', 'rejected');

          if (!checkErr && existingBookings) {
            const buffer = provider.buffer_time || 15;
            const [sh, sm] = startTime.split(':').map(Number);
            const candStart = (sh * 60) + sm;
            const candEnd = candStart + service.duration + buffer;
            const nowTime = Date.now();

            const hasConflict = existingBookings.some(b => {
              // TODO(hardcoded): Release slot back to available if unpaid booking has no screenshot after 30 minutes
              if (b.payment_status === 'awaiting_payment' && b.created_at) {
                const bookingAge = nowTime - new Date(b.created_at).getTime();
                if (bookingAge > PAYMENT_RESERVATION_EXPIRY_MS) {
                  return false; // Expired reservation, does not block slot
                }
              }

              const [bsh, bsm] = (b.start_time || '00:00').split(':').map(Number);
              const bStart = (bsh * 60) + bsm;
              const endTimeStr = b.actual_end_time || b.end_time || '00:00';
              const [beh, bem] = endTimeStr.split(':').map(Number);
              const bEnd = (beh * 60) + bem + buffer;
              return candStart < bEnd && candEnd > bStart;
            });

            if (hasConflict) {
              return res.status(409).json({ success: false, error: 'This slot is no longer available. Please select another time.' });
            }
          }

          // 2. Upsert customer
          let customerId = null;
          const { data: existingCust } = await supabase.from('customers').select('id').eq('phone', customerPhone.trim()).limit(1).maybeSingle();
          if (existingCust?.id) {
            customerId = existingCust.id;
          } else {
            const { data: newCust } = await supabase.from('customers').insert({
              name: customerName.trim(),
              email: customerEmail?.trim() || null,
              phone: customerPhone.trim(),
              whatsapp: (customerWhatsApp || customerPhone).trim(),
            }).select('id').single();
            customerId = newCust?.id;
          }

          // 3. Insert booking
          const [sh, sm] = startTime.split(':').map(Number);
          const endTotalMin = (sh * 60) + sm + service.duration;
          const endH = String(Math.floor(endTotalMin / 60)).padStart(2, '0');
          const endM = String(endTotalMin % 60).padStart(2, '0');
          const calculatedEndTime = `${endH}:${endM}`;

          const isPaid = (Number(service.price) || 0) > 0;
          const insertPayload = {
            provider_id: providerId,
            service_id: serviceId,
            customer_id: customerId,
            customer_name: customerName.trim(),
            customer_email: customerEmail?.trim() || '',
            customer_phone: customerPhone.trim(),
            customer_whatsapp: (customerWhatsApp || customerPhone).trim(),
            booking_date: bookingDate,
            start_time: startTime,
            end_time: calculatedEndTime,
            status: isPaid ? 'pending_payment' : 'confirmed',
            notes: encodedNotes,
            management_token_hash: tokenHash,
            management_token_encrypted: tokenEncrypted,
            meeting_type: resolvedMeetingType,
            location_address_snapshot: resolvedLocation,
            maps_link_snapshot: resolvedMapsLink,
            payment_status: isPaid ? 'awaiting_payment' : 'not_required',
          };

          const { data: inserted, error: insertErr } = await supabase.from('bookings').insert(insertPayload).select('id').single();
          if (insertErr) {
            // If columns pending migration, retry without snapshot columns
            const fallbackPayload = {
              provider_id: providerId,
              service_id: serviceId,
              customer_id: customerId,
              customer_name: customerName.trim(),
              customer_email: customerEmail?.trim() || '',
              customer_phone: customerPhone.trim(),
              customer_whatsapp: (customerWhatsApp || customerPhone).trim(),
              booking_date: bookingDate,
              start_time: startTime,
              end_time: calculatedEndTime,
              status: isPaid ? 'pending_payment' : 'confirmed',
              notes: encodedNotes,
            };
            const { data: fallbackInserted, error: fbErr } = await supabase.from('bookings').insert(fallbackPayload).select('id').single();
            if (fbErr) throw fbErr;
            newBooking = { id: fallbackInserted.id };
          } else {
            newBooking = { id: inserted.id };
          }
          rpcEndTime = calculatedEndTime;
        }
      } catch (rpcErr) {
        console.error('[PublicBookings] Atomic RPC failed:', rpcErr);
        throw new Error(rpcErr.message || 'Atomic booking creation failed');
      }
    });

    if (res.headersSent) return;

    // 6a. Post-insert updates: management_token_encrypted, meeting type snapshots, payment_status & pending status (non-blocking)
    try {
      const isPaid = (Number(service.price) || 0) > 0;
      const paymentStatus = isPaid ? 'awaiting_payment' : 'not_required';
      const postInsertPayload = {
        management_token_encrypted: tokenEncrypted,
        management_token_hash: tokenHash,
        meeting_type: resolvedMeetingType,
        location_address_snapshot: resolvedLocation,
        maps_link_snapshot: resolvedMapsLink,
        payment_status: paymentStatus,
        status: isPaid ? 'pending_payment' : 'confirmed',
      };
      await supabase.from('bookings').update(postInsertPayload).eq('id', newBooking.id);
    } catch (_postErr) {
      // Non-blocking: columns may be pending migration
    }

    const insertPayload = {
      customer_name: customerName.trim(),
      customer_email: customerEmail?.trim() || '',
      customer_phone: customerPhone.trim(),
      customer_whatsapp: (customerWhatsApp || customerPhone).trim(),
      price: Number(service.price) || 0,
      deposit_status: 'na',
    };

    // 7b. SYNCHRONOUS GOOGLE MEET LINK & CALENDAR EVENT GENERATION
    // Synchronously generate calendar event + Google Meet link before confirmation emails are sent.
    let meetLink = null;
    let googleEventId = null;

    try {
      const gcalBooking = {
        id: newBooking.id,
        date: bookingDate,
        startTime,
        endTime,
        duration,
        serviceName: service.name,
        customerName: insertPayload.customer_name,
        customerEmail: insertPayload.customer_email,
        customerPhone: insertPayload.customer_phone,
        price: insertPayload.price,
        depositStatus: insertPayload.deposit_status,
        notes,
      };

      const gcalRes = await googleCalendarService.createEvent(
        providerId,
        gcalBooking,
        provider.timezone || 'Asia/Kolkata'
      );

      if (gcalRes?.success && gcalRes.eventId) {
        googleEventId = gcalRes.eventId;
        meetLink = gcalRes.meetLink || null;

        // Persist meet_link to database
        if (meetLink) {
          try {
            await supabase.from('bookings').update({ meet_link: meetLink }).eq('id', newBooking.id);
          } catch (_dbErr) {
            console.warn('[PublicBookings] Failed to persist meet_link:', _dbErr.message);
          }
        }

        // Persist google_event_id if column exists
        if (googleEventId) {
          try {
            await supabase.from('bookings').update({ google_event_id: googleEventId }).eq('id', newBooking.id);
          } catch (_e) {
            // Non-fatal if google_event_id column is pending migration
          }
        }
      } else if (!gcalRes?.success) {
        console.error(`[PublicBookings] Google Calendar event creation failed. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${insertPayload.customer_name}" (${insertPayload.customer_email || 'no-email'}), Error: ${gcalRes?.error || gcalRes?.reason || 'Unknown error'}`);
      }
    } catch (gcalErr) {
      // Non-blocking: Meet link generation failure must NEVER cancel, block, or roll back a booking
      console.error(`[PublicBookings] Google Calendar exception. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${insertPayload.customer_name}" (${insertPayload.customer_email || 'no-email'}), Error: ${gcalErr.message || gcalErr}`);
    }

    // 8. SYNCHRONOUS SERVER-SIDE EMAIL NOTIFICATIONS (PRIMARY CHANNEL - Phase 4b)
    const frontendBase = (config.frontendUrl || 'https://calup-in.vercel.app').replace(/\/$/, '');
    const managementUrl = `${frontendBase}/manage/${encodeURIComponent(rawToken)}`;

    let customerEmailMsgId = null;
    let customerEmailError = null;
    let providerEmailMsgId = null;
    let providerEmailError = null;

    try {
      const [customerEmailSend, providerEmailSend] = await Promise.allSettled([
        insertPayload.customer_email
          ? emailService.sendCustomerBookingPendingEmail({
              to: insertPayload.customer_email,
              customerName: insertPayload.customer_name,
              serviceName: service.name,
              providerName: provider.name || provider.business_name || 'Coach',
              bookingDate,
              startTime,
              duration,
            })
          : Promise.resolve({ success: false, skipped: true, error: 'Customer email not provided' }),
        provider.email
          ? emailService.sendCoachBookingAwaitingPaymentEmail({
              to: provider.email,
              providerName: provider.name || provider.business_name || 'Coach',
              customerName: insertPayload.customer_name,
              customerEmail: insertPayload.customer_email,
              customerPhone: insertPayload.customer_phone,
              serviceName: service.name,
              bookingDate,
              startTime,
              duration,
              amount: insertPayload.price || 0,
              screenshotUrl: insertPayload.payment_screenshot_url || null,
              dashboardUrl: `${frontendBase}/dashboard/appointments`,
            })
          : Promise.resolve({ success: false, skipped: true, error: 'Provider email not configured' }),
      ]);

      if (customerEmailSend.status === 'fulfilled' && customerEmailSend.value?.success) {
        customerEmailMsgId = customerEmailSend.value.messageId || null;
      } else if (customerEmailSend.status === 'fulfilled') {
        customerEmailError = customerEmailSend.value?.error || null;
        if (!customerEmailSend.value?.skipped) {
          console.error(`[PublicBookings] Customer booking pending email failed. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${insertPayload.customer_email}", Error: ${customerEmailError}`);
        }
      } else {
        customerEmailError = customerEmailSend.reason?.message || 'Customer booking pending email dispatch failed';
        console.error(`[PublicBookings] Customer booking pending email exception. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${insertPayload.customer_email}", Error: ${customerEmailError}`);
      }

      if (providerEmailSend.status === 'fulfilled' && providerEmailSend.value?.success) {
        providerEmailMsgId = providerEmailSend.value.messageId || null;
      } else if (providerEmailSend.status === 'fulfilled' && !providerEmailSend.value?.skipped) {
        providerEmailError = providerEmailSend.value?.error || null;
        console.error(`[PublicBookings] Coach awaiting payment email failed. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${provider.email}", Error: ${providerEmailError}`);
      } else if (providerEmailSend.status === 'rejected') {
        providerEmailError = providerEmailSend.reason?.message || 'Coach awaiting payment email dispatch failed';
        console.error(`[PublicBookings] Coach awaiting payment email exception. Provider: "${provider.name || provider.business_name || providerId}", Recipient: "${provider.email}", Error: ${providerEmailError}`);
      }

      // Record email dispatch results in Supabase
      const emailUpdateData = {};
      if (customerEmailMsgId) {
        emailUpdateData.customer_confirmation_email_sent_at = new Date().toISOString();
        emailUpdateData.customer_confirmation_email_msg_id = customerEmailMsgId;
      } else if (customerEmailError) {
        emailUpdateData.customer_confirmation_email_error = customerEmailError;
      }

      if (providerEmailMsgId) {
        emailUpdateData.provider_notification_email_sent_at = new Date().toISOString();
        emailUpdateData.provider_notification_email_msg_id = providerEmailMsgId;
      } else if (providerEmailError) {
        emailUpdateData.provider_notification_email_error = providerEmailError;
      }

      if (Object.keys(emailUpdateData).length > 0) {
        try {
          await supabase.from('bookings').update(emailUpdateData).eq('id', newBooking.id);
        } catch (_e) {}
      }
    } catch (emailDispatchErr) {
      // Non-blocking: an email send failure must NEVER cancel, block, or roll back a booking
      console.warn('[PublicBookings] Email notification dispatch non-blocking error:', emailDispatchErr.message);
    }

    // 8b. WHATSAPP NOTIFICATIONS (RichAutomate - Phase 4)
    // Preserved and callable; deferred as primary channel until dedicated sender number is available.
    // To re-enable WhatsApp as secondary or parallel channel, uncomment the dispatch below:
    /*
    try {
      await Promise.allSettled([
        richAutomateService.sendCustomerConfirmation({
          phone: insertPayload.customer_whatsapp,
          customerName: insertPayload.customer_name,
          serviceName: service.name,
          providerName: provider.name || provider.business_name || 'Provider',
          bookingDate,
          startTime,
          duration,
          managementUrl,
        }),
        (provider.phone || provider.whatsapp)
          ? richAutomateService.sendProviderNotification({
              phone: provider.whatsapp || provider.phone,
              customerName: insertPayload.customer_name,
              serviceName: service.name,
              bookingDate,
              startTime,
              duration,
            })
          : Promise.resolve({ success: false, skipped: true }),
      ]);
    } catch (_waErr) {}
    */

    return res.status(201).json({
      success: true,
      bookingId: newBooking.id,
      endTime: rpcEndTime,
      price: service.price,
      depositAmount: service.deposit_amount || 0,
      managementToken: rawToken,
      managementUrl,
      meetLink: meetLink || null,
      meetingType: resolvedMeetingType,
      locationAddress: resolvedLocation,
      mapsLink: resolvedMapsLink,
      email: {
        customerSent: Boolean(customerEmailMsgId),
        customerMessageId: customerEmailMsgId,
        customerError: customerEmailError,
        providerSent: Boolean(providerEmailMsgId),
        providerMessageId: providerEmailMsgId,
        providerError: providerEmailError,
      },
      whatsapp: {
        customerSent: false,
        skipped: true,
        channel: 'email_primary',
      },
    });
  } catch (err) {
    console.error('Error in handleCreateBooking:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal booking creation error' });
  }
}

// Register creation routes
router.post('/', handleCreateBooking);
router.post('/create', handleCreateBooking);

/**
 * GET /api/public/busy-slots?providerId=&date=
 * or GET /api/public/bookings/busy-slots?providerId=&date=
 * Returns sanitized busy time intervals for public slot calculation.
 * Exposes strictly: start_time, end_time, actual_end_time.
 * Strictly excludes payment_status = 'rejected' and cancelled appointments.
 * Never exposes customer name, email, phone, or notes.
 */
router.get('/busy-slots', async (req, res) => {
  const { providerId, date } = req.query;

  if (!providerId || !date) {
    return res.status(400).json({ success: false, error: 'providerId and date are required query parameters' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database service is unavailable' });
  }

  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('start_time, end_time, actual_end_time, status, payment_status, created_at')
      .eq('provider_id', providerId)
      .eq('booking_date', date)
      .in('status', ['confirmed', 'completed']);

    if (error) {
      console.error('[PublicBookings] Error fetching busy slots:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch busy slots' });
    }

    const nowTime = Date.now();
    // TODO(hardcoded): 30-minute slot reservation expiry window for unpaid bookings awaiting payment screenshot
    const PAYMENT_RESERVATION_EXPIRY_MS = 30 * 60 * 1000;

    const busySlots = (data || [])
      .filter(b => {
        if (b.payment_status === 'rejected') return false;
        // Release slot back to available if unpaid booking has no screenshot after 30 minutes
        // TODO(hardcoded): 30-minute slot reservation expiry window
        if (b.payment_status === 'awaiting_payment' && b.created_at) {
          const age = nowTime - new Date(b.created_at).getTime();
          if (age > PAYMENT_RESERVATION_EXPIRY_MS) return false;
        }
        return true;
      })
      .map(b => ({
        start_time: b.start_time,
        end_time: b.end_time,
        actual_end_time: b.actual_end_time || null,
      }));

    return res.json({
      success: true,
      busySlots,
    });
  } catch (err) {
    console.error('[PublicBookings] Exception in busy-slots:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/public/bookings/manage/:token
 * Validates token and returns sanitized appointment projection.
 */
router.get('/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid management token provided' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database service is unavailable' });
  }

  try {
    const bookingRow = await findBookingByToken(supabase, token);
    if (!bookingRow) {
      return res.status(404).json({ success: false, error: 'Appointment not found or invalid management link' });
    }

    const providerId = bookingRow.provider_id;
    const provider = bookingRow.providers || {};
    const service = bookingRow.services || {};

    // Parallel fetch of cancellation policies, active services, and availability
    const [policyRes, servicesRes, availRes] = await Promise.allSettled([
      supabase.from('cancellation_policies').select('*').eq('provider_id', providerId).maybeSingle(),
      supabase.from('services').select('id, name, duration, price, deposit_amount').eq('provider_id', providerId).eq('active', true),
      supabase.from('availability').select('*').eq('provider_id', providerId),
    ]);

    const policy = policyRes.status === 'fulfilled' ? policyRes.value?.data : null;
    const activeServices = servicesRes.status === 'fulfilled' ? (servicesRes.value?.data || []) : [];
    const rawAvail = availRes.status === 'fulfilled' ? (availRes.value?.data || []) : [];

    // Assemble schedule object
    const schedule = {};
    DAYS_LIST.forEach(d => {
      schedule[d] = { available: d !== 'sunday', start: '09:00', end: '18:00' };
    });
    if (rawAvail && rawAvail.length > 0) {
      rawAvail.forEach(row => {
        const day = row.day_of_week?.toLowerCase();
        if (day && schedule[day]) {
          schedule[day] = {
            available: Boolean(row.active),
            start: row.start_time ? String(row.start_time).substring(0, 5) : '09:00',
            end: row.end_time ? String(row.end_time).substring(0, 5) : '18:00',
          };
        }
      });
    }

    const extractTag = (text, tag) => {
      const match = (text || '').match(new RegExp(`\\[${tag}:([^\\]]*)\\]`));
      return match && match[1]?.trim() ? match[1].trim() : null;
    };

    const cleanNotes = (bookingRow.notes || '')
      .replace(/\[mgmt_hash:[^\]]+\]/g, '')
      .replace(/\[mgmt_enc:[^\]]+\]/g, '')
      .replace(/\[mode:[^\]]+\]/g, '')
      .replace(/\[loc:[^\]]*\]/g, '')
      .replace(/\[maps:[^\]]*\]/g, '')
      .trim();
    const managementUrl = `${(config.frontendUrl || 'https://calup-in.vercel.app').replace(/\/$/, '')}/manage/${encodeURIComponent(token)}`;

    const effectiveMeetingType = bookingRow.meeting_type || extractTag(bookingRow.notes, 'mode') || 'online';
    const effectiveLocation = bookingRow.location_address_snapshot || extractTag(bookingRow.notes, 'loc') || null;
    const effectiveMapsLink = bookingRow.maps_link_snapshot || extractTag(bookingRow.notes, 'maps') || (effectiveLocation ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(effectiveLocation)}` : null);

    // Return sanitized customer-facing projection (no internal keys or user IDs)
    return res.json({
      success: true,
      booking: {
        id: bookingRow.id,
        customerName: bookingRow.customer_name,
        customerPhone: bookingRow.customer_phone,
        customerWhatsApp: bookingRow.customer_whatsapp || bookingRow.customer_phone,
        customerEmail: bookingRow.customer_email || '',
        date: bookingRow.booking_date,
        startTime: String(bookingRow.start_time).substring(0, 5),
        endTime: String(bookingRow.end_time).substring(0, 5),
        duration: Number(bookingRow.duration) || 60,
        price: Number(bookingRow.price) || 0,
        depositAmount: Number(bookingRow.deposit_amount) || 0,
        depositStatus: bookingRow.deposit_status || 'na',
        status: bookingRow.status,
        notes: cleanNotes,
        managementUrl,
        meetLink: bookingRow.meet_link || null,
        mode: effectiveMeetingType === 'in-person' ? 'In-person' : (effectiveMeetingType === 'online' ? 'Online' : 'In-person / Online'),
        meetingType: effectiveMeetingType,
        locationAddress: effectiveLocation,
        mapsLink: effectiveMapsLink,
        paymentStatus: bookingRow.payment_status || null,
        paymentScreenshotUrl: bookingRow.payment_screenshot_url || null,
        paymentMarkedPaidAt: bookingRow.payment_marked_paid_at || null,
        paymentConfirmedAt: bookingRow.payment_confirmed_at || null,
        paymentRejectedAt: bookingRow.payment_rejected_at || null,
        paymentRejectedReason: bookingRow.payment_rejected_reason || null,
      },
      provider: {
        id: provider.id,
        name: provider.name || 'Provider',
        businessName: provider.business_name || '',
        slug: provider.slug || 'provider',
        timezone: provider.timezone || 'Asia/Kolkata',
        bufferTime: provider.buffer_time ?? 15,
        minNotice: provider.min_notice ?? 2,
        maxAdvanceBooking: provider.max_advance_booking ?? 30,
        upiId: provider.upi_id || null,
        qrCodeUrl: provider.qr_code_url || null,
      },
      service: {
        id: service.id,
        name: service.name || 'Session',
        duration: Number(service.duration) || 60,
        price: Number(service.price) || 0,
        depositAmount: Number(service.deposit_amount) || 0,
      },
      cancellationPolicy: {
        cancellationWindow: policy?.cancellation_window ?? 12,
        lateCancellationFee: Number(policy?.fee ?? 200),
        policyText: policy?.policy_text || '',
      },
      availability: {
        schedule,
        bufferTime: provider.buffer_time ?? 15,
        minNotice: provider.min_notice ?? 2,
        maxAdvanceBooking: provider.max_advance_booking ?? 30,
      },
      services: activeServices.map(s => ({
        id: s.id,
        name: s.name,
        duration: Number(s.duration) || 60,
        price: Number(s.price) || 0,
        depositAmount: Number(s.deposit_amount) || 0,
      })),
      isManageable: bookingRow.status === 'confirmed',
    });
  } catch (err) {
    console.error('Error fetching customer booking by token:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve booking information' });
  }
});

/**
 * POST /api/public/bookings/manage/:token/reschedule
 * Reschedules appointment after authoritative server-side slot and conflict verification.
 * Automatically resets reminder state so the 2-hour reminder will fire relative to NEW time.
 */
router.post('/:token/reschedule', async (req, res) => {
  const { token } = req.params;
  const { newDate, newTime } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Invalid management token' });
  }

  if (!newDate || !newTime || !/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^\d{2}:\d{2}$/.test(newTime)) {
    return res.status(400).json({ success: false, error: 'Valid newDate (YYYY-MM-DD) and newTime (HH:mm) are required' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const booking = await findBookingByToken(supabase, token);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // Restriction: Cancelled or completed bookings cannot be rescheduled
    if (booking.status === 'cancelled' || booking.status === 'late-cancellation') {
      return res.status(400).json({ success: false, error: 'Cancelled appointments cannot be rescheduled.' });
    }
    if (booking.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Completed appointments cannot be rescheduled.' });
    }

    const providerId = booking.provider_id;
    const duration = Number(booking.duration) || 60;
    const provider = booking.providers || {};
    const service = booking.services || {};

    // PART 5: Enforce cancellation_window on reschedule (same check as cancel)
    // Product decision: BLOCK reschedule within the window (simpler, safer default).
    // To switch to fee-based, change this block to match the cancel handler's fee logic.
    const { data: policy } = await supabase
      .from('cancellation_policies')
      .select('cancellation_window, fee')
      .eq('provider_id', providerId)
      .maybeSingle();

    const cancellationWindow = policy?.cancellation_window ?? 12;
    try {
      const aptTime = new Date(`${booking.booking_date}T${booking.start_time}`).getTime();
      const hoursNotice = (aptTime - Date.now()) / (1000 * 60 * 60);
      if (hoursNotice < cancellationWindow) {
        return res.status(400).json({
          success: false,
          error: `Rescheduling is not allowed within ${cancellationWindow} hours of the appointment. Please contact your provider directly.`,
          hoursRemaining: Math.max(0, Math.round(hoursNotice * 10) / 10),
          cancellationWindow,
        });
      }
    } catch (_e) {
      // If date parsing fails, allow reschedule (fail-open for data issues)
    }

    // Save old date/time for notification emails
    const oldDate = booking.booking_date;
    const oldTime = booking.start_time;

    // 1. Google Calendar busy intervals check when connected
    const [hh, mm] = newTime.split(':').map(Number);
    const startMin = hh * 60 + mm;
    const endMin = startMin + duration;
    const newEndTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    try {
      const tz = provider.timezone || 'Asia/Kolkata';
      const gcalBusy = await googleCalendarService.getBusyIntervals(providerId, newDate, tz);
      if (gcalBusy?.connected && Array.isArray(gcalBusy.busyTimes) && gcalBusy.busyTimes.length > 0) {
        const conflictsWithGcal = gcalBusy.busyTimes.some(b => {
          const bStart = Number(b.start.split(':')[0]) * 60 + Number(b.start.split(':')[1]);
          const bEnd = Number(b.end.split(':')[0]) * 60 + Number(b.end.split(':')[1]);
          return startMin < bEnd && endMin > bStart;
        });

        if (conflictsWithGcal) {
          return res.status(409).json({ success: false, error: 'Selected time slot conflicts with provider calendar.' });
        }
      }
    } catch (_gcalErr) {
      // Non-blocking fallback
    }

    // 2. ATOMIC RESCHEDULE via PL/pgSQL RPC (eliminates TOCTOU race)
    let rpcHandled = false;
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('reschedule_booking_atomic', {
        p_booking_id: booking.id,
        p_new_date: newDate,
        p_new_time: newTime,
      });

      if (!rpcError) {
        const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

        if (!result?.success) {
          if (result?.error?.includes('no longer available') || result?.error?.includes('slot')) {
            return res.status(409).json({ success: false, error: result.error });
          }
          return res.status(400).json({ success: false, error: result.error || 'Reschedule failed' });
        }
        rpcHandled = true;
      } else {
        console.warn(`[PublicBookings] Atomic reschedule RPC failed (${rpcError.code}: ${rpcError.message}) - using resilient conflict check fallback`);
      }
    } catch (rpcErr) {
      console.warn('[PublicBookings] Atomic reschedule RPC caught error - using resilient conflict check fallback:', rpcErr.message);
    }

    if (!rpcHandled) {
      // Fallback if reschedule_booking_atomic is pending migration in DB
      const buffer = provider.buffer_time ?? 15;
      const candStart = startMin;
      const candEnd = endMin + buffer;

      const { data: ebData } = await supabase
        .from('bookings')
        .select('id, start_time, end_time, actual_end_time, status, payment_status')
        .eq('provider_id', providerId)
        .eq('booking_date', newDate)
        .neq('id', booking.id)
        .in('status', ['confirmed', 'completed']);

      const hasConflict = (ebData || [])
        .filter(b => b.payment_status !== 'rejected')
        .some(eb => {
          const ebStart = eb.start_time ? Number(eb.start_time.split(':')[0]) * 60 + Number(eb.start_time.split(':')[1]) : 0;
          const ebEndRaw = eb.actual_end_time || eb.end_time;
          const ebEnd = ebEndRaw ? Number(ebEndRaw.split(':')[0]) * 60 + Number(ebEndRaw.split(':')[1]) : ebStart + 60;
          const ebEndWithBuf = ebEnd + buffer;
          return candStart < ebEndWithBuf && candEnd > ebStart;
        });

      if (hasConflict) {
        return res.status(409).json({ success: false, error: 'Selected time slot is no longer available. Please select another slot.' });
      }

      const updatePayload = {
        booking_date: newDate,
        start_time: newTime,
        end_time: newEndTime,
        updated_at: new Date().toISOString(),
      };

      const { error: baseUpdateErr } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking.id);

      if (baseUpdateErr) throw baseUpdateErr;
    }

    // 3. Update Google Calendar event (non-blocking)
    try {
      const googleEventId = booking.google_event_id;
      if (googleEventId) {
        await googleCalendarService.updateEvent(providerId, googleEventId, {
          id: booking.id,
          date: newDate,
          startTime: newTime,
          endTime: newEndTime,
          duration,
          serviceName: service.name || 'Session',
          customerName: booking.customer_name,
          customerEmail: booking.customer_email,
        }, provider.timezone || 'Asia/Kolkata');
      }
    } catch (_gcalUpdateErr) {
      console.warn('[PublicBookings] Google Calendar update on reschedule failed (non-blocking):', _gcalUpdateErr.message);
    }

    // 4. Send reschedule notification emails (non-blocking)
    try {
      const providerName = provider.name || provider.business_name || 'Coach';
      const serviceName = service.name || 'Session';

      await Promise.allSettled([
        booking.customer_email
          ? emailService.sendRescheduleEmail({
              to: booking.customer_email,
              recipientName: booking.customer_name,
              customerName: booking.customer_name,
              serviceName,
              providerName,
              oldDate,
              oldTime,
              newDate,
              newTime,
              duration,
              isProvider: false,
            })
          : Promise.resolve({ success: false, skipped: true }),
        provider.email
          ? emailService.sendRescheduleEmail({
              to: provider.email,
              recipientName: providerName,
              customerName: booking.customer_name,
              serviceName,
              providerName,
              oldDate,
              oldTime,
              newDate,
              newTime,
              duration,
              isProvider: true,
            })
          : Promise.resolve({ success: false, skipped: true }),
      ]);
    } catch (_emailErr) {
      console.warn('[PublicBookings] Reschedule notification emails failed (non-blocking):', _emailErr.message);
    }

    return res.json({
      success: true,
      message: 'Appointment rescheduled successfully.',
      booking: {
        id: booking.id,
        date: newDate,
        startTime: newTime,
        endTime: newEndTime,
        duration,
        status: booking.status,
      },
    });
  } catch (err) {
    console.error('Error rescheduling booking:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to reschedule appointment. Please try again.' });
  }
});

/**
 * POST /api/public/bookings/manage/:token/cancel
 * Evaluates policy window, updates appointment to cancelled / late-cancellation.
 */
router.post('/:token/cancel', async (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Invalid management token' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const booking = await findBookingByToken(supabase, token);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // If already cancelled, return state idempotently
    if (booking.status === 'cancelled' || booking.status === 'late-cancellation') {
      return res.json({
        success: true,
        alreadyCancelled: true,
        status: booking.status,
      });
    }

    const provider = booking.providers || {};
    const service = booking.services || {};

    // Evaluate policy window
    const { data: policy } = await supabase
      .from('cancellation_policies')
      .select('cancellation_window, fee')
      .eq('provider_id', booking.provider_id)
      .maybeSingle();

    const cancellationWindow = policy?.cancellation_window ?? 12;
    let isWithinFreeWindow = true;

    try {
      const aptTime = new Date(`${booking.booking_date}T${booking.start_time}`).getTime();
      const hoursNotice = (aptTime - Date.now()) / (1000 * 60 * 60);
      isWithinFreeWindow = hoursNotice >= cancellationWindow;
    } catch (_e) {
      isWithinFreeWindow = true;
    }

    const newStatus = isWithinFreeWindow ? 'cancelled' : 'late-cancellation';

    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id);

    if (updateErr) throw updateErr;

    // PART 5: Delete Google Calendar event on cancellation (non-blocking)
    try {
      const googleEventId = booking.google_event_id;
      if (googleEventId) {
        await googleCalendarService.deleteEvent(booking.provider_id, googleEventId);
      }
    } catch (_gcalDelErr) {
      console.warn('[PublicBookings] Google Calendar delete on cancel failed (non-blocking):', _gcalDelErr.message);
    }

    // PART 6: Send cancellation notification emails (non-blocking)
    try {
      const providerName = provider.name || provider.business_name || 'Coach';
      const serviceName = service.name || 'Session';

      await Promise.allSettled([
        booking.customer_email
          ? emailService.sendCancellationEmail({
              to: booking.customer_email,
              recipientName: booking.customer_name,
              customerName: booking.customer_name,
              serviceName,
              providerName,
              bookingDate: booking.booking_date,
              startTime: booking.start_time,
              duration: Number(booking.duration) || 60,
              cancellationStatus: newStatus,
              isProvider: false,
            })
          : Promise.resolve({ success: false, skipped: true }),
        provider.email
          ? emailService.sendCancellationEmail({
              to: provider.email,
              recipientName: providerName,
              customerName: booking.customer_name,
              serviceName,
              providerName,
              bookingDate: booking.booking_date,
              startTime: booking.start_time,
              duration: Number(booking.duration) || 60,
              cancellationStatus: newStatus,
              isProvider: true,
            })
          : Promise.resolve({ success: false, skipped: true }),
      ]);
    } catch (_emailErr) {
      console.warn('[PublicBookings] Cancellation notification emails failed (non-blocking):', _emailErr.message);
    }

    return res.json({
      success: true,
      status: newStatus,
      isWithinFreeWindow,
      depositAmount: Number(booking.deposit_amount) || 0,
      message: 'Appointment cancelled successfully.',
    });
  } catch (err) {
    console.error('Error cancelling booking:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to cancel appointment. Please try again.' });
  }
});

export default router;
