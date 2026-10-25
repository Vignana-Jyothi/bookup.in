import { Router } from 'express';
import { requireSupportAdmin } from './adminAuth.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { bookingRefundsEnabled, runBookingRefundCycle, recordBookingRefundWebhook } from '../services/bookingRefundExecution.js';
import { cashfreeClient } from '../services/cashfree.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages = {
  NOT_FOUND: [404,'Refund request not found.'], FORBIDDEN: [403,'Administrator verification is required.'],
  FRESH_AUTH_REQUIRED: [409,'Verify your administrator phone again, then reopen this refund request. Financial approval requires verification within five minutes.'],
  VERSION_CONFLICT: [409,'This refund request changed. Reload it before approving.'],
  IDEMPOTENCY_CONFLICT: [409,'This retry differs from the original approval. Refresh the request.'],
  INVALID_TRANSITION: [409,'This request cannot be approved in its current state.'],
  PAYMENT_NOT_REFUNDABLE: [409,'This payment is not eligible for the configured sandbox refund account.'],
  REFUND_BALANCE_CHANGED: [409,'The refundable balance changed. Review existing refunds before continuing.'],
  VALIDATION_FAILED: [422,'Check the approval reason and retry key.'],
};
export function createAdminBookingRefundsRouter({ client = serviceRoleClient, authorize = requireSupportAdmin,
  enabled = bookingRefundsEnabled, kick = () => setImmediate(() => runBookingRefundCycle()) } = {}) {
  const router = Router();
  router.use(tokenRouteLimiter, authorize);
  router.use((req,res,next) => {
    res.set('Cache-Control','private, no-store');
    if (!uuid.test(req.path.split('/')[1] || '')) return res.status(404).json({error:'Refund request not found.'});
    if (!client) return res.status(503).json({error:'Refund storage is unavailable.'});
    next();
  });
  const fail = (res,error) => {
    const code=Object.keys(messages).find(key => error?.message===key);
    const [status,message]=messages[code] || [503,'Refund information is temporarily unavailable. Retry with the same request.'];
    return res.status(status).json({error:message,code:code || 'REFUND_UNAVAILABLE'});
  };
  router.get('/:id',async(req,res)=>{
    const {data,error}=await client.rpc('admin_booking_refund_projection_v1',{p_id:req.params.id});
    if(error) return fail(res,error);
    if(!data) return res.status(404).json({error:'Refund request not found.'});
    return res.json({data,executionEnabled:enabled()});
  });
  router.post('/:id/approve',async(req,res)=>{
    if(!enabled()) return res.status(503).json({error:'Cashfree booking refunds are enabled only for configured sandbox testing.'});
    const {version,reason}=req.body || {};
    const key=req.headers['idempotency-key'];
    if(!Number.isInteger(version) || version<1 || typeof reason!=='string' || reason.trim().length<10 || reason.length>2000 ||
      typeof key!=='string' || key.length<16 || key.length>128 || Object.keys(req.body || {}).some(name=>!['version','reason'].includes(name))) {
      return res.status(422).json({error:'Enter an approval reason of 10–2000 characters and refresh the request details.'});
    }
    const {data,error}=await client.rpc('approve_booking_refund_v1',{p_id:req.params.id,p_actor_id:req.user.id,p_session_id:req.adminSessionId,
      p_version:version,p_reason:reason.trim(),p_key:key});
    if(error) return fail(res,error);
    kick();
    return res.status(202).json({data});
  });
  router.post('/:id/reconcile',async(req,res)=>{
    if(!enabled()) return res.status(503).json({error:'Sandbox refund reconciliation is unavailable.'});
    if(Object.keys(req.body || {}).length) return res.status(422).json({error:'No refund amount or gateway details are accepted.'});
    const {data,error}=await client.rpc('wake_booking_refund_v1',{p_id:req.params.id});
    if(error) return fail(res,error);
    if(!data) return res.status(409).json({error:'No submitted refund needs reconciliation. Refresh the request.'});
    kick();
    return res.status(202).json({queued:true});
  });
  router.use((error,_req,res,next)=>{ if(res.headersSent) return next(error); return fail(res,error); });
  return router;
}

export function createBookingRefundWebhookRouter({ enabled=bookingRefundsEnabled, gateway=cashfreeClient, record=recordBookingRefundWebhook }={}) {
  const router=Router();
  router.post('/',async(req,res)=>{
    if(!enabled()) return res.sendStatus(404);
    if(!gateway.verifyWebhookSignature({rawBody:req.body,timestamp:req.headers['x-webhook-timestamp'],signature:req.headers['x-webhook-signature']})) return res.sendStatus(401);
    let payload;
    try {payload=JSON.parse(req.body.toString('utf8'));} catch {return res.sendStatus(400);}
    try {return res.sendStatus(await record(payload,req.body) ? 200 : 400);} catch {return res.sendStatus(503);}
  });
  return router;
}
