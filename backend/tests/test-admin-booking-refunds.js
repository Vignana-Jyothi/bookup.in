import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createAdminBookingRefundsRouter,createBookingRefundWebhookRouter } from '../server/routes/adminBookingRefunds.js';
import { processBookingRefund,validateBookingRefund } from '../server/services/bookingRefundExecution.js';
import { openApiDocument } from '../server/openapi.js';
import { appointmentRefundLabel } from '../../frontend/src/utils/appointmentRefundStatus.js';

process.env.DISABLE_RATE_LIMIT='true';
for (const [refundStatus,expected] of [['requested','Confirmed'],['approved','Refund processing'],['processing','Refund processing'],['refunded','Refunded'],['failed','Refund needs review'],['review_required','Refund needs review']]) {
  assert.equal(appointmentRefundLabel({sourceSystem:'cashfree_v1',refundStatus},'Confirmed'),expected);
}
assert.equal(appointmentRefundLabel({sourceSystem:'legacy',refundStatus:'refunded'},'Cancelled'),'Cancelled');
const requestId=crypto.randomUUID();
const context={requestId,refundId:crypto.randomUUID(),gatewayRefundId:'CR123456789',generation:1,dispatchStarted:null,orderId:'sandbox-order',environment:'sandbox',gatewayAccount:'calup_primary',amountPaise:15000,paymentAmountPaise:15000,currency:'INR',providerPaymentId:'123'};
const owner=crypto.randomUUID();
const approved={id:requestId,status:'approved',version:2};
const calls=[];
let dbError=null;
let enabled=true;
let kicked=0;
const client={async rpc(name,args){calls.push({name,args});return {data:name==='wake_booking_refund_v1' ? true : approved,error:dbError};}};
const app=express();
app.use('/webhook',express.raw({type:'application/json'}),createBookingRefundWebhookRouter({enabled:()=>true,gateway:{verifyWebhookSignature:({signature})=>signature==='valid'},record:async()=>true}));
app.use(express.json());
app.use('/guarded',createAdminBookingRefundsRouter({client}));
app.use('/refunds',createAdminBookingRefundsRouter({client,enabled:()=>enabled,authorize:(req,_res,next)=>{req.user={id:'staff-user'};req.adminSessionId='staff-session';next();},kick:()=>kicked++}));
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const post=(body,key=crypto.randomUUID())=>fetch(`${base}/refunds/${requestId}/approve`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
try {
  assert.equal((await fetch(`${base}/guarded/${requestId}`)).status,401);
  assert.equal((await fetch(`${base}/refunds/not-an-id`)).status,404);
  assert.equal((await post({version:1,reason:'Evidence reviewed for approval.',amountPaise:1})).status,422,'No caller-defined amount');
  assert.equal(calls.length,0);
  let response=await post({version:1,reason:'Evidence reviewed for approval.'});
  assert.equal(response.status,202);
  assert.equal(calls.at(-1).args.p_actor_id,'staff-user');
  assert.equal(calls.at(-1).args.p_session_id,'staff-session');
  assert.equal(kicked,1);
  dbError={message:'FRESH_AUTH_REQUIRED'};
  response=await post({version:1,reason:'Evidence reviewed for approval.'});
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'FRESH_AUTH_REQUIRED');
  dbError={message:'private SQL details'};
  response=await post({version:1,reason:'Evidence reviewed for approval.'});
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/private SQL/);
  dbError=null;
  enabled=false;
  assert.equal((await post({version:1,reason:'Evidence reviewed for approval.'})).status,503);
  enabled=true;
  assert.equal((await fetch(`${base}/refunds/${requestId}/reconcile`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,202);
  assert.equal((await fetch(`${base}/webhook`,{method:'POST',headers:{'Content-Type':'application/json','x-webhook-signature':'invalid'},body:'{}'})).status,401);
  assert.equal((await fetch(`${base}/webhook`,{method:'POST',headers:{'Content-Type':'application/json','x-webhook-signature':'valid'},body:'{}'})).status,200);
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

let refund={order_id:context.orderId,refund_id:context.gatewayRefundId,cf_payment_id:'123',refund_currency:'INR',refund_amount:150,refund_status:'SUCCESS'};
let createError=null;
let lookupError=null;
let posts=0;
let dispatchPermitted=true;
let finished;
const database={async rpc(name,args){
  if(name==='begin_booking_refund_dispatch_v1') return {data:dispatchPermitted};
  if(name==='finish_booking_refund_v1'){finished=args;return{data:true};}
  throw new Error('Unexpected SQL');
}};
const gateway={environment:'sandbox',getOrder:async()=>({order_id:context.orderId,order_status:'PAID',order_currency:'INR',order_amount:150}),
  getOrderPayments:async()=>[{cf_payment_id:'123',payment_status:'SUCCESS',payment_currency:'INR',payment_amount:150}],
  createRefund:async(order,input,key)=>{posts++;assert.equal(order,context.orderId);assert.equal(input.refund_id,context.gatewayRefundId);assert.equal(key,context.refundId);if(createError)throw createError;return refund;},
  getRefund:async()=>{if(lookupError)throw lookupError;return refund;},
};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(posts,1);
assert.equal(finished.p_status,'succeeded');
createError={outcome:'unknown',status:0};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(finished.p_status,'succeeded','Timeout after acceptance is recovered by GET');
lookupError={status:404};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(finished.p_status,'submitted','Unknown outcome remains reserved');
const count=posts;
await processBookingRefund({...context,dispatchStarted:'2026-10-16'},owner,{database,gateway});
assert.equal(posts,count,'Reconciliation never repeats POST');
createError={outcome:'definitive',status:400};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(finished.p_status,'failed');
lookupError=null;createError=null;
refund={...refund,refund_amount:149};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(finished.p_status,'review_required','Wrong amount cannot establish refund truth');
refund={...refund,refund_amount:150,refund_status:'PENDING_APPROVAL'};
assert.equal(validateBookingRefund(refund,context),'processing');
dispatchPermitted=false;
const before=posts;
await processBookingRefund(context,owner,{database,gateway});
assert.equal(posts,before,'Existing dispatch intent prevents a duplicate POST');
await processBookingRefund({...context,environment:'production'},owner,{database,gateway});
assert.equal(finished.p_status,'review_required');
assert.equal(posts,before,'Production/account mismatch cannot submit');
await processBookingRefund({...context,amountPaise:Number.MAX_SAFE_INTEGER+1},owner,{database,gateway});
assert.equal(finished.p_status,'review_required');
assert.equal(posts,before,'Unsafe money arithmetic cannot submit');
const originalGetOrder=gateway.getOrder;
gateway.getOrder=async()=>{throw new Error('Network unavailable');};
await processBookingRefund(context,owner,{database,gateway});
assert.equal(finished.p_status,'requested','Preflight failures do not claim gateway submission');
assert.equal(posts,before);
gateway.getOrder=originalGetOrder;
assert.ok(openApiDocument.paths['/api/v1/admin/refund-requests/{id}/approve']);
console.log('PASS: Refund authorization, fresh-auth errors, immutable amount, safe failures, signed callbacks, identity checks, timeout recovery and no duplicate dispatch. No real gateway calls.');
