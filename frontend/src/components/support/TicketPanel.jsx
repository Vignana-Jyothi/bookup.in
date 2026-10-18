import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store';
import { createTicketService } from '../../services/support/ticketService';
import TicketDetailDialog from './TicketDetailDialog.jsx';
import './TicketPanel.css';

const labels = { service: 'Service or appointment', meeting: 'Meeting access', payment: 'Payment', refund: 'Refund', duplicate_charge: 'Duplicate charge', unauthorized_payment: 'Unauthorized payment', bug: 'Bug report', account: 'Account', integration: 'Integration', other: 'Other' };
const date = value => value ? new Date(value).toLocaleString('en-IN') : '—';

export default function TicketPanel({ scope = 'customer', context = 'booking', initialTicketId }) {
  const { addToast } = useStore();
  const api = useMemo(() => createTicketService(scope, context), [scope, context]);
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [category, setCategory] = useState(scope === 'merchant' ? 'bug' : 'service');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState('all');
  const [hasMore, setHasMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pendingRequest = useRef(null);
  const submitting = useRef(false);
  const selectedId = useRef(/^[0-9a-f-]{36}$/i.test(initialTicketId || '') ? initialTicketId : null);
  const options = scope === 'customer' ? ['service', 'meeting', 'payment', 'refund', 'duplicate_charge', 'unauthorized_payment', 'other'] : ['bug', 'integration', 'account', 'payment', 'refund', 'other'];

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await api.list(0);
      setTickets(result.tickets);
      setHasMore(result.tickets.length === 50);
      setAvailable(true);
      if (selectedId.current) {
        const ticket = await api.get(selectedId.current);
        if (selectedId.current === ticket.id) setSelected(ticket);
      }
    } catch (error) {
      if (!quiet) { setAvailable(false); addToast(error.message, 'error'); }
    } finally { setLoading(false); }
  }, [api, addToast]);

  useEffect(() => {
    const initial = setTimeout(() => load(), 0);
    const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden && !submitting.current) load(true); }, 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);

  async function openTicket(id) {
    selectedId.current = id;
    setReply('');
    setShowForm(false);
    try {
      const ticket = await api.get(id);
      if (selectedId.current === id) setSelected(ticket);
    } catch (error) { addToast(error.message, 'error'); }
  }

  async function submit(action) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const actionTicketId = selected?.id;
    const payload = action === 'create' ? { category, subject: subject.trim(), body: description.trim() } : { version: selected.version, body: reply.trim() };
    const signature = JSON.stringify({ action, id: action === 'create' ? null : selected.id, ...payload, version: undefined });
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, key: crypto.randomUUID(), payload };
    try {
      const ticket = action === 'create' ? await api.create(pendingRequest.current.payload, pendingRequest.current.key) : await api.act(selected.id, action, pendingRequest.current.payload, pendingRequest.current.key);
      pendingRequest.current = null;
      if (action === 'create' || selectedId.current === actionTicketId) {
        selectedId.current = ticket.id;
        setSelected(ticket);
      }
      setShowForm(false);
      setReply('');
      if (action === 'create') { setSubject(''); setDescription(''); }
      addToast(action === 'create' ? 'Ticket created. Your reference is shown below.' : 'Ticket updated.', 'success');
      await load(true);
    } catch (error) {
      addToast(error.message, 'error');
      if (error.status === 409) { pendingRequest.current = null; await load(true); }
    } finally { submitting.current = false; setBusy(false); }
  }

  async function more() {
    try {
      const result = await api.list(tickets.length);
      setTickets(current => [...current, ...result.tickets.filter(ticket => !current.some(item => item.id === ticket.id))]);
      setHasMore(result.tickets.length === 50);
    } catch (error) { addToast(error.message, 'error'); }
  }

  const owner = (scope === 'admin' && selected?.assigned_to === 'calup') || (scope === 'merchant' && selected?.kind === 'customer_complaint' && selected.assigned_to === 'merchant');
  const closed = selected && ['resolved', 'closed'].includes(selected.status);
  const canReopen = closed && (scope === 'admin' || scope === 'customer' || selected.kind === 'merchant_support') && now <= new Date(selected.closed_at).getTime() + (scope === 'admin' ? 7 : 3) * 86400000;
  const visible = tickets.filter(ticket => filter === 'all' || (filter === 'unanswered' ? !ticket.acknowledged_at && !['closed','resolved'].includes(ticket.status) : filter === 'escalated' ? Boolean(ticket.escalated_at) : filter === 'platform' ? ticket.kind === 'merchant_support' : ticket.status === filter));

  return (
    <section className="support-panel" aria-label="Support and complaints">
      <div className="support-heading">
        <h2>{scope === 'customer' ? 'Help with this booking' : scope === 'admin' ? 'Calup support queue' : 'Support & complaints'}</h2>
        {available && scope !== 'admin' && <button className="support-button" type="button" onClick={() => { selectedId.current = null; setSelected(null); setShowForm(true); }}>Raise a ticket</button>}
      </div>
      <p className="support-muted">{scope === 'customer' ? 'Contact your merchant about your booking or payment. Do not share passwords, OTPs, or card details.' : 'Manage customer complaints and report platform bugs or issues to Calup.'}</p>
      {loading ? <p role="status">Loading tickets…</p> : !available ? <button className="support-button" onClick={() => load()}>Retry loading support</button> : <>
        <div className="support-toolbar">
          <label>Show <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All tickets</option><option value="unanswered">Unanswered</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="escalated">Escalated</option>
            {scope !== 'customer' && <option value="platform">Platform support</option>}
          </select></label>
          <button className="support-button support-secondary" onClick={() => load()}>Refresh</button>
        </div>
        {showForm && <form className="support-form" onSubmit={event => { event.preventDefault(); submit('create'); }}>
          <h3>{scope === 'merchant' ? 'Report an issue to Calup' : 'Raise a complaint'}</h3>
          <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{options.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
          <label>Subject<input required minLength={2} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} /></label>
          <label>{category === 'bug' ? 'Steps to reproduce, expected result, and actual result' : 'Describe the issue'}<textarea required minLength={10} maxLength={6000} rows={5} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <p className="support-muted">Text reports are supported now. Secure evidence uploads will be added separately.</p>
          <div className="support-actions"><button className="support-button" disabled={busy}>Submit ticket</button><button type="button" className="support-button support-secondary" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div>
        </form>}
        <div className="support-ticket-list">
          {!visible.length && <p className="support-muted">No tickets to show.</p>}
          {visible.map(ticket => <button type="button" className={`support-ticket ${selected?.id === ticket.id ? 'support-selected' : ''}`} key={ticket.id} onClick={() => openTicket(ticket.id)}>
            <strong>{ticket.subject}</strong><span>{ticket.reference}</span><span>{ticket.status.replaceAll('_', ' ')} · {ticket.assigned_to === 'calup' ? 'Calup team' : 'Merchant'}{ticket.booking_reference ? ` · ${ticket.booking_reference}` : ''}</span>
          </button>)}
          {hasMore && <button className="support-button support-secondary" onClick={more}>Load more tickets</button>}
        </div>
        {selected && !showForm && <TicketDetailDialog onClose={() => { selectedId.current = null; setSelected(null); }}><article className="support-detail">
          <h3>{selected.subject}</h3><p className="support-reference">{selected.reference}</p>
          <p>{labels[selected.category]} · {selected.status.replaceAll('_',' ')} · Handled by {selected.assigned_to === 'calup' ? 'Calup team' : 'merchant'}</p>
          {selected.refundRequest && <div className="support-message"><strong>Refund request: {selected.refundRequest.status.replaceAll('_', ' ')}</strong><p>{selected.refundRequest.reference}</p><p>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: selected.refundRequest.currency }).format(selected.refundRequest.amountPaise / 100)} requested. A support reply or ticket resolution is not proof of a completed refund.</p></div>}
          {scope !== 'customer' && selected.payment_order_id && <p className="support-reference">Payment record: {selected.payment_order_id}{selected.payment_resolution_case_id ? ` · Resolution case: ${selected.payment_resolution_case_id}` : ''}</p>}
          {!selected.acknowledged_at && !closed && <p className="support-muted">Initial response due: {date(selected.response_due_at)}{selected.kind === 'customer_complaint' ? '. Unanswered complaints escalate automatically.' : '.'}</p>}
          <div className="support-conversation" aria-label="Ticket conversation">{selected.messages.map(message => <div className="support-message" key={message.id}><strong>{message.author_role === 'admin' ? 'Calup support' : message.author_role === 'merchant' ? 'Merchant' : 'Customer'}</strong><time>{date(message.created_at)}</time><p>{message.body}</p></div>)}</div>
          {selected.messages.length === 200 && <p className="support-muted">Showing the latest 200 messages. Contact support for the full history.</p>}
          {(!closed || canReopen || (owner && selected.status === 'resolved')) && <form className="support-form" onSubmit={event => { event.preventDefault(); submit(owner && selected.status === 'resolved' ? 'close' : closed ? 'reopen' : 'reply'); }}>
            <label>{owner && selected.status === 'resolved' ? 'Final resolution' : closed ? 'Why are you reopening this ticket?' : 'Reply or resolution'}<textarea required maxLength={6000} rows={4} value={reply} onChange={event => setReply(event.target.value)} /></label>
            <div className="support-actions">
              <button className="support-button" disabled={busy || (closed ? reply.trim().length < 10 : !reply.trim())}>{owner && selected.status === 'resolved' ? 'Close with resolution' : closed ? 'Reopen ticket' : 'Send reply'}</button>
              {scope === 'admin' && selected.status === 'resolved' && canReopen && <button type="button" className="support-button support-secondary" disabled={busy || reply.trim().length < 10} onClick={() => submit('reopen')}>Reopen ticket</button>}
              {owner && !closed && <>
                {!selected.acknowledged_at && <button type="button" className="support-button support-secondary" disabled={busy} onClick={() => submit('acknowledge')}>Acknowledge</button>}
                <button type="button" className="support-button support-secondary" disabled={busy || reply.trim().length < 10} onClick={() => submit('resolve')}>Mark resolved</button>
                <button type="button" className="support-button support-secondary" disabled={busy || reply.trim().length < 10} onClick={() => submit('close')}>Close with resolution</button>
              </>}
              {scope === 'admin' && selected.assigned_to !== 'calup' && <button type="button" className="support-button support-secondary" disabled={busy || reply.trim().length < 10} onClick={() => submit('escalate')}>Accept escalation</button>}
            </div>
          </form>}
          {scope === 'customer' && <p className="support-muted">Unresolved after closure? Email <a href={`mailto:support@calup.app?subject=${encodeURIComponent(`Ticket ${selected.reference}`)}`}>support@calup.app</a> within 7 days. Urgent duplicate charges, unauthorized payments, and payments without an appointment may be escalated immediately after raising a ticket.</p>}
          <details><summary>Ticket activity</summary><ul>{selected.history.map(event => <li key={event.id}>{date(event.created_at)} — {event.action.replaceAll('_',' ')}</li>)}</ul></details>
        </article></TicketDetailDialog>}
      </>}
    </section>
  );
}
