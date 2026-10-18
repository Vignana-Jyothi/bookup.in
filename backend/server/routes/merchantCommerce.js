import { Router } from 'express';
import { isDeepStrictEqual } from 'node:util';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { commerceOrderPayments } from '../services/commerceOrderPayments.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bucket = 'calup-private-products';
const b64 = (value, max = 4096) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const sealed = value => value && Object.keys(value).every(key => ['iv','data'].includes(key)) && b64(value.iv, 16) && Buffer.from(value.iv, 'base64').length === 12 && b64(value.data);
const validAsset = value => value && Object.keys(value).every(key => ['version','iv','key','metadata'].includes(key)) && value.version === 1 && b64(value.iv,16) && Buffer.from(value.iv,'base64').length === 12 && sealed(value.key) && sealed(value.metadata) && Buffer.from(value.key.data,'base64').length === 48;
export function validVault(value) {
  return value && Object.keys(value).every(key => ['version','iterations','salt','password','recovery'].includes(key)) && value.version === 1 && value.iterations === 600000 &&
    b64(value.salt, 24) && Buffer.from(value.salt, 'base64').length === 16 && sealed(value.password) && sealed(value.recovery) &&
    Buffer.from(value.password.data, 'base64').length === 48 && Buffer.from(value.recovery.data, 'base64').length === 48;
}
export function validCommerceItem(value) {
  return value && Object.keys(value).every(key => ['id','kind','version','title','description','pricePaise','purchaseLimit','durationDays','contentType','status'].includes(key)) &&
    uuid.test(value.id || '') && ['product','membership'].includes(value.kind) && Number.isInteger(value.version) && value.version >= 0 &&
    typeof value.title === 'string' && value.title.trim().length >= 2 && value.title.trim().length <= 120 &&
    typeof value.description === 'string' && value.description.length <= 1000 && Number.isSafeInteger(value.pricePaise) && (value.pricePaise === 0 || value.pricePaise >= 100) && value.pricePaise <= 100000000 &&
    ['draft','archived'].includes(value.status) && (value.kind === 'product' ?
      Number.isInteger(value.purchaseLimit) && value.purchaseLimit >= 1 && value.purchaseLimit <= 1000 && value.durationDays === null && ['file','link'].includes(value.contentType) :
      value.pricePaise > 0 && value.purchaseLimit === null && value.contentType === null && Number.isInteger(value.durationDays) && value.durationDays >= 1 && value.durationDays <= 366);
}
export function createMerchantCommerceRouter({ client = serviceRoleClient, authorize = requireProviderAuth } = {}) {
  const router = Router();
  router.use(tokenRouteLimiter, authorize);
  router.use((_req,res,next) => {
    res.set('Cache-Control','private, no-store');
    if (!client) return res.status(503).json({error:'Commerce storage is unavailable.'});
    next();
  });
  const check = result => { if (result.error) throw result.error; return result.data; };
  async function owned(req) {
    if (!uuid.test(req.params.id || '')) return null;
    return check(await client.from('merchant_commerce_catalog').select('*').eq('id',req.params.id).eq('provider_id',req.providerId).maybeSingle());
  }
  router.get('/',async(req,res,next) => {
    try {
      const items = check(await client.from('merchant_commerce_catalog').select('id,kind,title,description,price_paise,currency,purchase_limit,duration_days,content_type,status,version,created_at').eq('provider_id',req.providerId).order('created_at',{ascending:false}).limit(200));
      const ids=items.filter(item=>item.kind==='product').map(item=>item.id);
      const assets=ids.length ? check(await client.from('merchant_commerce_assets').select('product_id,status').in('product_id',ids)) : [];
      const vault = check(await client.from('merchant_commerce_vaults').select('envelope').eq('provider_id',req.providerId).maybeSingle());
      res.json({data:{items:items.map(item=>({...item,assetStatus:assets.find(asset=>asset.product_id===item.id)?.status || null})),vault:vault?.envelope || null,customerCheckoutEnabled:{marketplace:commerceOrderPayments.enabled('marketplace'),customer_membership:commerceOrderPayments.enabled('customer_membership')},cashfreeMode:'sandbox'}});
    } catch(error) { next(error); }
  });
  router.post('/vault',async(req,res,next) => {
    if (!validVault(req.body)) return res.status(422).json({error:'Invalid encrypted vault envelope.'});
    try {
      check(await client.from('merchant_commerce_vaults').insert({provider_id:req.providerId,envelope:req.body}));
      res.status(201).json({saved:true});
    } catch(error) { next(error); }
  });
  router.post('/items',async(req,res,next) => {
    const item = req.body;
    if (!validCommerceItem(item)) return res.status(422).json({error:'Check the title, price, duration and purchase limit.'});
    try {
      const data = check(await client.rpc('save_merchant_commerce_item_v1',{
        p_provider:req.providerId,p_id:item.id,p_kind:item.kind,p_version:item.version,p_title:item.title.trim(),p_description:item.description,
        p_price:item.pricePaise,p_limit:item.purchaseLimit,p_days:item.durationDays,p_content_type:item.contentType,p_status:item.status,
      }));
      res.json({data});
    } catch(error) { next(error); }
  });
  router.post('/items/:id/publication',async(req,res,next)=>{
    const {version,publish}=req.body || {};
    if(!uuid.test(req.params.id) || !Number.isInteger(version) || version<1 || typeof publish!=='boolean' || Object.keys(req.body).some(key=>!['version','publish'].includes(key))) return res.status(422).json({error:'Refresh the item and choose publish or unpublish.'});
    try {res.json({data:check(await client.rpc('publish_commerce_item_v1',{p_provider:req.providerId,p_id:req.params.id,p_version:version,p_publish:publish}))});} catch(error) {next(error);}
  });
  router.get('/access-requests',async(req,res,next)=>{
    try {res.json({data:check(await client.rpc('list_commerce_access_v1',{p_provider:req.providerId}))});} catch(error) {next(error);}
  });
  router.post('/access-requests/:id/decision',async(req,res,next)=>{
    const {version,status,reason,attendanceConfirmed}=req.body || {};
    if(!uuid.test(req.params.id) || !Number.isInteger(version) || version<1 || !['approved','rejected','revoked'].includes(status) || typeof reason!=='string' || reason.trim().length<10 || reason.length>1000 || (status==='approved' && attendanceConfirmed!==true) || Object.keys(req.body).some(key=>!['version','status','reason','attendanceConfirmed'].includes(key))) return res.status(422).json({error:'Enter a reason of at least 10 characters and confirm attendance before approving.'});
    try {res.json({data:check(await client.rpc('decide_commerce_access_v1',{p_provider:req.providerId,p_id:req.params.id,p_version:version,p_status:status,p_reason:reason.trim()}))});} catch(error) {next(error);}
  });
  router.post('/products/:id/upload',async(req,res,next) => {
    if (!validAsset(req.body)) return res.status(422).json({error:'Only the encrypted asset envelope is accepted.'});
    try {
      const product = await owned(req);
      if (!product || product.kind !== 'product') return res.status(404).json({error:'Product not found.'});
      const vault = check(await client.from('merchant_commerce_vaults').select('provider_id').eq('provider_id',req.providerId).maybeSingle());
      if (!vault) return res.status(409).json({error:'Create your private vault first.'});
      const path = `${req.providerId}/${product.id}.bin`;
      const asset = check(await client.from('merchant_commerce_assets').select('envelope,status').eq('product_id',product.id).maybeSingle());
      if (asset && (asset.status === 'ready' || !isDeepStrictEqual(asset.envelope,req.body))) return res.status(409).json({error:'This product already has content or an upload reservation. Create a new product for replacement content.'});
      if (!asset) check(await client.from('merchant_commerce_assets').insert({product_id:product.id,object_path:path,envelope:req.body}));
      const data = check(await client.storage.from(bucket).createSignedUploadUrl(path,{upsert:false}));
      res.json({data:{path,token:data.token}});
    } catch(error) { next(error); }
  });
  router.post('/products/:id/asset',async(req,res,next) => {
    const value = req.body;
    if (!validAsset(value)) {
      return res.status(422).json({error:'Invalid encrypted asset envelope.'});
    }
    try {
      const product = await owned(req);
      if (!product || product.kind !== 'product') return res.status(404).json({error:'Product not found.'});
      const asset = check(await client.from('merchant_commerce_assets').select('envelope').eq('product_id',product.id).maybeSingle());
      if (!asset || !isDeepStrictEqual(asset.envelope,value)) return res.status(409).json({error:'Encrypted upload reservation does not match.'});
      const files = check(await client.storage.from(bucket).list(req.providerId,{search:`${product.id}.bin`,limit:10}));
      if (!files.some(file => file.name === `${product.id}.bin`)) return res.status(409).json({error:'Upload the encrypted product first.'});
      check(await client.from('merchant_commerce_assets').update({status:'ready'}).eq('product_id',product.id));
      res.status(201).json({saved:true});
    } catch(error) { next(error); }
  });
  router.get('/products/:id/asset',async(req,res,next) => {
    try {
      const product = await owned(req);
      if (!product || product.kind !== 'product') return res.status(404).json({error:'Product not found.'});
      const asset = check(await client.from('merchant_commerce_assets').select('object_path,envelope,status').eq('product_id',product.id).maybeSingle());
      if (!asset) return res.status(404).json({error:'No encrypted content has been uploaded.'});
      if (asset.status !== 'ready') {
        const files = check(await client.storage.from(bucket).list(req.providerId,{search:`${product.id}.bin`,limit:10}));
        if (!files.some(file => file.name === `${product.id}.bin`)) return res.status(409).json({error:'The encrypted upload has not completed. Create a new product if its original upload cannot be resumed.'});
        check(await client.from('merchant_commerce_assets').update({status:'ready'}).eq('product_id',product.id));
      }
      const data = check(await client.storage.from(bucket).createSignedUrl(asset.object_path,60));
      res.json({data:{url:data.signedUrl,envelope:asset.envelope}});
    } catch(error) { next(error); }
  });
  router.get('/orders',async(req,res,next) => {
    try {
      const orders=check(await client.from('commerce_orders').select('id,item_id,contact_id,title,purpose,amount_paise,currency,checkout_state,payment_status,fulfilment_status,created_at,paid_at').eq('provider_id',req.providerId).order('created_at',{ascending:false}).limit(100));
      const periods=check(await client.from('commerce_membership_periods').select('order_id,plan_id,contact_id,starts_at,ends_at').eq('provider_id',req.providerId).order('ends_at',{ascending:false}).limit(100));
      const contacts=orders.length?check(await client.from('commerce_contacts').select('id,phone').eq('provider_id',req.providerId).in('id',[...new Set(orders.map(order=>order.contact_id))])):[];
      res.json({data:{orders:orders.map(({contact_id,...order})=>({...order,maskedPhone:`******${contacts.find(contact=>contact.id===contact_id)?.phone.slice(-4)||'****'}`})),periods:periods.map(({contact_id:_contactId,...period})=>period)}});
    } catch(error) {next(error);}
  });
  router.use((error,_req,res,_next) => {
    const known = {NOT_FOUND:[404,'Item not found.'],VERSION_CONFLICT:[409,'This item changed. Refresh before saving.'],ASSET_IMMUTABLE:[409,'Uploaded content is immutable. Create a new product version.'],ITEM_PUBLISHED:[409,'Unpublish this item before editing its settings.'],MERCHANT_INACTIVE:[403,'An active Calup plan or grace access is required to publish.'],ACCESS_UNAVAILABLE:[409,'This item or merchant access is no longer available.'],CONTENT_REQUIRED:[409,'Finish uploading the encrypted content before publishing.'],INVALID_TRANSITION:[409,'This action is no longer available. Refresh the record.'],BOOKING_NOT_ELIGIBLE:[409,'The booking is no longer eligible for marketplace access.']};
    const [status,message] = known[error.message] || (error.code === '23505' ? [409,'This record already exists. Refresh before retrying.'] : [503,'Commerce setup is unavailable. Check that its staging migration has been applied.']);
    res.status(status).json({error:message});
  });
  return router;
}
