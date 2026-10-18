import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { bookingRefundService } from '../../services/payments/bookingRefundService';

export default function BookingRefundRequest({ appointment }) {
  const { addToast } = useStore();
  const [request, setRequest] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pending = useRef(null);
  const submitting = useRef(false);
  const load = useCallback(async (quiet = false) => {
    try { setRequest(await bookingRefundService.get(appointment.id)); setReady(true); }
    catch (error) { if (!quiet) addToast(error.message, 'error'); }
  }, [appointment.id, addToast]);
  useEffect(() => {
    const initial = setTimeout(() => load(), 0);
    const timer = setInterval(() => { if (!document.hidden && !submitting.current) load(true); }, 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const text = reason.trim();
    if (pending.current?.reason !== text) pending.current = { reason: text, key: crypto.randomUUID() };
    try {
      const value = await bookingRefundService.create(appointment.id, text, pending.current.key);
      setRequest(value); setExpanded(false); pending.current = null;
      addToast('Refund request sent to Calup for review. No money has been refunded yet.', 'success');
    } catch (error) { addToast(error.message, 'error'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="card card-padding" aria-label="Refund request">
    <h4>Refund request</h4>
    {request ? <>
      <p style={{ overflowWrap: 'anywhere' }}><strong>{request.reference}</strong></p>
      <p>Status: <strong>{request.status.replaceAll('_', ' ')}</strong></p>
      <p>Amount requested: {new Intl.NumberFormat('en-IN', { style: 'currency', currency: request.currency }).format(request.amount_paise / 100)}</p>
      <p>{request.status==='refunded' ? 'Cashfree confirmed this refund. The appointment is cancelled and its slot is released.' :
        ['approved','processing'].includes(request.status) ? 'The appointment is cancelled and its slot is released. The refund is awaiting Cashfree confirmation.' :
        ['failed','review_required'].includes(request.status) ? 'The refund needs Calup review. No successful refund is confirmed; use the linked support case.' :
        'Your appointment and payment remain unchanged while Calup reviews the request.'}</p>
      <Link className="btn btn-secondary" to="/dashboard/support" state={{ ticketId: request.ticket_id }}>View refund support case</Link>
    </> : !ready ? <button className="btn btn-secondary" onClick={() => load()}>Load refund status</button> : <>
      <p>Ask Calup to review a refund of the remaining paid amount. Submitting does not cancel the appointment or issue a refund.</p>
      {!expanded ? <button className="btn btn-secondary" onClick={() => setExpanded(true)}>Request refund</button> : <form onSubmit={submit}>
        <label className="form-label" htmlFor="booking-refund-reason">Reason for refund</label>
        <textarea id="booking-refund-reason" className="form-input" required minLength={10} maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)} />
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setExpanded(false)}>Back</button></div>
      </form>}
    </>}
  </section>;
}
