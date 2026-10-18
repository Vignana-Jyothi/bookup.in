import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Search, X } from 'lucide-react';
import { useAuth, useStore } from '../data/store';
import { ACTIONS } from '../data/actions';
import { supabase } from '../services/supabase/supabaseClient';
import { endAdminVerification } from '../services/supabase/adminMfa.js';
import { loadAdminDashboard } from '../services/supabase/adminDashboard.js';
import BrandLogo from '../components/ui/BrandLogo';
import SupportWidget from '../components/support/SupportWidget.jsx';
import AdminRefundActions from '../components/support/AdminRefundActions.jsx';
import './AdminDashboard.css';

const sections = [['overview','Overview'],['merchants','Merchants'],['bookings','Bookings & payments'],['refunds','Refunds'],['support','Support'],['subscriptions','Subscriptions & codes'],['integrations','Integrations'],['audit','Audit & access']];
const descriptions = {
  overview: 'A clear view of the platform. Start with what needs your attention.', merchants: 'Identity, access and onboarding in one merchant workspace.',
  bookings: 'Payment truth and appointment ownership, viewed together.', refunds: 'Review the evidence. Requested and refunded remain distinct.',
  support: 'Customer escalations and merchant platform issues, with clear ownership.', subscriptions: 'Review paid access, future periods and access codes.',
  integrations: 'Configuration and recorded synchronization work.', audit: 'Recorded actions and administrator verification history.',
};
const money = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
const date = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const label = value => String(value || 'Not recorded').replaceAll('_', ' ');
function display(value) { return value === null || value === undefined ? 'Not recorded' : /^\d{4}-\d{2}-\d{2}T/.test(String(value)) ? date(value) : String(value); }
function statusClass(record) {
  if (record.overdue || /failed|pending|review|unknown|unfulfilled|requested|dead_letter/.test(record.status)) return 'amber';
  return /succeeded|active|confirmed|completed|fulfilled/.test(record.status) ? 'green' : 'neutral';
}

function RecordDetail({ record, onClose, openSupport,onRefundChanged }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  const fields = { Reference: record.reference, Merchant: record.merchant, Status: label(record.status), Amount: money(record.amountPaise), Recorded: date(record.createdAt), Snapshot: date(record.snapshotAt), ...record.detail };
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="admin-detail-title">
    <button type="button" className="close" aria-label="Close record details" onClick={onClose}><X size={18} /></button>
    <div className="eyebrow">SYSTEM RECORD</div><h2 id="admin-detail-title">{record.issue}</h2><p>Current persisted details. Times are shown in IST.</p>
    <dl>{Object.entries(fields).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{display(value)}</dd></div>)}</dl>
    {record.ticketId && <button className="primary" onClick={() => openSupport(record.ticketId)}>Open support conversation <ArrowUpRight size={16} /></button>}
    {record.section==='refunds' && (/^[0-9a-f-]{36}$/i.test(record.id) ? <AdminRefundActions requestId={record.id} onChanged={onRefundChanged} /> : <p className="decision-note">This is a gateway or recovery record. Open the corresponding merchant refund request to review approval.</p>)}
    {record.section === 'merchants' && record.detail?.['Booking page'] && <Link className="secondary" to={`/book/${encodeURIComponent(record.detail['Booking page'])}`}>Open booking page</Link>}
  </dialog>;
}

