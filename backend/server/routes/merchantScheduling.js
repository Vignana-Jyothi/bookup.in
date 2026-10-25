import { Router } from 'express';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { requireActiveEntitlement } from '../middleware/entitlement.js';

const router = Router();
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function normalizedDays(value) {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.map(day => String(day).toLowerCase()))];
  return days.length > 0 && days.every(day => DAYS.includes(day)) ? days : null;
}

function servicePatch(body, { requireCore = false } = {}) {
  const patch = {};
  const name = body?.name === undefined ? undefined : String(body.name).trim();
  const description = body?.description === undefined ? undefined : String(body.description).trim();
  const duration = body?.duration === undefined ? undefined : Number(body.duration);
  const price = body?.price === undefined ? undefined : Number(body.price);
  if (requireCore && (!name || !description || duration === undefined || price === undefined)) return null;
  if (name !== undefined) {
    if (name.length < 3 || name.length > 120) return null;
    patch.name = name;
  }
  if (description !== undefined) patch.description = description;
  if (duration !== undefined) {
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return null;
    patch.duration = duration;
  }
  if (price !== undefined) {
    if (!Number.isFinite(price) || price < 0) return null;
    patch.price = price;
  }
  if (body?.meetingType !== undefined) {
    if (!['online', 'in-person', 'both'].includes(body.meetingType)) return null;
    patch.meeting_type = body.meetingType;
  }
  if (body?.locationAddress !== undefined) patch.location_address = body.locationAddress || null;
  if (body?.mapsLink !== undefined) patch.maps_link = body.mapsLink || null;
  if (typeof body?.active === 'boolean') patch.active = body.active;
  return patch;
}

async function schedulingProjection(providerId) {
  const { data: instructors, error: instructorError } = await serviceRoleClient.from('instructors')
    .select('id, provider_id, name, active, is_owner, buffer_time, min_notice, max_advance_booking')
    .eq('provider_id', providerId)
    .order('is_owner', { ascending: false })
    .order('name');
  if (instructorError) throw instructorError;

  const instructorIds = (instructors || []).map(item => item.id);
  if (!instructorIds.length) return [];
  const { data: rows, error: availabilityError } = await serviceRoleClient.from('instructor_availability')
    .select('id, instructor_id, day_of_week, start_time, end_time, active')
    .in('instructor_id', instructorIds);
  if (availabilityError) throw availabilityError;

  const byInstructor = new Map();
  for (const row of rows || []) {
    byInstructor.set(row.instructor_id, {
      ...byInstructor.get(row.instructor_id),
      [row.day_of_week]: {
        available: Boolean(row.active),
        start: String(row.start_time).slice(0, 5),
        end: String(row.end_time).slice(0, 5),
      },
    });
  }
  return (instructors || []).map(item => ({
    id: item.id,
    providerId: item.provider_id,
    name: item.name,
    active: item.active,
    isOwner: item.is_owner,
    bufferTime: item.buffer_time,
    minNotice: item.min_notice,
    maxAdvanceBooking: item.max_advance_booking,
    schedule: byInstructor.get(item.id) || {},
  }));
}

async function validateInstructorDays(providerId, instructorId, days) {
  let instructorQuery = serviceRoleClient.from('instructors').select('id')
    .eq('provider_id', providerId).eq('active', true);
  instructorQuery = instructorId
    ? instructorQuery.eq('id', instructorId)
    : instructorQuery.eq('is_owner', true);
  const { data: instructor, error: instructorError } = await instructorQuery.maybeSingle();
  if (instructorError || !instructor) return null;
  const { data: rows, error: scheduleError } = await serviceRoleClient.from('instructor_availability')
    .select('day_of_week')
    .eq('instructor_id', instructor.id)
    .eq('active', true);
  if (scheduleError) return null;
  const activeDays = new Set((rows || []).map(row => row.day_of_week));
  return days.every(day => activeDays.has(day)) ? instructor : null;
}

router.use(requireProviderAuth);

router.get('/', async (req, res) => {
  try {
    const instructors = await schedulingProjection(req.provider.id);
    return res.json({ success: true, instructors });
  } catch (error) {
    console.error('[MerchantScheduling] Load failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not load instructor schedules.' });
  }
});

router.post('/instructors', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 100) {
    return res.status(422).json({ success: false, error: 'Instructor name must be between 2 and 100 characters.' });
  }
  let createdInstructorId = null;
  try {
    const { data: instructor, error } = await serviceRoleClient.from('instructors').insert({
      provider_id: req.provider.id,
      name,
      active: true,
      is_owner: false,
    }).select('id').single();
    if (error) throw error;
    createdInstructorId = instructor.id;

    const { data: merchantAvailability } = await serviceRoleClient.from('availability')
      .select('day_of_week, start_time, end_time, active')
      .eq('provider_id', req.provider.id);
    const rows = DAYS.map(day => {
      const inherited = merchantAvailability?.find(row => String(row.day_of_week).toLowerCase() === day);
      const inheritedStart = String(inherited?.start_time || '').slice(0, 5);
      const inheritedEnd = String(inherited?.end_time || '').slice(0, 5);
      const hasValidHours = validTime(inheritedStart) && validTime(inheritedEnd) && inheritedStart < inheritedEnd;
      return {
        instructor_id: instructor.id,
        day_of_week: day,
        start_time: hasValidHours ? inheritedStart : '09:00',
        end_time: hasValidHours ? inheritedEnd : '18:00',
        active: inherited ? Boolean(inherited.active) : day !== 'sunday',
      };
    });
    const { error: scheduleError } = await serviceRoleClient.from('instructor_availability').insert(rows);
    if (scheduleError) throw scheduleError;

    return res.status(201).json({ success: true, instructors: await schedulingProjection(req.provider.id) });
  } catch (error) {
    if (createdInstructorId) {
      await serviceRoleClient.from('instructors').delete().eq('id', createdInstructorId).eq('provider_id', req.provider.id);
    }
    console.error('[MerchantScheduling] Create instructor failed:', error.message);
    return res.status(500).json({ success: false, error: 'Could not create the instructor.' });
  }
});

