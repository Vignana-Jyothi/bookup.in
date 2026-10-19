import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('frontend/src/services/payments/subscriptionService.js', 'utf8');
// Load the real pure exports without initializing auth or making any requests.
const start = source.indexOf('export function isSubscriptionOrderApplied');
const end = source.indexOf('async function request');
const { isSubscriptionOrderApplied: applied, subscriptionOrderNotice: notice, findSubscriptionReceipt: receipt } = await import(`data:text/javascript;base64,${Buffer.from(source.slice(start, end)).toString('base64')}`);
const oldAccess = { entitlement: { source: 'paid', status: 'active' }, openOrder: null };
assert.equal(applied(oldAccess, 'new-order'), false, 'Old paid access is not proof of a new renewal');
for (const [paymentStatus, applicationStatus] of [['pending','not_ready'],['creation_failed','not_ready'],['succeeded','review_required'],['succeeded','refund_required']]) {
  assert.equal(applied({ ...oldAccess, requestedOrder: { orderId:'new-order',paymentStatus,applicationStatus } }, 'new-order'), false);
}
const success = { ...oldAccess, requestedOrder: { orderId:'new-order',paymentStatus:'succeeded',applicationStatus:'applied' } };
assert.equal(applied(success, 'new-order'), true);
assert.equal(applied(success, 'other-order'), false);
assert.equal(notice(oldAccess, 'new-order').type, 'info');
assert.equal(notice(success, 'new-order').type, 'success');
assert.match(notice({ requestedOrder: { orderId:'new-order', paymentStatus:'succeeded', applicationStatus:'review_required' } }, 'new-order').text, /Do not pay again/);
const documents = [{ id:'newer-other',type:'invoice' },{ id:'credit',type:'credit_note' },{ id:'matching',type:'invoice' }];
const reads=[];
const result=await receipt({documents},'new-order',async id=>{reads.push(id);return {id,subscriptionOrderId:id==='matching'?'new-order':'other-order'};});
assert.equal(result.id,'matching','Only this order receipt opens, never the latest unrelated invoice');
assert.deepEqual(reads,['newer-other','matching']);
assert.equal(await receipt({documents:documents.slice(0,1)},'new-order',async()=>({subscriptionOrderId:'other-order'})),null);
await assert.rejects(receipt({documents},'new-order',async()=>{throw new Error('Unavailable');}),/Unavailable/);
console.log('PASS: subscription renewal evidence is order-specific; receipts never use an unrelated renewal.');
