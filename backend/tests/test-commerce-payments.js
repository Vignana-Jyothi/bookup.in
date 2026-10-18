import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createCommerceOrderPayments } from '../server/services/commerceOrderPayments.js';
import { createPublicCommerceRouter, createCommerceWebhookRouter } from '../server/routes/publicCommerce.js';
import { CashfreeClient } from '../server/services/cashfree.js';

process.env.DISABLE_RATE_LIMIT='true';
const customer=crypto.randomUUID();const provider=crypto.randomUUID();const item=crypto.randomUUID();
const token='d'.repeat(64);const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
const rows=new Map();const actions=[];let creates=0;let verifies=0;let createError;let paid=false;let allowed=true;
function row(amount=100,purpose='marketplace') {
  const id=crypto.randomUUID();
  const value={id,item_id:item,provider_id:provider,contact_id:customer,purpose,amount_paise:amount,currency:'INR',title:'Test offering',item_version:1,
    provider_order_id:`${purpose==='marketplace'?'CP':'CM'}${id.replaceAll('-','')}`,checkout_state:'created',payment_status:amount?'pending':'not_required',fulfilment_status:amount?'pending':'awaiting_delivery',
    expires_at:new Date(Date.now()+900000).toISOString(),gateway_expires_at:new Date(Date.now()+1800000).toISOString(),generation:0};
  rows.set(id,value);return value;
}
const client={
  async rpc(name,args){
    if(name==='commerce_session_v1')return {data:args.p_hash===tokenHash&&args.p_slug==='test'?{contactId:customer,providerId:provider}:null};
    if(name==='begin_commerce_order_v1')return {data:row(0)};
    assert.equal(name,'operate_commerce_order_v1');
    const order=rows.get(args.p_id);actions.push(args.p_action);
    if(args.p_action==='claim'){
      if(order.payment_status!=='pending'||order.leased)return {data:null};
      order.leased=true;order.generation++;
      const dispatch=order.checkout_state==='created';order.checkout_state=dispatch?'dispatching':order.checkout_state;
      return {data:{...order,dispatch,generation:order.generation}};
    }
    assert.equal(args.p_generation,order.generation);
    order.leased=false;
    if(args.p_action==='ready'){order.checkout_state='ready';order.encrypted_session=args.p_session;}
    if(args.p_action==='pending')order.checkout_state='unknown';
    if(args.p_action==='rejected')order.checkout_state='rejected';
    if(args.p_action==='success'){order.payment_status='succeeded';order.fulfilment_status=order.purpose==='marketplace'?'awaiting_delivery':'fulfilled';}
    return {data:{...order}};
  },
  from(table){
    const filters=[];
    const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},limit(){return this;},
      async maybeSingle(){
        if(table==='commerce_contacts')return {data:{phone:'9000000001'}};
        if(table==='merchant_commerce_catalog')return {data:{kind:'product',price_paise:0}};
        return {data:[...rows.values()].find(order=>filters.every(([k,v])=>order[k]===v))||null};
      },single(){return this.maybeSingle();},
    };return query;
  },
};
const signer=new CashfreeClient({clientId:'test-only',clientSecret:'test-only'});
const gateway={isEnabled:()=>true,verifyWebhook:input=>signer.verifyWebhookSignature(input),
  async create(snapshot){creates++;assert.equal(snapshot.customerId,customer);assert.equal(snapshot.phoneVerified,true);if(createError)throw createError;return {payment_session_id:'test-session-secret'};},
  async verify(snapshot){verifies++;assert.equal(snapshot.amountPaise,rows.get(snapshot.id).amount_paise);return {paid,paymentId:paid?'test-provider-payment':null,paymentSessionId:'test-session-secret'};},
};
const payments=createCommerceOrderPayments({client,gateways:{marketplace:gateway,customer_membership:gateway}});
const order=row();
let result=await payments.checkout(order.id,customer);
assert.equal(result.paymentSessionId,'test-session-secret');
assert.notEqual(order.encrypted_session,'test-session-secret');
assert.equal(creates,1);assert.equal(verifies,0);
assert.doesNotMatch(JSON.stringify(payments.publicOrder(order)),/test-session-secret|contact_id|provider_order_id|encrypted_session/);
await assert.rejects(payments.checkout(order.id,crypto.randomUUID()),/NOT_FOUND/);
paid=true;result=await payments.checkout(order.id,customer);
assert.equal(result.paymentStatus,'succeeded');assert.equal(result.fulfilmentStatus,'awaiting_delivery');assert.equal(creates,1);
assert.equal(result.paymentSessionId,undefined);
await payments.reconcile(order.id);assert.equal(creates,1);
paid=false;createError=Object.assign(new Error('timeout'),{outcome:'unknown'});
const uncertain=row();await payments.reconcile(uncertain.id);assert.equal(uncertain.checkout_state,'unknown');
createError=undefined;const before=creates;await payments.reconcile(uncertain.id);
assert.equal(creates,before,'Uncertain create must recover using GET, never POST again');assert.equal(uncertain.checkout_state,'ready');
createError=Object.assign(new Error('invalid provider request'),{outcome:'definitive',status:400});
const rejected=row();await payments.reconcile(rejected.id);assert.equal(rejected.checkout_state,'rejected');
createError=undefined;
const member=row(99900,'customer_membership');await payments.reconcile(member.id);paid=true;await payments.reconcile(member.id);assert.equal(member.fulfilment_status,'fulfilled');