export default function AdminDashboard({ initialSection = 'overview' }) {
  const auth = useAuth();
  const { dispatch, addToast } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [widgetOpen, setWidgetOpen] = useState(false);
  const supportFromLink = params.get('section') === 'support';
  const supportOpen = widgetOpen || supportFromLink;
  const section = supportFromLink ? 'overview' : sections.some(([key]) => key === params.get('section')) ? params.get('section') : initialSection;
  const title = sections.find(([key]) => key === section)?.[1] || 'Overview';
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const lastError = useRef('');
  const queryKey = JSON.stringify([section,period,query,filter,offset]);
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let active = true;
    let controller;
    let pending = false;
    const load = async (quiet = false) => {
      if (pending || (quiet && document.hidden)) return;
      pending = true;
      controller = new AbortController();
      if (!quiet) setLoading(true);
      try {
        const data = await loadAdminDashboard({ section, period, search: query, filter, offset, signal: controller.signal });
        if (active) { setSnapshot({ key: queryKey, data }); setError(''); lastError.current = ''; }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') {
          setError(failure.message);
          if (lastError.current !== failure.message) { addToast(failure.message, 'error'); lastError.current = failure.message; }
          if (failure.status === 401 || failure.status === 403) navigate('/login', { replace: true });
        }
      } finally { pending = false; if (active) setLoading(false); }
    };
    load();
    const timer = setInterval(() => load(true), 20000);
    const focus = () => load(true);
    window.addEventListener('focus', focus);
    return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [section,period,query,filter,offset,reload,queryKey,navigate,addToast]);
  const data = snapshot?.key === queryKey ? snapshot.data : null;
  const metrics = data?.metrics;
  const go = (next, ticketId) => {
    setSelected(null); setSearch(''); setQuery(''); setFilter('all'); setOffset(0);
    setParams({ section: next, ...(ticketId ? { ticket: ticketId } : {}) });
  };
  const signOut = async () => {
    setBusy(true);
    await endAdminVerification(supabase).catch(() => {});
    const result = await supabase.auth.signOut({ scope: 'local' });
    if (result.error) { addToast('Could not sign out. Please retry.', 'error'); setBusy(false); return; }
    dispatch({ type: ACTIONS.LOGOUT }); navigate('/login', { replace: true });
  };
  const summaries = [
    ['Merchants with active access', metrics?.activeMerchants, 'Current access, including grace'],
    ['Verified bookings', metrics?.verifiedBookings, 'Cashfree-paid · created in selected period'],
    ['Calup subscription receipts', metrics ? money(metrics.subscriptionReceiptsPaise) : null, metrics ? `Production · sandbox ${money(metrics.sandboxSubscriptionReceiptsPaise)}` : 'Verified payments in selected period'],
    ['Refund requests to review', metrics?.refundRequests, metrics ? `${money(metrics.refundAmountPaise)} · current open requests` : 'Current open requests'],
  ];
  return <div className="calup-admin">
    <a className="skip" href="#admin-main">Skip to workspace</a>
    <div className="shell"><aside className="sidebar" aria-label="Admin navigation">
      <Link className="brand" to="/admin"><BrandLogo size="md" /></Link><div className="workspace-label">ADMIN WORKSPACE</div>
      <nav aria-label="Workspace sections">{sections.filter(([key]) => key !== 'support').map(([key,name]) => <button key={key} onClick={() => go(key)} aria-current={section === key ? 'page' : undefined}>{name}{key === 'refunds' && metrics && <span>{metrics.refundRequests}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="staff-avatar" aria-hidden="true">CA</span><div><strong>Calup administrator</strong><small>{auth.user?.email}</small></div></div>
    </aside><main id="admin-main">
      <header className="topbar"><div className="breadcrumb">Calup <span>/</span><strong>{title}</strong></div><div className="topbar-right"><span className="environment">{data ? `Cashfree ${data.environment}` : 'Checking environment'}</span><span className="staff-status">Password + SMS verified</span><button className="secondary" onClick={signOut} disabled={busy}>{busy ? 'Signing out...' : 'Sign out'}</button></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">OPERATIONS, WITH CLARITY</div><h1>{title}</h1><p>{descriptions[section]}</p></div><button className="primary" onClick={() => go('refunds')}>Review refund queue <ArrowUpRight size={16} /></button></div>
        <div className="toolbar"><label className="search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search administrator records" maxLength={120} placeholder="Search reference, merchant or issue" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} disabled={section === 'support'} /></label>
          <label className="date-control">Recorded date (IST)<select value={period} onChange={event => { setPeriod(event.target.value); setOffset(0); }}><option value="all">All records</option><option value="today">Created today</option><option value="week">Created in last 7 days</option><option value="month">Created in last 30 days</option></select></label>
          <button className="secondary" onClick={() => setReload(value => value+1)} disabled={loading}><RefreshCw size={15} />Refresh</button></div>
        <section className="metrics" aria-label="Platform summaries">{summaries.map(([name,value,context]) => <div className="metric" key={name}><div className="metric-label">{name}</div><div className="metric-value">{value ?? '—'}</div><div className="metric-context">{context}</div></div>)}</section>
        <div className="workspace-grid"><section className="queue" aria-busy={loading}>
          <div className="section-heading"><div><h2>{section === 'overview' ? 'Needs attention' : title}</h2><p>{section === 'overview' ? 'Current open work across all dates; summary metrics use the selected period.' : section === 'support' ? 'Conversations use their own filters and are not limited by the summary period.' : 'Persisted system records · recorded date in selected period.'}</p></div><span className="count">{section === 'support' ? 'Support inbox' : data ? `${data.total} records` : 'Loading'}</span></div>
          <>
            <div className="filters" aria-label="Queue filters">{[['all','All records'],['financial','Financial'],['overdue','Overdue']].map(([key,name]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setOffset(0); }}>{name}</button>)}</div>
            <div className="table-scroll"><table><thead><tr><th>Reference & issue</th><th>Merchant / actor</th><th>Status</th><th className="amount-heading">Amount</th><th><span className="visually-hidden">Action</span></th></tr></thead>
              <tbody>{data?.records.map(record => <tr key={`${record.section}:${record.id}`}><td><strong>{record.issue}</strong><small>{record.reference}</small></td><td>{record.merchant}</td><td><span className={`status ${statusClass(record)}`}>{label(record.status)}</span></td><td className="amount">{money(record.amountPaise)}</td><td><button className="row-action" aria-label={`View ${record.reference}`} onClick={() => setSelected({ ...record, snapshotAt: data.asOf })}>View</button></td></tr>)}</tbody></table></div>
            {!data && <p className="empty" role="status">{loading ? 'Loading system records...' : 'Records could not be loaded.'}</p>}
            {data?.records.length === 0 && <div className="empty"><p>No records match this selection{period !== 'all' ? '. The recorded-date filter hides older records' : ''}.</p>{(period !== 'all' || query || filter !== 'all' || offset > 0) && <button className="secondary" onClick={() => { setPeriod('all'); setSearch(''); setQuery(''); setFilter('all'); setOffset(0); }}>Show all records</button>}</div>}
            <div className="table-footer"><span role="status" aria-live="polite">{data ? `${offset+ (data.total ? 1 : 0)}–${offset+data.records.length} of ${data.total}` : 'Waiting for data'}</span><div className="admin-pagination"><button className="row-action" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0,value-50))}>Previous</button><button className="row-action" disabled={loading || !data || offset+50>=data.total} onClick={() => setOffset(value => value+50)}>Next</button></div></div>
          </>
        </section><aside className="health"><div className="section-heading"><div><h2>Integration readiness</h2><p>Server configuration · not provider uptime</p></div></div>
          <ul>{data?.integrations.map(item => <li key={item.name}><span className="integration-icon">{item.short}</span><div><strong>{item.name}</strong><small>{item.note}</small></div><span className={`status ${item.configured ? 'green' : 'amber'}`}>{item.configured ? 'Configured' : 'Setup needed'}</span></li>)}</ul>
          <div className="health-note"><strong>Observe before acting.</strong><p>Configuration does not prove delivery or provider health. Open Integrations to review recorded jobs.</p></div></aside></div>
        <section className="activity"><div><h2>Keep every decision traceable.</h2><p>Review recorded platform actions and administrator verification events.</p></div><button className="secondary" onClick={() => go('audit')}>Explore audit view <ArrowUpRight size={16} /></button></section>
        <footer className="page-footer"><span>Calup operations · {data ? `Last synchronized ${date(data.asOf)} IST` : 'No successful snapshot yet'}{error && data ? ' · Snapshot may be out of date' : ''}</span>{error && <button className="row-action" onClick={() => setReload(value => value+1)}>Retry loading data</button>}<span>Refreshes every 20 seconds while visible. Booking refund approvals are sandbox-only.</span></footer>
      </div></main></div>
    {selected && <RecordDetail record={selected} onClose={() => setSelected(null)} openSupport={id => go('support',id)} onRefundChanged={()=>{setSelected(null);setReload(value=>value+1);}} />}
    <SupportWidget scope="admin" open={supportOpen} onOpen={() => setWidgetOpen(true)} onClose={() => { setWidgetOpen(false); if (supportFromLink) setParams({ section: 'overview' }, { replace: true }); }} initialTicketId={supportFromLink ? params.get('ticket') : undefined} />
  </div>;
}
