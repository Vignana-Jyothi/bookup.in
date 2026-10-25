import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boundedFetch } from '../../frontend/src/utils/boundedFetch.js';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^import .*;\r?\n/gm, '');
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout is unref'ed in Node.
try {
  let calls = 0;
  let aborts = 0;
  const hanging = (_input, { signal }) => new Promise((_, reject) => {
    ++calls;
    signal.addEventListener('abort', () => { ++aborts; reject(signal.reason); }, { once: true });
  });
  const limited = (input, options) => boundedFetch(input, options, { timeoutMs: 10, fetchImpl: hanging });
  await assert.rejects(limited('/headers'), error => error.name === 'TimeoutError');
  assert.equal(calls, 1, 'No automatic retry');
  assert.equal(aborts, 1);

  let bodyCancelled = false;
  const hangingBody = (_input, { signal }) => Promise.resolve(new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => { bodyCancelled = true; controller.error(signal.reason); }); },
  }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(boundedFetch('/body', {}, { timeoutMs: 10, fetchImpl: hangingBody }), error => error.name === 'TimeoutError');
  assert.equal(bodyCancelled, true, 'Deadline also aborts a body that stalls after headers');

  const controller = new AbortController();
  const cancelled = boundedFetch('/cancel', { signal: controller.signal }, { timeoutMs: 1000, fetchImpl: hanging });
  const reason = new Error('Caller unmounted');
  controller.abort(reason);
  await assert.rejects(cancelled, error => error === reason);
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort(reason);
  const before = calls;
  await assert.rejects(boundedFetch('/never-start', { signal: alreadyCancelled.signal }, { fetchImpl: hanging }), error => error === reason);
  assert.equal(calls, before);
  const requestController = new AbortController();
  const request = new Request('https://fixture.invalid/api', { signal: requestController.signal });
  const requestCancelled = boundedFetch(request, {}, { fetchImpl: hanging });
  requestController.abort(reason);
  await assert.rejects(requestCancelled, error => error === reason);

  const success = await boundedFetch('/json', {}, { fetchImpl: async () => new Response('{"ok":true}', { status: 201, headers: { 'X-Fixture': 'retained' } }) });
  assert.equal(success.status, 201);
  assert.equal(success.headers.get('X-Fixture'), 'retained');
  assert.deepEqual(await success.json(), { ok: true });

  // Load the actual client initializer with a createClient spy, avoiding SDK network/storage.
  const clientSource = stripImports(await read('frontend/src/services/supabase/supabaseClient.js'))
    .replaceAll("typeof import.meta !== 'undefined'", 'false').replaceAll('import.meta.env?', 'undefined?').replaceAll('export ', '');
  const configuredEnv = { env: { VITE_SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture' } };
  const client = new Function('createClient', 'boundedFetch', 'process', `${clientSource}\nreturn supabase;`)((_url, _key, options) => options, limited, configuredEnv);
  await assert.rejects(client.global.fetch('/supabase-auth'), error => error.name === 'TimeoutError');

  const dbSource = stripImports(await read('frontend/src/services/supabase/dbService.js')).replaceAll('export ', '');
  const db = new Function('supabase', 'isSupabaseConfigured', 'getApiBase', 'boundedFetch', `${dbSource}\nreturn dbService;`)(
    { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } }, () => true, () => '/api', limited,
  );
  await assert.rejects(db.getBookings('fixture-provider'), error => error.name === 'TimeoutError');
  assert.equal(calls, before + 3, 'Auth/client/booking callers do not retry failed requests');

  const sessionClient = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } };
  const adapterCases = [
    ['supabase/adminMfa.js', 'verifyAdminAccess', factory => factory(sessionClient)],
    ['supabase/adminDashboard.js', 'loadAdminDashboard', factory => factory({ section: 'overview', period: 'month', search: '', filter: '', offset: 0 }, { client: sessionClient })],
    ['payments/cashfreeCheckout.js', 'cashfreeCheckoutService', service => service.getAttempt()],
    ['payments/publicCommerceService.js', 'publicCommerceService', factory => factory('fixture').catalog()],
    ['payments/subscriptionService.js', 'subscriptionService', service => service.get()],
    ['payments/bookingRefundService.js', 'bookingRefundService', service => service.get('fixture')],
    ['payments/merchantCommerceService.js', 'merchantCommerceService', service => service.load()],
    ['booking/merchantSchedulingService.js', 'merchantSchedulingService', service => service.load()],
    ['support/ticketService.js', 'createTicketService', factory => factory().list(0)],
  ];
  for (const [path, exported, invoke] of adapterCases) {
    const source = stripImports(await read(`frontend/src/services/${path}`)).replaceAll('export ', '').replaceAll('import.meta.env', '({})');
    const adapter = new Function('supabase', 'boundedFetch', 'getApiBase', 'getAdminApiBase', 'getPublicSessionApiBase', `${source}\nreturn ${exported};`)(
      sessionClient, limited, () => '/api', () => '/api', () => '/api',
    );
    const callsBefore = calls;
    await assert.rejects(invoke(adapter), error => error.name === 'TimeoutError', `${path} must use bounded transport`);
    assert.equal(calls, callsBefore + 1, `${path} must not automatically retry`);
  }

  let policyRow;
  const policyDb = new Function('supabase', 'isSupabaseConfigured', 'getApiBase', 'boundedFetch', `${dbSource}\nreturn dbService;`)(
    { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: policyRow }) }) }) }) },
    () => true, () => '/api', limited,
  );
  for (const [fee, expected] of [[undefined, 200], [null, 200], ['bad', 200], [Infinity, 200], [0, 0], ['0', 0], ['250', 250]]) {
    policyRow = { provider_id: 'fixture', fee };
    assert.equal((await policyDb.getPolicy('fixture')).depositAmount, expected, `Deposit projection for ${String(fee)}`);
  }

  const auth = await read('frontend/src/pages/Auth.jsx');
  const loginBody = auth.split('const handleSubmit = async (event) => {')[1].split('\n  };')[0];
  const loading = [];
  const errors = [];
  const navigation = [];
  const login = new Function('form', 'setErrorMsg', 'isSupabaseConfigured', 'setLoading', 'supabase', 'isCalupAdmin', 'dbService', 'dispatch', 'ACTIONS', 'addToast', 'onboardingService', 'navigate', `return async event => {${loginBody}}`)(
    { emailOrPhone: 'fixture@example.test', password: 'fixture' }, message => errors.push(message), () => true,
    value => loading.push(value), { auth: { signInWithPassword: async () => ({ data: { user: { id: 'fixture', email: 'fixture@example.test' } } }) } },
    () => false, { getProviderByUserId: async () => ({ id: 'fixture-provider', name: 'Fixture' }) }, () => {}, { LOGIN: 'login', UPDATE_PROVIDER: 'provider' }, () => {},
    { load: async () => { throw new Error('Fixture setup outage'); } }, destination => navigation.push(destination),
  );
  await login({ preventDefault() {} });
  assert.equal(loading.at(-1), false);
  assert.equal(errors.at(-1), 'Fixture setup outage');
  assert.deepEqual(navigation, [], 'Setup outage must stay on login with retry guidance');
  console.log('PASS: bounded fetch headers/body, cancellation, Supabase/DB wiring and login outage');
} finally { clearInterval(keepAlive); }

