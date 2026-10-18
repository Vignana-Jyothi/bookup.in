const sections = ['Overview', 'Merchants', 'Bookings & payments', 'Refunds', 'Support', 'Subscriptions & codes', 'Integrations', 'Audit & access'];
const cases = [
  { reference: 'RF-PREVIEW-01', issue: 'Merchant refund request', merchant: 'River Studio · example', status: 'Requested', amount: 75000, type: 'financial', date: 'today', booking: 'M123456789', detail: 'Merchant requested review after a service cancellation.' },
  { reference: 'PAY-PREVIEW-02', issue: 'Paid without an appointment', merchant: 'Peak Learning · example', status: 'Review required', amount: 120000, type: 'financial', date: 'today', booking: 'No appointment assigned', detail: 'Verify payment truth and the expired allocation; preserve the current slot owner.' },
  { reference: 'T-PREVIEW-03', issue: 'Unanswered customer complaint', merchant: 'North Consultancy · example', status: 'Overdue · 48h', amount: null, type: 'overdue', date: 'week', booking: 'M987654321', detail: 'Customer complaint moved to Calup after the merchant response deadline.' },
];
const views = {
  Merchants: [{ reference: 'MERCHANT-PREVIEW-01', issue: 'Google and payment setup', merchant: 'River Studio · example', status: 'Active', amount: null }, { reference: 'MERCHANT-PREVIEW-02', issue: 'Subscription grace period', merchant: 'North Consultancy · example', status: 'Grace', amount: null }],
  'Bookings & payments': cases.filter(item => item.type === 'financial'),
  Refunds: cases.filter(item => item.reference.startsWith('RF')),
  Support: cases,
  'Subscriptions & codes': [{ reference: 'SUB-PREVIEW-01', issue: '30-day plan payment', merchant: 'River Studio · example', status: 'Verified', amount: 29900 }, { reference: 'CODE-PREVIEW-02', issue: 'Compensation access code', merchant: 'Peak Learning · example', status: 'Review required', amount: null }],
  Integrations: [{ reference: 'WORKER-PREVIEW-01', issue: 'Checkout initialization', merchant: 'Cashfree sandbox', status: 'Review required', amount: null }, { reference: 'WORKER-PREVIEW-02', issue: 'WhatsApp sender and template', merchant: 'Calup sender', status: 'Setup needed', amount: null }],
  'Audit & access': [{ reference: 'AUDIT-PREVIEW-01', issue: 'Refund request recorded', merchant: 'Named merchant actor', status: 'Recorded', amount: null }, { reference: 'ACCESS-PREVIEW-02', issue: 'Staff role and MFA', merchant: 'Calup staff identity', status: 'Required', amount: null }],
};
const money = amount => amount === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount / 100);
const byId = id => document.getElementById(id);
let activeSection = 'Overview';
let activeFilter = 'all';
let visibleRecords = [];
const descriptions = {
  Overview: 'A clear view of the platform. Start with what needs your attention.',
  Merchants: 'Identity, access, onboarding and integrations in one merchant workspace.',
  Refunds: 'Review the evidence. Keep requested, approved and refunded states distinct.',
  Support: 'Customer escalations and merchant platform issues, with clear ownership.',
  'Bookings & payments': 'Payment truth and appointment ownership, viewed together.',
  'Subscriptions & codes': 'Review paid access and compensation without inventing revenue.',
  Integrations: 'See configuration, delayed jobs and recovery work without exposing secrets.',
  'Audit & access': 'Named actors, reasoned decisions and traceable access.',
};
function setSection(section) {
  activeSection = section;
  activeFilter = 'all';
  byId('search').value = '';
  byId('page-title').textContent = section;
  byId('breadcrumb').textContent = section;
  byId('page-description').textContent = descriptions[section];
  byId('queue-title').textContent = section === 'Overview' ? 'Needs attention' : section;
  byId('queue-description').textContent = section === 'Overview' ? 'Financial exceptions and approaching response deadlines.' : 'Illustrative records for this workspace.';
  document.querySelectorAll('#navigation button').forEach(button => button.setAttribute('aria-current', button.dataset.section === section ? 'page' : 'false'));
  document.querySelectorAll('#filters button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
  render();
}
function render() {
  const search = byId('search').value.trim().toLowerCase();
  const period = byId('period').value;
  visibleRecords = (activeSection === 'Overview' ? cases : views[activeSection] || []).filter(item =>
    (activeFilter === 'all' || item.type === activeFilter) && (period !== 'today' || item.date !== 'week') &&
    [item.reference, item.issue, item.merchant, item.status].join(' ').toLowerCase().includes(search));
  const body = byId('records');
  body.replaceChildren();
  visibleRecords.forEach(item => {
    const row = document.createElement('tr');
    const reference = document.createElement('td');
    const strong = document.createElement('strong'); strong.textContent = item.issue;
    const small = document.createElement('small'); small.textContent = item.reference;
    reference.append(strong, small);
    const merchant = document.createElement('td'); merchant.textContent = item.merchant;
    const status = document.createElement('td');
    const badge = document.createElement('span'); badge.className = `status ${['Active', 'Verified'].includes(item.status) ? 'green' : 'amber'}`; badge.textContent = item.status; status.append(badge);
    const amount = document.createElement('td'); amount.className = 'amount'; amount.textContent = money(item.amount);
    const action = document.createElement('td');
    const button = document.createElement('button'); button.className = 'row-action'; button.textContent = 'View'; button.setAttribute('aria-label', `View ${item.reference}`); button.addEventListener('click', () => openDetail(item)); action.append(button);
    row.append(reference, merchant, status, amount, action); body.append(row);
  });
  byId('queue-count').textContent = `${visibleRecords.length} records`;
  byId('results').textContent = `${visibleRecords.length} illustrative records shown`;
  byId('empty').hidden = visibleRecords.length > 0;
  const periodCases = cases.filter(item => period !== 'today' || item.date !== 'week');
  const financial = periodCases.filter(item => item.type === 'financial');
  const samplePeriods = { today: { bookings: '4', receipts: 29900 }, week: { bookings: '5', receipts: 59800 }, all: { bookings: '6', receipts: 89700 } };
  const summaries = [['Merchants with active access', '2', 'Sample account count'], ['Verified bookings', samplePeriods[period].bookings, 'Illustrative selected-period total'], ['Calup subscription receipts', money(samplePeriods[period].receipts), 'Separate from merchant collections'], ['Refund requests to review', String(periodCases.filter(item => item.reference.startsWith('RF')).length), `${money(financial.filter(item => item.reference.startsWith('RF')).reduce((sum, item) => sum + item.amount, 0))} awaiting review`]];
  byId('metrics').replaceChildren(...summaries.map(([label, value, context]) => {
    const card = document.createElement('div'); card.className = 'metric';
    for (const [className, text] of [['metric-label', label], ['metric-value', value], ['metric-context', context]]) { const node = document.createElement('div'); node.className = className; node.textContent = text; card.append(node); }
    return card;
  }));
}
function openDetail(item) {
  byId('detail-title').textContent = item.issue;
  byId('detail-subtitle').textContent = item.detail || 'Sample detail view. Actions will depend on staff permissions and authoritative server records.';
  const fields = [['Reference', item.reference], ['Merchant', item.merchant], ['Booking', item.booking || 'Not applicable'], ['Status', item.status], ['Amount', money(item.amount)], ['Environment', 'Sandbox preview']];
  byId('detail-fields').replaceChildren(...fields.map(([label, value]) => { const row = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; row.append(dt, dd); return row; }));
  const financial = item.type === 'financial';
  const trail = financial ? [['Request recorded', 'Payment reference and reason retained.'], ['Calup review pending', 'Verify payment, original policy, balance and evidence.'], ['Gateway reconciliation', 'Only a verified Cashfree result establishes a completed refund.']]
    : [['Record selected', 'Verify the related account and available history.'], ['Review ownership and access', 'Check staff capability and the applicable policy.'], ['Record an audited action', 'A reason and verified authorization are required.']];
  byId('case-dialog').querySelector('.timeline').replaceChildren(...trail.map(([title, description]) => { const li = document.createElement('li'); const strong = document.createElement('strong'); strong.textContent = title; const span = document.createElement('span'); span.textContent = description; li.append(strong, span); return li; }));
  byId('case-dialog').querySelector('.dialog-actions').hidden = !item.reference.startsWith('RF');
  byId('case-dialog').showModal();
}
for (const section of sections) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.section = section; button.textContent = section;
  if (section === 'Refunds') { const count = document.createElement('span'); count.textContent = '1'; button.append(count); }
  button.addEventListener('click', () => setSection(section)); byId('navigation').append(button);
}
byId('search').addEventListener('input', render);
byId('period').addEventListener('change', render);
document.querySelectorAll('#filters button').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('#filters button').forEach(peer => peer.setAttribute('aria-pressed', String(peer === button))); render(); }));
byId('review-refunds').addEventListener('click', () => setSection('Refunds'));
byId('view-audit').addEventListener('click', () => setSection('Audit & access'));
setSection('Overview');