const app=express();app.use('/hooks',express.raw({type:'application/json'}),createCommerceWebhookRouter({client,payments}));app.use(express.json());
app.use('/public',createPublicCommerceRouter({client,payments,trusted:()=>allowed,otp:{}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`calup_commerce_access=${token}`,...headers},body:JSON.stringify(body)});
try {
  let response=await post(`/public/test/items/${item}/checkout`,{version:1,requestKey:crypto.randomUUID(),sandboxAcknowledged:true,amountPaise:1});assert.equal(response.status,422);
  response=await post(`/public/test/items/${item}/checkout`,{version:1,requestKey:crypto.randomUUID(),sandboxAcknowledged:false});assert.equal(response.status,422);
  response=await post(`/public/test/items/${item}/checkout`,{version:1,requestKey:crypto.randomUUID(),sandboxAcknowledged:true},{Cookie:''});assert.equal(response.status,401);
  allowed=false;response=await post(`/public/test/orders/${order.id}/refresh`,{});assert.equal(response.status,403);allowed=true;
  response=await post(`/public/test/orders/${order.id}/refresh`,{payment_status:'SUCCESS'});assert.equal(response.status,422);
  response=await post(`/public/test/orders/${crypto.randomUUID()}/refresh`,{});assert.equal(response.status,404);
  const count=creates;response=await post(`/public/test/items/${item}/checkout`,{version:1,requestKey:crypto.randomUUID(),sandboxAcknowledged:true});assert.equal(response.status,200);
  assert.equal((await response.json()).data.paymentStatus,'not_required');assert.equal(creates,count,'Free claims never call Cashfree');
  response=await post('/hooks/marketplace',{data:{order:{order_id:order.provider_order_id}}});assert.equal(response.status,401);
  const body={data:{order:{order_id:order.provider_order_id}},payment_status:'FAILED'};
  const timestamp=String(Date.now());const signature=crypto.createHmac('sha256','test-only').update(timestamp+JSON.stringify(body)).digest('base64');
  response=await post('/hooks/marketplace',body,{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature});assert.equal(response.status,200);
  assert.equal(order.payment_status,'succeeded','A failed callback cannot downgrade financial truth');
  response=await post('/hooks/marketplace',body,{'x-webhook-timestamp':String(Date.now()-600000),'x-webhook-signature':signature});assert.equal(response.status,401);
  response=await post('/hooks/other',body,{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature});assert.equal(response.status,401);
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log('PASS: isolated commerce dispatch/recovery, encrypted sessions, free claims, ownership, evidence-only status, sandbox acknowledgement, signed webhook freshness and independent membership fulfilment. No external requests or charges.');
