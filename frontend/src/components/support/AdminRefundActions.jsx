import { useEffect,useRef,useState } from 'react';
import { useStore } from '../../data/store';
import { adminRefundRequest } from '../../services/supabase/adminDashboard.js';
import { supabase } from '../../services/supabase/supabaseClient.js';
import { startAdminPhoneChallenge, verifyAdminPhoneChallenge } from '../../services/supabase/adminMfa.js';

export default function AdminRefundActions({ requestId,onChanged }) {
  const { addToast }=useStore();
  const [result,setResult]=useState(null);
  const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  const [freshAuth,setFreshAuth]=useState(false);
  const [challenge,setChallenge]=useState(null);
  const [otp,setOtp]=useState('');
  const [actionError,setActionError]=useState('');
  const [submissionLocked,setSubmissionLocked]=useState(false);
  const submission=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    adminRefundRequest(requestId,{signal:controller.signal}).then(setResult).catch(error=>{
      if(error.name!=='AbortError') {setFailed(true);addToast(error.message,'error');}
    });
    return()=>controller.abort();
  },[requestId,addToast]);
  const act=async action=>{
    setBusy(true);
    setActionError('');
    try {
      if(action==='approve' && !submission.current) {submission.current={key:crypto.randomUUID(),body:{version:result.data.version,reason:reason.trim()}};setSubmissionLocked(true);}
      await adminRefundRequest(requestId,{action,...(action==='approve' ? submission.current : {})});
      addToast(action==='approve' ? 'Refund approved and queued for Cashfree sandbox. Status will update after verification.' : 'Cashfree refund status check queued.');
      onChanged();
    } catch(error) {
      setActionError(error.message);
      addToast(error.message,'error');
      if(error.code==='FRESH_AUTH_REQUIRED') setFreshAuth(true);
      if(error.status===422) {submission.current=null;setSubmissionLocked(false);}
    } finally {setBusy(false);}
  };
  const verifyPhone=async()=>{
    setBusy(true); setActionError('');
    try {
      if(!challenge) setChallenge(await startAdminPhoneChallenge(supabase));
      else {
        await verifyAdminPhoneChallenge(supabase,challenge.challengeId,otp);
        setFreshAuth(false); setChallenge(null); setOtp('');
        addToast('Phone verified. Review and click Approve to initiate the refund.');
      }
    } catch(error) { setActionError(error.message); addToast(error.message,'error'); }
    finally {setBusy(false);}
  };
  if(!result) return <p role="status">{failed ? 'Refund details could not be loaded. Close and reopen this record to retry.' : 'Loading refund approval details...'}</p>;
  const refund=result.data;
  const amount=new Intl.NumberFormat('en-IN',{style:'currency',currency:refund.currency}).format(refund.amountPaise/100);
  return <section aria-labelledby="admin-refund-action-title" className="admin-refund-actions">
    <h3 id="admin-refund-action-title">Refund review</h3>
    <p>{refund.reference} · {refund.status.replaceAll('_',' ')} · {amount} · {refund.environment}</p>
    <p>Merchant reason: {refund.reason}</p>
    <p>Payment: {refund.paymentStatus} · Appointment: {refund.appointmentStatus}</p>
    <p className="decision-note">Approval cancels the appointment, releases its slot and queues the Cashfree refund. Refunded is shown only after Cashfree confirms success. Sandbox refunds do not transfer real money.</p>
    {refund.gatewayRefundId && <p>Cashfree refund reference: {refund.gatewayRefundId}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {freshAuth && <div>
      <p>Verify your administrator phone here to authorize this financial action. Verification does not submit the refund.</p>
      {challenge && <label>SMS code sent to {challenge.maskedPhone}<input inputMode="numeric" autoComplete="one-time-code" value={otp} maxLength={8} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))} disabled={busy} /></label>}
      <button className="secondary" onClick={verifyPhone} disabled={busy || (Boolean(challenge) && !/^\d{4,8}$/.test(otp))}>{busy ? 'Please wait...' : challenge ? 'Verify SMS code' : 'Send verification SMS'}</button>
      {challenge && <button className="row-action" disabled={busy} onClick={()=>{setChallenge(null);setOtp('');}}>Request a new code</button>}
    </div>}
    {refund.status==='requested' && <>
      <label htmlFor="admin-refund-reason">Approval reason
        <textarea id="admin-refund-reason" value={reason} maxLength={2000} rows={3} disabled={busy || submissionLocked} onChange={event=>setReason(event.target.value)} />
      </label>
      <p>Enter at least 10 characters explaining the approval, then confirm the amount below.</p>
      <label className="admin-refund-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy} />I reviewed the request and authorize a refund of {amount} to the original payment method.</label>
      <button className="primary" disabled={busy || !result.executionEnabled || freshAuth || !confirmed || reason.trim().length<10} onClick={()=>act('approve')}>{busy ? 'Submitting...' : 'Approve and initiate refund'}</button>
      {!result.executionEnabled && <p>Cashfree booking refund execution is not enabled for this environment.</p>}
    </>}
    {['processing','failed','review_required'].includes(refund.status) && <button className="secondary" disabled={busy || !result.executionEnabled} onClick={()=>act('reconcile')}>{busy ? 'Queuing...' : 'Check Cashfree status'}</button>}
    {refund.status==='approved' && <p>Approval is recorded. The refund worker will submit it shortly.</p>}
    {refund.status==='refunded' && <p>Cashfree confirmed this refund succeeded.</p>}
  </section>;
}
