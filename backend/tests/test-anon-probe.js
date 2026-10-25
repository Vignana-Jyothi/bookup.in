/**
 * BookUp — Anonymous Key Permission Lockdown Probe Script
 * 
 * Verifies that an unauthenticated client using ONLY the public/anon key cannot:
 *  1. SELECT real booking rows
 *  2. SELECT real customer rows
 *  3. SELECT from refunds table
 *  4. SELECT from coach_risk_metrics view
 *  5. SELECT from audit_logs table
 *  6. SELECT from google_tokens table
 *  7. UPDATE a real booking row
 *  8. UPDATE a real customer row
 *  9. DELETE a real booking row
 * 10. DELETE a real customer row
 * 
 * Flow:
 *  - Uses service_role client to seed one throwaway customer and booking.
 *  - Executes queries using ONLY anon/publishable key against those real rows.
 *  - Verifies state with service_role client and deletes throwaway rows.
 * 
 * Expected results:
 *  - BEFORE lockdown: Reports LEAKS on SELECT bookings, SELECT customers,
 *    UPDATE bookings (due to "OR true"), UPDATE customers (due to USING true),
 *    and SELECT coach_risk_metrics.
 *  - AFTER lockdown: All probes must report BLOCKED / Permission Denied.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error('Missing required Supabase environment variables in .env');
  console.error('Requires: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// 1. Admin service-role client for seeding and verifying
const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 2. Strict unauthenticated client with publishable/anon key ONLY
const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runProbe() {
  console.log('================================================================');
  console.log('ANONYMOUS KEY SECURITY PROBE (REAL ROW MUTATION & SELECT)');
  console.log('================================================================\n');

  let passedAll = true;
  let throwawayCustomerId = null;
  let throwawayBookingId = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Seed throwaway records via service_role client
    // -------------------------------------------------------------------------
    console.log('1. Setting up throwaway test fixture via service_role client...');
    
    // Find a valid provider & service
    const { data: providers, error: provErr } = await serviceClient
      .from('providers')
      .select('id')
      .limit(1);
    if (provErr || !providers?.length) throw new Error('No provider found in database to seed booking');
    const providerId = providers[0].id;

    const { data: services, error: svcErr } = await serviceClient
      .from('services')
      .select('id')
      .eq('provider_id', providerId)
      .limit(1);
    if (svcErr || !services?.length) throw new Error('No service found for provider to seed booking');
    const serviceId = services[0].id;

    // Insert throwaway customer
    const ts = Date.now();
    const { data: customer, error: custErr } = await serviceClient
      .from('customers')
      .insert({
        name: 'Probe Target Customer',
        email: `probe_target_${ts}@test.com`,
        phone: `+9198765${String(ts).slice(-5)}`,
      })
      .select()
      .single();
    if (custErr || !customer) throw new Error(`Failed to seed customer: ${custErr?.message}`);
    throwawayCustomerId = customer.id;

    // Insert throwaway booking
    const { data: booking, error: bookErr } = await serviceClient
      .from('bookings')
      .insert({
        provider_id: providerId,
        service_id: serviceId,
        customer_id: throwawayCustomerId,
        customer_name: 'Probe Target Customer',
        customer_email: customer.email,
        customer_phone: customer.phone,
        booking_date: '2029-01-01',
        start_time: '11:00',
        end_time: '12:00',
        duration: 60,
        price: 1000,
        status: 'confirmed',
        payment_status: 'awaiting_payment',
        notes: 'original_clean_notes',
      })
      .select()
      .single();
    if (bookErr || !booking) throw new Error(`Failed to seed booking: ${bookErr?.message}`);
    throwawayBookingId = booking.id;

    console.log(`   Seeded throwaway customer: ${throwawayCustomerId}`);
    console.log(`   Seeded throwaway booking:  ${throwawayBookingId}\n`);

    // -------------------------------------------------------------------------
    // STEP 2: Anonymous Client SELECT Checks
    // -------------------------------------------------------------------------
    console.log('--- 2. PROBING ANONYMOUS SELECT ACCESS ---');

    // A. SELECT real booking
    const { data: bkgSelect, error: bkgSelErr } = await anonClient
      .from('bookings')
      .select('id, customer_name, customer_email, notes')
      .eq('id', throwawayBookingId);

    if (bkgSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT bookings: Error ${bkgSelErr.code || bkgSelErr.message} (${bkgSelErr.message})`);
    } else if (!bkgSelect || bkgSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT bookings: Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT bookings: EXPOSED real booking row to anon key!`, bkgSelect[0]);
      passedAll = false;
    }

    // B. SELECT real customer
    const { data: custSelect, error: custSelErr } = await anonClient
      .from('customers')
      .select('id, name, email, phone')
      .eq('id', throwawayCustomerId);

    if (custSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT customers: Error ${custSelErr.code || custSelErr.message} (${custSelErr.message})`);
    } else if (!custSelect || custSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT customers: Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT customers: EXPOSED real customer row to anon key!`, custSelect[0]);
      passedAll = false;
    }

    // C. SELECT refunds
    const { data: refSelect, error: refSelErr } = await anonClient
      .from('refunds')
      .select('*')
      .limit(5);

    if (refSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT refunds: Error ${refSelErr.code || refSelErr.message} (${refSelErr.message})`);
    } else if (!refSelect || refSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT refunds: Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT refunds: EXPOSED ${refSelect.length} rows to anon key!`);
      passedAll = false;
    }

    // D. SELECT coach_risk_metrics view
    const { data: viewSelect, error: viewSelErr } = await anonClient
      .from('coach_risk_metrics')
      .select('*')
      .limit(5);

    if (viewSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT coach_risk_metrics (view): Error ${viewSelErr.code || viewSelErr.message} (${viewSelErr.message})`);
    } else if (!viewSelect || viewSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT coach_risk_metrics (view): Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT coach_risk_metrics (view): EXPOSED ${viewSelect.length} rows to anon key!`);
      passedAll = false;
    }

    // E. SELECT audit_logs
    const { data: auditSelect, error: auditSelErr } = await anonClient
      .from('audit_logs')
      .select('*')
      .limit(5);

    if (auditSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT audit_logs: Error ${auditSelErr.code || auditSelErr.message} (${auditSelErr.message})`);
    } else if (!auditSelect || auditSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT audit_logs: Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT audit_logs: EXPOSED ${auditSelect.length} rows to anon key!`);
      passedAll = false;
    }

    // F. SELECT google_tokens
    const { data: tokenSelect, error: tokenSelErr } = await anonClient
      .from('google_tokens')
      .select('*')
      .limit(5);

    if (tokenSelErr) {
      console.log(`  ✓ [BLOCKED] SELECT google_tokens: Error ${tokenSelErr.code || tokenSelErr.message} (${tokenSelErr.message})`);
    } else if (!tokenSelect || tokenSelect.length === 0) {
      console.log(`  ✓ [BLOCKED] SELECT google_tokens: Returned 0 rows (RLS isolated)`);
    } else {
      console.error(`  ❌ [LEAK]    SELECT google_tokens: EXPOSED ${tokenSelect.length} rows to anon key!`);
      passedAll = false;
    }

    // -------------------------------------------------------------------------
    // STEP 3: Anonymous Client Mutation Checks on Real Row
    // -------------------------------------------------------------------------
    console.log('\n--- 3. PROBING ANONYMOUS MUTATIONS ON REAL ROWS ---');

    // A. UPDATE real booking
    const { data: bkgUpd, error: bkgUpdErr } = await anonClient
      .from('bookings')
      .update({ notes: 'MALICIOUS_OVERWRITE_BY_ANON' })
      .eq('id', throwawayBookingId)
      .select();

    if (bkgUpdErr) {
      console.log(`  ✓ [BLOCKED] UPDATE bookings: Error ${bkgUpdErr.code || bkgUpdErr.message} (${bkgUpdErr.message})`);
    } else if (!bkgUpd || bkgUpd.length === 0) {
      console.log(`  ✓ [BLOCKED] UPDATE bookings: 0 rows modified (RLS rejected write)`);
    } else {
      console.error(`  ❌ [LEAK]    UPDATE bookings: Anon successfully mutated real booking row!`, bkgUpd[0]);
      passedAll = false;
    }

    // B. UPDATE real customer
    const { data: custUpd, error: custUpdErr } = await anonClient
      .from('customers')
      .update({ name: 'MALICIOUS_NAME_OVERWRITE' })
      .eq('id', throwawayCustomerId)
      .select();

    if (custUpdErr) {
      console.log(`  ✓ [BLOCKED] UPDATE customers: Error ${custUpdErr.code || custUpdErr.message} (${custUpdErr.message})`);
    } else if (!custUpd || custUpd.length === 0) {
      console.log(`  ✓ [BLOCKED] UPDATE customers: 0 rows modified (RLS rejected write)`);
    } else {
      console.error(`  ❌ [LEAK]    UPDATE customers: Anon successfully mutated real customer row!`, custUpd[0]);
      passedAll = false;
    }

    // C. DELETE real booking
    const { data: bkgDel, error: bkgDelErr } = await anonClient
      .from('bookings')
      .delete()
      .eq('id', throwawayBookingId)
      .select();

    if (bkgDelErr) {
      console.log(`  ✓ [BLOCKED] DELETE bookings: Error ${bkgDelErr.code || bkgDelErr.message} (${bkgDelErr.message})`);
    } else if (!bkgDel || bkgDel.length === 0) {
      console.log(`  ✓ [BLOCKED] DELETE bookings: 0 rows deleted (RLS rejected delete)`);
    } else {
      console.error(`  ❌ [LEAK]    DELETE bookings: Anon successfully deleted real booking row!`);
      passedAll = false;
    }

    // D. DELETE real customer
    const { data: custDel, error: custDelErr } = await anonClient
      .from('customers')
      .delete()
      .eq('id', throwawayCustomerId)
      .select();

    if (custDelErr) {
      console.log(`  ✓ [BLOCKED] DELETE customers: Error ${custDelErr.code || custDelErr.message} (${custDelErr.message})`);
    } else if (!custDel || custDel.length === 0) {
      console.log(`  ✓ [BLOCKED] DELETE customers: 0 rows deleted (RLS rejected delete)`);
    } else {
      console.error(`  ❌ [LEAK]    DELETE customers: Anon successfully deleted real customer row!`);
      passedAll = false;
    }

    // -------------------------------------------------------------------------
    // STEP 4: Verify Database State via service_role client
    // -------------------------------------------------------------------------
    console.log('\n--- 4. VERIFYING ACTUAL ROW INTEGRITY VIA SERVICE ROLE ---');
    const { data: verifyBkg } = await serviceClient
      .from('bookings')
      .select('notes')
      .eq('id', throwawayBookingId)
      .single();

    const { data: verifyCust } = await serviceClient
      .from('customers')
      .select('name')
      .eq('id', throwawayCustomerId)
      .single();

    if (verifyBkg?.notes === 'original_clean_notes') {
      console.log('  ✓ Booking row preserved original values in database');
    } else {
      console.error(`  ❌ Booking row was corrupted by anon update: notes="${verifyBkg?.notes}"`);
      passedAll = false;
    }

    if (verifyCust?.name === 'Probe Target Customer') {
      console.log('  ✓ Customer row preserved original values in database');
    } else {
      console.error(`  ❌ Customer row was corrupted by anon update: name="${verifyCust?.name}"`);
      passedAll = false;
    }

  } finally {
    // -------------------------------------------------------------------------
    // STEP 5: Guaranteed Cleanup of throwaway records
    // -------------------------------------------------------------------------
    console.log('\n--- 5. CLEANING UP THROWAWAY FIXTURE ROWS ---');
    if (throwawayBookingId) {
      await serviceClient.from('bookings').delete().eq('id', throwawayBookingId);
      console.log(`  Cleaned up throwaway booking: ${throwawayBookingId}`);
    }
    if (throwawayCustomerId) {
      await serviceClient.from('customers').delete().eq('id', throwawayCustomerId);
      console.log(`  Cleaned up throwaway customer: ${throwawayCustomerId}`);
    }
  }

  console.log('\n================================================================');
  if (passedAll) {
    console.log('✅ ALL ANONYMOUS PROBES BLOCKED OR STRICTLY ISOLATED!');
  } else {
    console.log('⚠️ ANONYMOUS KEY HAS OPEN ACCESS (LOCKDOWN SQL NOT YET APPLIED)');
  }
  console.log('================================================================');
}

runProbe().catch(err => {
  console.error('Probe runner encountered unexpected error:', err);
  process.exit(1);
});