router.put('/instructors/:id', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const patch = {};
  if (name) patch.name = name;
  if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
  for (const [input, column, min, max] of [
    ['bufferTime', 'buffer_time', 0, 240],
    ['minNotice', 'min_notice', 0, 720],
    ['maxAdvanceBooking', 'max_advance_booking', 1, 365],
  ]) {
    if (req.body?.[input] === null) patch[column] = null;
    else if (req.body?.[input] !== undefined) {
      const value = Number(req.body[input]);
      if (!Number.isInteger(value) || value < min || value > max) {
        return res.status(422).json({ success: false, error: `${input} is invalid.` });
      }
      patch[column] = value;
    }
  }
  if (!Object.keys(patch).length) return res.status(422).json({ success: false, error: 'No valid changes supplied.' });

  const query = serviceRoleClient.from('instructors').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('provider_id', req.provider.id);
  if (patch.active === false) query.eq('is_owner', false);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) return res.status(500).json({ success: false, error: 'Could not update the instructor.' });
  if (!data) return res.status(404).json({ success: false, error: 'Instructor not found or cannot be deactivated.' });
  return res.json({ success: true, instructors: await schedulingProjection(req.provider.id) });
});

router.put('/instructors/:id/availability', async (req, res) => {
  const schedule = req.body?.schedule;
  if (!schedule || typeof schedule !== 'object') {
    return res.status(422).json({ success: false, error: 'A weekly schedule is required.' });
  }
  const { data: instructor } = await serviceRoleClient.from('instructors').select('id')
    .eq('id', req.params.id).eq('provider_id', req.provider.id).maybeSingle();
  if (!instructor) return res.status(404).json({ success: false, error: 'Instructor not found.' });

  const rows = [];
  for (const day of DAYS) {
    const value = schedule[day];
    if (!value || !validTime(value.start) || !validTime(value.end) || value.end <= value.start) {
      return res.status(422).json({ success: false, error: `Invalid hours for ${day}.` });
    }
    rows.push({ instructor_id: instructor.id, day_of_week: day, start_time: value.start, end_time: value.end, active: Boolean(value.available), updated_at: new Date().toISOString() });
  }
  const { error } = await serviceRoleClient.from('instructor_availability').upsert(rows, { onConflict: 'instructor_id,day_of_week' });
  if (error) return res.status(500).json({ success: false, error: 'Could not save instructor availability.' });
  return res.json({ success: true, instructors: await schedulingProjection(req.provider.id) });
});

router.post('/services', requireActiveEntitlement, async (req, res) => {
  const days = normalizedDays(req.body?.availableWeekdays);
  const instructorId = String(req.body?.instructorId || '').trim();
  const patch = servicePatch(req.body, { requireCore: true });
  if (!patch || !days || (instructorId && !/^[0-9a-f-]{36}$/i.test(instructorId))) {
    return res.status(422).json({ success: false, error: 'Select at least one valid weekday.' });
  }
  const instructor = await validateInstructorDays(req.provider.id, instructorId, days);
  if (!instructor) return res.status(422).json({ success: false, error: 'Service days must be within the instructor’s available days.' });

  const { data, error } = await serviceRoleClient.from('services').insert({
    ...patch,
    provider_id: req.provider.id,
    instructor_id: instructor.id,
    available_weekdays: days,
    deposit_amount: 0,
    active: true,
  }).select('*').single();
  if (error) return res.status(500).json({ success: false, error: 'Could not create the service.' });
  return res.status(201).json({ success: true, service: data });
});

router.put('/services/:id', async (req, res) => {
  const patch = servicePatch(req.body);
  if (!patch) return res.status(422).json({ success: false, error: 'Invalid service values.' });
  const hasSchedule = req.body?.instructorId !== undefined || req.body?.availableWeekdays !== undefined;
  if (hasSchedule) {
    const days = normalizedDays(req.body?.availableWeekdays);
    const instructorId = String(req.body?.instructorId || '');
    if (!days || !/^[0-9a-f-]{36}$/i.test(instructorId)) {
      return res.status(422).json({ success: false, error: 'Select an instructor and at least one valid weekday.' });
    }
    const instructor = await validateInstructorDays(req.provider.id, instructorId, days);
    if (!instructor) return res.status(422).json({ success: false, error: 'Service days must be within the instructor’s available days.' });
    patch.instructor_id = instructor.id;
    patch.available_weekdays = days;
  }

  const { data, error } = await serviceRoleClient.from('services').update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('provider_id', req.provider.id).select('*').maybeSingle();
  if (error) return res.status(500).json({ success: false, error: 'Could not save service scheduling.' });
  if (!data) return res.status(404).json({ success: false, error: 'Service not found.' });
  return res.json({ success: true, service: data });
});

router.delete('/services/:id', async (req, res) => {
  const { data, error } = await serviceRoleClient.from('services').delete()
    .eq('id', req.params.id).eq('provider_id', req.provider.id).select('id').maybeSingle();
  if (error) return res.status(409).json({ success: false, error: 'This service has booking history and cannot be deleted. Deactivate it instead.' });
  if (!data) return res.status(404).json({ success: false, error: 'Service not found.' });
  return res.json({ success: true });
});

export default router;
