import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required.');
  const response = await fetch(`${getApiBase()}/v1/merchant/scheduling${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = result?.error;
    const error = new Error(
      typeof payload === 'string'
        ? payload
        : payload?.message || 'Scheduling request failed.',
    );
    error.code = payload?.code || null;
    error.details = payload?.details || null;
    throw error;
  }
  return result;
}

function mapService(row) {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    description: row.description || '',
    duration: Number(row.duration),
    price: Number(row.price),
    depositAmount: 0,
    isActive: Boolean(row.active),
    meetingType: row.meeting_type || 'online',
    instructorId: row.instructor_id,
    availableWeekdays: row.available_weekdays || [],
    locationAddress: row.location_address || null,
    mapsLink: row.maps_link || null,
    createdAt: row.created_at,
  };
}

export const merchantSchedulingService = {
  load: () => request('/'),
  createInstructor: name => request('/instructors', { method: 'POST', body: JSON.stringify({ name }) }),
  updateInstructor: (id, values) => request(`/instructors/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(values) }),
  saveAvailability: (id, schedule) => request(`/instructors/${encodeURIComponent(id)}/availability`, { method: 'PUT', body: JSON.stringify({ schedule }) }),
  saveServiceSchedule: (serviceId, instructorId, availableWeekdays) => request(`/services/${encodeURIComponent(serviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ instructorId, availableWeekdays }),
  }),
  createService: async values => mapService((await request('/services', { method: 'POST', body: JSON.stringify(values) })).service),
  updateService: async (serviceId, values) => mapService((await request(`/services/${encodeURIComponent(serviceId)}`, { method: 'PUT', body: JSON.stringify(values) })).service),
  deleteService: serviceId => request(`/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' }),
};
