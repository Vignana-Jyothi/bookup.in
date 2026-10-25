import { useEffect, useState } from 'react';
import { merchantCommerceService as api } from '../../services/payments/merchantCommerceService.js';
import { useStore } from '../../data/store';

export default function CommerceAccessRequests() {
  const {addToast}=useStore();
  const [requests,setRequests]=useState([]);
  const [selected,setSelected]=useState(null);
  const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    const load=()=>api.accessRequests().then(data=>{if(active){setRequests(data);setError('');}}).catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setLoading(false);});
    load();const timer=setInterval(()=>{if(!document.hidden)load();},15000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const decide=async status=>{
    setBusy(true);setError('');
    try {await api.decide(selected.id,{version:selected.version,status,reason:reason.trim(),attendanceConfirmed:confirmed});setRequests(await api.accessRequests());setSelected(null);setReason('');setConfirmed(false);addToast('Access decision saved. Approval does not confirm payment or delivery.');}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  return <section><h3>Customer access requests</h3><p>Confirm attendance before approving purchase eligibility. Free products also require approval. Approval does not issue a product or charge a customer.</p>
    {error&&<p role="alert" className="commerce-error">{error}</p>}
    {loading?<p role="status">Loading requests...</p>:!requests.length?<p>No access requests yet.</p>:<ul className="commerce-items">{requests.map(value=><li key={value.id}><div><strong>{value.title}</strong><p>{value.customer_name} · {value.masked_phone} · {value.booking_reference}</p><p>{value.status}</p></div><button type="button" disabled={busy} onClick={()=>{setSelected(value);setReason('');setConfirmed(false);}}>Review request</button></li>)}</ul>}
    {selected&&<div className="commerce-form"><h3>{selected.title}</h3><p>{selected.booking_reference} · {selected.status}</p>{selected.reason&&<p>Previous decision: {selected.reason}</p>}
      {['pending','approved'].includes(selected.status)&&<><label>Decision reason<textarea value={reason} maxLength={1000} rows={3} onChange={event=>setReason(event.target.value)} /></label>
        {selected.status==='pending'&&<label className="commerce-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} />I confirm this customer attended the event and may purchase this product.</label>}
        <div className="commerce-actions">{selected.status==='pending'?<><button type="button" disabled={busy||reason.trim().length<10||!confirmed} onClick={()=>decide('approved')}>Approve access</button><button type="button" disabled={busy||reason.trim().length<10} onClick={()=>decide('rejected')}>Reject</button></>:<button type="button" disabled={busy||reason.trim().length<10} onClick={()=>decide('revoked')}>Revoke access</button>}</div>
      </>}<button type="button" disabled={busy} onClick={()=>setSelected(null)}>Close review</button>
    </div>}
  </section>;
}
