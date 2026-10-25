import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createPublicCommerceRouter } from '../server/routes/publicCommerce.js';
import { createMerchantCommerceRouter } from '../server/routes/merchantCommerce.js';
import { encryptToken } from '../server/utils/crypto.js';

process.env.DISABLE_RATE_LIMIT='true';
const id=crypto.randomUUID();const item=crypto.randomUUID();const contact=crypto.randomUUID();const provider=crypto.randomUUID();
const calls=[];let tokenHash;let otpCalls=0;let trusted=true;
const client={
  async rpc(name,args){
    calls.push({name,args});
    if(name==='begin_commerce_otp_v1')return {data:id};
    if(name==='operate_commerce_otp_v1'){
      if(args.p_action==='reserve_verify')return {data:{encryptedSession:encryptToken('provider-session-secret')}};
      if(args.p_action==='finish_verify'){if(args.p_verified)tokenHash=args.p_token_hash;return {data:{verified:args.p_verified}};}
      return {data:{}};
    }
    if(name==='commerce_session_v1')return {data:args.p_hash===tokenHash?{contactId:contact,providerId:provider,bookingId:crypto.randomUUID(),maskedPhone:'******0001'}:null};
    if(name==='request_commerce_access_v1')return {data:{id,status:'pending',productId:item}};
    if(name==='decide_commerce_access_v1')return {data:{id,status:args.p_status,version:2}};
    if(name==='publish_commerce_item_v1')return {data:{id:item,status:'published'}};
    throw new Error('Unexpected RPC');
  },
};
const otp={async sendOtp(phone){otpCalls++;assert.equal(phone,'9000000001');return {sessionId:'provider-session-secret'};},async verifyOtp(session,code){assert.equal(session,'provider-session-secret');return {verified:code==='123456'};}};
const app=express();app.use(express.json());
app.use('/public',createPublicCommerceRouter({client,otp,trusted:()=>trusted}));
app.use('/merchant',createMerchantCommerceRouter({client,authorize:(req,_res,next)=>{req.providerId=provider;next();}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const post=(path,body,cookie='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
try {
  assert.equal((await post('/public/test/otp/send',{phone:'9000000001',bookingId:'M123456789',providerId:'spoofed'})).status,422);
  assert.equal(otpCalls,0);
  trusted=false;assert.equal((await post('/public/test/otp/send',{phone:'9000000001'})).status,403);trusted=true;
  let response=await post('/public/test/otp/send',{phone:'+91 90000 00001',bookingId:'M123456789'});
  assert.equal(response.status,200);assert.equal(otpCalls,1);
  const challengeCookie=response.headers.getSetCookie()[0].split(';')[0];
  assert.doesNotMatch(challengeCookie,/provider-session-secret|9000000001/);
  assert.equal((await post('/public/test/otp/verify',{challengeId:id,code:'123456'})).status,401,'Same-browser proof is required');
  assert.equal((await post('/public/other/otp/verify',{challengeId:id,code:'123456'},challengeCookie)).status,401,'Challenge cannot switch merchant');
  assert.equal((await post('/public/test/otp/verify',{challengeId:id,code:'000000'},challengeCookie)).status,400);
  response=await post('/public/test/otp/verify',{challengeId:id,code:'123456'},challengeCookie);
  assert.equal(response.status,200);const accessCookie=response.headers.getSetCookie().find(value=>value.startsWith('calup_commerce_access=')).split(';')[0];
  const token=accessCookie.split('=')[1];assert.equal(crypto.createHash('sha256').update(token).digest('hex'),tokenHash);
  assert.match(response.headers.getSetCookie().join(';'),/HttpOnly/);
  assert.equal((await post(`/public/test/items/${item}/access`,{},'')).status,401);
  assert.equal((await post(`/public/test/items/${item}/access`,{contactId:'spoofed'},accessCookie)).status,422);
  response=await post(`/public/test/items/${item}/access`,{},accessCookie);assert.equal(response.status,200);
  assert.equal(calls.at(-1).name,'request_commerce_access_v1');assert.equal(calls.at(-1).args.p_hash,tokenHash);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal((await post(`/merchant/access-requests/${id}/decision`,{version:1,status:'approved',reason:'Verified request evidence.',attendanceConfirmed:false})).status,422);
  response=await post(`/merchant/access-requests/${id}/decision`,{version:1,status:'approved',reason:'Verified request evidence.',attendanceConfirmed:true});assert.equal(response.status,200);assert.equal(calls.at(-1).args.p_provider,provider);
  assert.equal((await post(`/merchant/items/${item}/publication`,{version:1,publish:true,providerId:'spoofed'})).status,422);
  assert.equal((await post(`/merchant/items/${item}/publication`,{version:1,publish:true})).status,200);
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log('PASS: commerce OTP origin/cookie/merchant binding, encrypted provider references, rejected/verified codes, hashed access proof, session-derived requests and attendance-gated merchant decisions. No SMS sent.');
