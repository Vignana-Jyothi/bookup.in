import crypto from 'node:crypto';

// Only server-created, unexpired SMS sessions can establish booking contact identity.
export async function verifiedBookingContact(req, database, providerId, phone, now = Date.now()) {
  const pair = String(req.headers?.cookie || '').split(';')
    .find(value => value.trim().startsWith('calup_commerce_access='));
  let token;
  try { token = decodeURIComponent(pair?.trim().slice('calup_commerce_access='.length) || ''); } catch { return null; }
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await database.from('commerce_customer_sessions').select('contact_id,expires_at')
    .eq('token_hash', hash).gt('expires_at', new Date(now).toISOString()).maybeSingle();
  if (session.error) throw new Error('PHONE_VERIFICATION_STORAGE');
  if (!session.data || !(Date.parse(session.data.expires_at) > now)) return null;
  const contact = await database.from('commerce_contacts').select('id,provider_id,phone')
    .eq('id', session.data.contact_id).eq('provider_id', providerId).eq('phone', phone).maybeSingle();
  if (contact.error) throw new Error('PHONE_VERIFICATION_STORAGE');
  return contact.data?.provider_id === providerId && contact.data.phone === phone ? contact.data.id : null;
}
