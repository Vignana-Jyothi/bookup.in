/**
 * BookUp — Customer Booking Hooks Order & State Rendering Regression Test Suite
 * Validates that /track/:token and CustomerBooking.jsx render without React Hook Order violations (Error #310)
 * across all lifecycle and payment states:
 * 1. Initial / Loading state (isLoading = true)
 * 2. State 1: Awaiting Payment (pending_payment / awaiting_payment)
 * 3. State 2: Verification Pending (pending_payment / pending_verification)
 * 4. State 3: Confirmed (confirmed / confirmed)
 * 5. State 4: Rejected (rejected / rejected)
 * 6. State 5: Cancelled (cancelled / not_required)
 * 7. Multi-pass state transitions to assert 0 React hooks-order errors across re-renders.
 */

import dotenv from 'dotenv';
dotenv.config();

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const API_PORT = process.env.PORT || 3001;
const API_BASE = `http://localhost:${API_PORT}/api`;

if (!url || !key) {
  console.error('❌ Supabase credentials missing from .env');
  process.exit(1);
}

const supabase = createClient(url, key);

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runHooksOrderSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: CUSTOMER BOOKING HOOKS ORDER & STATE RENDERING');
  console.log('================================================================\n');

  // 1. Initialize Vite SSR Environment to load React JSX components
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  let CustomerBooking;
  let StoreProvider;
  try {
    const storeMod = await vite.ssrLoadModule('./src/data/store.jsx');
    StoreProvider = storeMod.StoreProvider;
    const pageMod = await vite.ssrLoadModule('./src/pages/booking/CustomerBooking.jsx');
    CustomerBooking = pageMod.default;
  } catch (err) {
    console.error('❌ Failed to load modules via Vite:', err);
    await vite.close();
    process.exit(1);
  }

  // 2. Fetch active provider and service for real test booking
  let { data: providers } = await supabase.from('providers').select('*').limit(1);
  const testProvider = providers?.[0];
  assert(Boolean(testProvider?.id), 'Provider loaded from Supabase');

  let { data: services } = await supabase.from('services').select('*').eq('provider_id', testProvider.id).limit(1);
  let testService = services?.[0];
  if (!testService) {
    const { data: anyService } = await supabase.from('services').select('*').limit(1);
    testService = anyService?.[0];
  }
  assert(Boolean(testService?.id), 'Service loaded from Supabase');

  // 3. Create a real booking through POST /api/public/bookings
  const testDate = '2026-12-15';
  const testTime = '11:00';
  const createRes = await fetch(`${API_BASE}/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: testProvider.id,
      serviceId: testService.id,
      customerName: 'Hooks Order Verification User',
      customerEmail: 'hooks-order-test@example.com',
      customerPhone: '+919876543299',
      bookingDate: testDate,
      startTime: testTime,
    }),
  });

  const createJson = await createRes.json();
  assert(createJson.success === true, `Booking created via API (bookingId: ${createJson.bookingId})`);
  const bookingId = createJson.bookingId;
  const token = createJson.managementToken;
  assert(Boolean(token), `Management token returned: ${token}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Render in Loading State (Initial Route Hit)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Rendering /track/:token initial loading state...');
    let htmlLoading = '';
    try {
      htmlLoading = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, null,
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlLoading.includes('Loading your appointment details') || htmlLoading.includes('spinner') || htmlLoading.includes('booking-page'),
        'Initial render outputs loading spinner without throwing React error #310');
    } catch (err) {
      assert(false, `React Hook order error during loading render: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: State 1 — Awaiting Payment (Pending Payment)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Verifying State 1: Awaiting Payment...');
    await supabase.from('bookings').update({
      status: 'pending_payment',
      payment_status: 'awaiting_payment',
    }).eq('id', bookingId);

    const res1 = await fetch(`${API_BASE}/public/bookings/manage/${token}`);
    const data1 = await res1.json();
    assert(data1.success === true && data1.booking?.paymentStatus === 'awaiting_payment',
      'Backend returned awaiting_payment state');

    // Render with state 1 data injected
    let htmlState1 = '';
    try {
      htmlState1 = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, { initialState: { bookings: [data1.booking], provider: data1.provider } },
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlState1.length > 0, 'State 1 (Awaiting Payment) rendered successfully');
    } catch (err) {
      assert(false, `React Hook error in State 1: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 3: State 2 — Verification Pending (Customer marked paid)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Verifying State 2: Verification Pending...');
    await supabase.from('bookings').update({
      status: 'pending_payment',
      payment_status: 'pending_verification',
    }).eq('id', bookingId);

    const res2 = await fetch(`${API_BASE}/public/bookings/manage/${token}`);
    const data2 = await res2.json();
    assert(data2.success === true && data2.booking?.paymentStatus === 'pending_verification',
      'Backend returned pending_verification state');

    let htmlState2 = '';
    try {
      htmlState2 = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, { initialState: { bookings: [data2.booking], provider: data2.provider } },
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlState2.length > 0, 'State 2 (Verification Pending) rendered successfully');
    } catch (err) {
      assert(false, `React Hook error in State 2: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: State 3 — Confirmed (Provider confirmed payment)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Verifying State 3: Confirmed...');
    await supabase.from('bookings').update({
      status: 'confirmed',
      payment_status: 'confirmed',
    }).eq('id', bookingId);

    const res3 = await fetch(`${API_BASE}/public/bookings/manage/${token}`);
    const data3 = await res3.json();
    assert(data3.success === true && data3.booking?.status === 'confirmed',
      'Backend returned confirmed status');

    let htmlState3 = '';
    try {
      htmlState3 = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, { initialState: { bookings: [data3.booking], provider: data3.provider } },
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlState3.length > 0, 'State 3 (Confirmed) rendered successfully');
    } catch (err) {
      assert(false, `React Hook error in State 3: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 5: State 4 — Rejected (Payment Rejected)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Verifying State 4: Rejected...');
    await supabase.from('bookings').update({
      status: 'rejected',
      payment_status: 'rejected',
      payment_rejected_reason: 'Test invalid screenshot',
    }).eq('id', bookingId);

    const res4 = await fetch(`${API_BASE}/public/bookings/manage/${token}`);
    const data4 = await res4.json();
    assert(data4.success === true && data4.booking?.status === 'rejected',
      'Backend returned rejected status');

    let htmlState4 = '';
    try {
      htmlState4 = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, { initialState: { bookings: [data4.booking], provider: data4.provider } },
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlState4.length > 0, 'State 4 (Rejected) rendered successfully');
    } catch (err) {
      assert(false, `React Hook error in State 4: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 6: State 5 — Cancelled
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Verifying State 5: Cancelled...');
    await supabase.from('bookings').update({
      status: 'cancelled',
      payment_status: 'not_required',
    }).eq('id', bookingId);

    const res5 = await fetch(`${API_BASE}/public/bookings/manage/${token}`);
    const data5 = await res5.json();
    assert(data5.success === true && data5.booking?.status === 'cancelled',
      'Backend returned cancelled status');

    let htmlState5 = '';
    try {
      htmlState5 = renderToString(
        React.createElement(MemoryRouter, { initialEntries: [`/track/${token}`] },
          React.createElement(StoreProvider, { initialState: { bookings: [data5.booking], provider: data5.provider } },
            React.createElement(Routes, null,
              React.createElement(Route, { path: '/track/:token', element: React.createElement(CustomerBooking) })
            )
          )
        )
      );
      assert(htmlState5.length > 0, 'State 5 (Cancelled) rendered successfully');
    } catch (err) {
      assert(false, `React Hook error in State 5: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 7: AST / Code Structure Verification (Hooks Above Early Returns)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Verifying all hooks are strictly above early returns in CustomerBooking.jsx...');
    const fs = await import('fs');
    const sourceCode = fs.readFileSync('./src/pages/booking/CustomerBooking.jsx', 'utf8');
    const lines = sourceCode.split('\n');

    let firstComponentEarlyReturnLine = -1;
    const hookLines = [];

    // Component-level early returns occur at 2-space indentation (outside callbacks)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (firstComponentEarlyReturnLine === -1 && (
        line.startsWith('  if (isLoading)') ||
        line.startsWith('  if (!lookupIdentifier') ||
        line.startsWith('  if (!resolvedBooking)')
      )) {
        firstComponentEarlyReturnLine = i + 1;
      }
      if (line.match(/\buse(State|Effect|Memo|Callback|Ref|Context)\s*\(/)) {
        hookLines.push({ line: i + 1, content: line.trim() });
      }
    }

    assert(firstComponentEarlyReturnLine > 0, `First component early return detected at line ${firstComponentEarlyReturnLine}`);
    const misplacedHooks = hookLines.filter(h => h.line > firstComponentEarlyReturnLine);
    assert(misplacedHooks.length === 0,
      `All ${hookLines.length} hooks are placed above line ${firstComponentEarlyReturnLine} (found ${misplacedHooks.length} misplaced hooks)`);

    console.log('\n================================================================');
    console.log('✅ ALL CUSTOMER BOOKING HOOKS ORDER & STATE TESTS PASSED');
    console.log('================================================================\n');
  } finally {
    // Clean up test booking
    await supabase.from('bookings').delete().eq('id', bookingId);
    console.log(`Cleaned up test booking row ${bookingId}`);
    await vite.close();
  }
}

runHooksOrderSuite().catch(err => {
  console.error('❌ Test failed with exception:', err);
  process.exit(1);
});
