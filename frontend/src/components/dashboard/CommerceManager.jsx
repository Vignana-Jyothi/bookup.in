import { useEffect, useRef, useState } from 'react';
import { X, LockKeyhole } from 'lucide-react';
import { useStore } from '../../data/store';
import { merchantCommerceService as api } from '../../services/payments/merchantCommerceService.js';
import { createProductVault, unlockProductVault, encryptProduct, decryptProduct } from '../../services/payments/productVault.js';
import './CommerceManager.css';
import CommerceAccessRequests from './CommerceAccessRequests.jsx';
import CommerceOrders from './CommerceOrders.jsx';

function itemId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const value=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
const empty = kind => ({id:itemId(),kind,version:0,title:'',description:'',pricePaise:0,purchaseLimit:kind === 'product' ? 1 : null,durationDays:kind === 'membership' ? 30 : null,contentType:kind === 'product' ? 'file' : null,status:'draft'});
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100);

export default function CommerceManager({kind,onClose}) {
  const {state,addToast} = useStore();
  const owner = state.provider.id;
  const dialog = useRef(null);
  const cardTop=useRef(null);
  const master = useRef(null);
  const pendingUpload = useRef(null);
  const [data,setData] = useState(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [item,setItem] = useState(() => empty(kind));
  const [price,setPrice] = useState('');
  const [free,setFree] = useState(kind === 'product');
  const [password,setPassword] = useState('');
  const [confirmPassword,setConfirmPassword] = useState('');
  const [recoveryMode,setRecoveryMode] = useState(false);
  const [pendingVault,setPendingVault] = useState(null);
  const [savedRecovery,setSavedRecovery] = useState(false);
  const [unlocked,setUnlocked] = useState(false);
  const [file,setFile] = useState(null);
  const [link,setLink] = useState('');
  const [uploadId,setUploadId] = useState('');
  const [privateLink,setPrivateLink] = useState('');
  const [mode,setMode]=useState('setup');
  const [step,setStep]=useState(0);
  const [visited,setVisited]=useState(0);
  const steps=kind==='product' ? ['Details','Pricing & limits','Private vault','Content','Review'] : ['Details','Pricing','Access period','Review'];
  useEffect(()=>{cardTop.current?.focus({preventScroll:false});},[step,mode]);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const controller = new AbortController();
    api.load(controller.signal).then(setData).catch(failure => {if(failure.name !== 'AbortError') setError(failure.message);});
    return () => {element.close();controller.abort();master.current = null;pendingUpload.current = null;};
  }, []);
  const run = async action => {
    setBusy(true);setError('');
    try {await action();} catch(failure) {setError(failure.message);addToast(failure.message,'error');} finally {setBusy(false);}
  };
  const refresh = async () => setData(await api.load());
  const lock = () => {master.current=null;pendingUpload.current=null;setUnlocked(false);setPassword('');setPendingVault(null);setSavedRecovery(false);setFile(null);setLink('');setPrivateLink('');};
  const unlock = () => run(async () => {
    if (!data.vault) {
      if (password !== confirmPassword) throw new Error('The vault passwords do not match.');
      setPendingVault(await createProductVault(owner,password));setPassword('');setConfirmPassword('');
    } else {master.current=await unlockProductVault(owner,data.vault,password,recoveryMode);setUnlocked(true);setPassword('');}
  });
  const saveVault = () => run(async () => {
    await api.saveVault(pendingVault.envelope);master.current=pendingVault.key;setUnlocked(true);setPendingVault(null);setSavedRecovery(false);await refresh();addToast('Private vault created. Keep your recovery key safe.');
  });
  const persistDraft=async()=>{
      if(item.title.trim().length<2 || item.title.length>120 || item.description.length>1000) throw new Error('Review the product title and description.');
      if(kind==='product' && (!Number.isInteger(item.purchaseLimit) || item.purchaseLimit<1 || item.purchaseLimit>1000)) throw new Error('Set a purchase limit between 1 and 1000.');
      if(kind==='membership' && (!Number.isInteger(item.durationDays) || item.durationDays<1 || item.durationDays>366)) throw new Error('Set an access period between 1 and 366 days.');
      if (!free && !/^\d{1,7}(\.\d{1,2})?$/.test(price)) throw new Error('Enter a price in rupees with up to two decimal places.');
      const amount = free ? 0 : Math.round(Number(price)*100);
      if (!free && amount < 100) throw new Error('Paid items must cost at least INR 1.');
      const saved=await api.saveItem({...item,pricePaise:amount});setItem({...item,version:saved.version,pricePaise:saved.price_paise});setUploadId(saved.id);await refresh();return saved;
  };
  const saveItem = event => {
    event.preventDefault();
    if(step!==steps.length-1) {advance();return;}
    run(async()=>{await persistDraft();addToast('Draft saved. Publish when you are ready to accept access requests.');});
  };
  const advance=()=>run(async()=>{
    if(step===0 && (item.title.trim().length<2 || item.title.length>120 || item.description.length>1000)) throw new Error('Add a title of 2–120 characters and a description up to 1000 characters.');
    if(step===1) {
      if(!free && (!/^\d{1,7}(\.\d{1,2})?$/.test(price) || Number(price)<1 || Number(price)>1000000)) throw new Error('Enter a paid price between INR 1 and INR 10,00,000.');
      if(kind==='product' && (!Number.isInteger(item.purchaseLimit) || item.purchaseLimit<1 || item.purchaseLimit>1000)) throw new Error('Set a purchase limit between 1 and 1000.');
    }
    if(step===2 && kind==='product') {
      if(!unlocked) throw new Error('Create or unlock your private vault before adding content.');
      await persistDraft();
    }
    if(step===2 && kind==='membership' && (!Number.isInteger(item.durationDays) || item.durationDays<1 || item.durationDays>366)) throw new Error('Set an access period between 1 and 366 days.');
    if(step===3 && kind==='product' && data.items.find(value=>value.id===item.id)?.assetStatus!=='ready') throw new Error('Encrypt and upload this product before continuing.');
    setStep(step+1);setVisited(Math.max(visited,step+1));
  });
  const newDraft=()=>{setItem(empty(kind));setPrice('');setFree(kind==='product');setStep(0);setVisited(0);setMode('setup');setFile(null);setLink('');setUploadId('');};
  const publish=()=>run(async()=>{
    const saved=await persistDraft();await api.publish(saved.id,saved.version,true);
    newDraft();setMode('saved');await refresh();addToast('Listing published. Use Saved listings to edit it; existing purchases keep their original terms.');
  });
  const unpublish=value=>run(async()=>{
    const updated=await api.publish(value.id,value.version,false);
    edit({...value,...updated});await refresh();addToast('Listing paused for editing. Save your changes and publish again to accept new purchases.');
  });
  const edit = value => {
    setMode('setup');setStep(0);setVisited(0);setUploadId(value.id);setFile(null);setLink('');
    setItem({id:value.id,kind:value.kind,version:value.version,title:value.title,description:value.description,pricePaise:value.price_paise,purchaseLimit:value.purchase_limit,durationDays:value.duration_days,contentType:value.content_type,status:value.status});
    setFree(value.price_paise === 0);setPrice(String(value.price_paise/100));
  };
  const upload = () => run(async () => {
    const product = data.items.find(value => value.id === uploadId && value.kind === 'product');
    if (!product || !master.current) throw new Error('Unlock the vault and select a saved product.');
    if (product.content_type === 'file' && !file) throw new Error('Choose a file first.');
    if (!pendingUpload.current || pendingUpload.current.id !== product.id || pendingUpload.current.file !== file || pendingUpload.current.link !== link) {
      pendingUpload.current={id:product.id,file,link,...await encryptProduct(owner,product.id,master.current,product.content_type === 'file' ? {file} : {link})};
    }
    const encrypted = pendingUpload.current;
    await api.upload(product.id,encrypted.ciphertext,encrypted.envelope);pendingUpload.current=null;setFile(null);setLink('');await refresh();addToast('Encrypted product saved. Plaintext content stayed in this browser.');
  });
  const download = id => run(async () => {
    setPrivateLink('');
    const asset = await api.asset(id);
    const result = await decryptProduct(owner,id,master.current,asset.envelope,asset.ciphertext);
    if (result.metadata.type === 'link') {
      const url = new URL(new TextDecoder().decode(result.bytes));
      if (url.protocol !== 'https:') throw new Error('This product link is invalid.');
      setPrivateLink(url.href);
    } else {
      const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/octet-stream'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=result.metadata.name || 'product';anchor.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }
    await refresh();
  });
  const products = data?.items.filter(value => value.kind === kind) || [];
  return <dialog ref={dialog} className="commerce-manager" aria-labelledby="commerce-manager-title" onCancel={event => {event.preventDefault();onClose();}}>
    <header><div><h2 id="commerce-manager-title">{kind === 'product' ? 'Marketplace products' : 'Customer membership plans'}</h2><p>{mode==='setup' ? `Step ${step+1} of ${steps.length} · ${steps[step]}` : mode==='requests' ? 'Review customer eligibility' : 'Your saved catalog'}</p></div><button type="button" aria-label="Close commerce setup" onClick={onClose}><X size={22} /></button></header>
    <div className="commerce-manager-body">
      {error && <p role="alert" className="commerce-error">{error}</p>}
      {!data ? <button type="button" disabled={busy} onClick={() => run(refresh)}>{error ? 'Retry loading setup' : 'Loading setup...'}</button> : <>
        <nav className="commerce-mode-nav" aria-label="Commerce workspace"><button type="button" aria-pressed={mode==='setup'} disabled={busy} onClick={()=>setMode('setup')}>Guided setup</button><button type="button" aria-pressed={mode==='saved'} disabled={busy} onClick={()=>setMode('saved')}>Saved listings</button>{kind==='product'&&<button type="button" aria-pressed={mode==='requests'} disabled={busy} onClick={()=>setMode('requests')}>Access requests</button>}<button type="button" aria-pressed={mode==='orders'} disabled={busy} onClick={()=>setMode('orders')}>Orders and access</button><button type="button" disabled={busy} onClick={() => run(refresh)}>Refresh</button></nav>
        {mode==='setup'&&<ol className="commerce-stepper" style={{gridTemplateColumns:`repeat(${steps.length},minmax(0,1fr))`}} aria-label="Setup progress">{steps.map((name,index)=><li key={name}><button type="button" aria-current={step===index?'step':undefined} disabled={busy||index>visited} onClick={()=>setStep(index)}><span>{index+1}</span>{name}</button></li>)}</ol>}
        {mode==='requests'&&<CommerceAccessRequests />}
        {mode==='orders'&&<CommerceOrders kind={kind} />}
        {mode==='setup'&&<p ref={cardTop} tabIndex={-1} className="commerce-notice">{steps[step]}: {step===0?'Start with a clear name and description.':step===1?'Choose what customers pay and how access is limited.':kind==='membership'&&step===2?'Choose how many days the membership covers.':kind==='product'&&step===2?'Keep your content private with a separate vault password.':kind==='product'&&step===3?'Encrypt your product before it leaves this browser.':'Review your settings before publishing.'} Sandbox payments require separate configuration. Product delivery is still pending.</p>}
        {kind === 'product' && mode==='setup'&&step===2&& <section className="commerce-vault"><h3><LockKeyhole size={18} aria-hidden="true" /> Private product vault</h3>
          <p>Titles, descriptions and prices are visible to Calup. Product files, links and filenames are encrypted in your browser. Keep your vault password separate from your login password. Private uploads require HTTPS or localhost.</p>
          {unlocked ? <button type="button" onClick={lock} disabled={busy}>Lock vault</button> : pendingVault ? <>
            <p>Save this recovery key in a password manager. Calup cannot recover it for you.</p><output className="commerce-recovery">{pendingVault.recoveryKey}</output>
            <label className="commerce-check"><input type="checkbox" checked={savedRecovery} onChange={event => setSavedRecovery(event.target.checked)} /> I saved my recovery key outside Calup.</label>
            <button type="button" disabled={busy || !savedRecovery} onClick={saveVault}>Save encrypted vault</button>
          </> : <>
            <label>{recoveryMode ? 'Recovery key' : data.vault ? 'Vault password' : 'Create vault password (12+ characters)'}<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
            {!data.vault && <label>Confirm vault password<input type="password" autoComplete="off" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>}
            <button type="button" disabled={busy || !password} onClick={unlock}>{data.vault ? 'Unlock vault' : 'Create private vault'}</button>
            {data.vault && <button type="button" disabled={busy} onClick={() => {setRecoveryMode(!recoveryMode);setPassword('');}}>{recoveryMode ? 'Use vault password' : 'Use recovery key'}</button>}
          </>}
        </section>}
        <form id="commerce-draft-form" noValidate onSubmit={saveItem} className="commerce-form" hidden={mode!=='setup'}>
          <fieldset hidden={step!==0} disabled={busy}><legend>About your {kind==='product'?'product':'membership'}</legend>
          <label>Title (visible metadata)<input required minLength={2} maxLength={120} value={item.title} onChange={event => setItem({...item,title:event.target.value})} /></label>
          <label>Description (visible metadata)<textarea maxLength={1000} rows={3} value={item.description} onChange={event => setItem({...item,description:event.target.value})} /></label>
          {kind==='product'&&<div className="commerce-choice-grid" role="group" aria-label="Content type">{[['file','Upload a file','Guides, recordings and resources'],['link','Share a private link','An HTTPS resource or download link']].map(([value,name,description])=><label key={value} className={item.contentType===value?'is-selected':''}><input type="radio" name="commerce-content-type" value={value} checked={item.contentType===value} onChange={()=>setItem({...item,contentType:value})} /><strong>{name}</strong><span>{description}</span></label>)}</div>}
          </fieldset>
          <fieldset hidden={step!==1} disabled={busy}><legend>Pricing {kind==='product'?'and purchase limits':''}</legend>
          {kind === 'product' && <div className="commerce-choice-grid" role="group" aria-label="Product pricing">{[[true,'Free product','Approved customers claim without payment'],[false,'Paid product','A separate Cashfree product checkout']].map(([value,name,description])=><label key={name} className={free===value?'is-selected':''}><input type="radio" name="commerce-pricing" checked={free===value} onChange={()=>setFree(value)} /><strong>{name}</strong><span>{description}</span></label>)}</div>}
          {!free && <label>Price (INR)<input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>}
          {kind === 'product' ? <>
            <label>Purchase limit per verified customer<input type="number" required min={1} max={1000} value={item.purchaseLimit} onChange={event => setItem({...item,purchaseLimit:Number(event.target.value)})} /></label>
          </> : null}
          </fieldset>
          {kind==='membership'&&<fieldset hidden={step!==2} disabled={busy}><legend>Access period</legend><label>Access duration (days)<input type="number" required min={1} max={366} value={item.durationDays} onChange={event => setItem({...item,durationDays:Number(event.target.value)})} /></label><p>One payment for a fixed period. No automatic charge or reserved appointment slots.</p></fieldset>}
          <fieldset hidden={step!==steps.length-1} disabled={busy}><legend>Review your listing</legend><dl className="commerce-review"><div><dt>Title</dt><dd>{item.title}</dd></div><div><dt>Price</dt><dd>{free?'Free':money(Math.round(Number(price || 0)*100))}</dd></div><div><dt>{kind==='product'?'Purchase limit':'Access period'}</dt><dd>{kind==='product'?`${item.purchaseLimit} per customer`:`${item.durationDays} days`}</dd></div></dl><p>Publishing makes the listing visible. Product purchases still require verified customer access and merchant approval. Sandbox checkout can be enabled with separate Cashfree credentials. Encrypted customer delivery is still pending.</p>
          <label>Draft status<select value={item.status} onChange={event => setItem({...item,status:event.target.value})}><option value="draft">Draft</option><option value="archived">Archived</option></select></label>
          </fieldset>
        </form>
        {mode==='saved'&&<section><h3>Saved {kind === 'product' ? 'products' : 'membership plans'}</h3><button type="button" disabled={busy} onClick={newDraft}>Create a new listing</button><p>Showing up to 200 catalog records.</p>{!products.length && <p>No drafts yet.</p>}
          <ul className="commerce-items">{products.map(value => <li key={value.id}><div><strong>{value.title}</strong><p>{value.price_paise ? money(value.price_paise) : 'Free'} · {value.status} · {kind === 'product' ? `${value.purchase_limit} purchases per customer` : `${value.duration_days} days`}</p></div><div className="commerce-actions">{value.status==='published'?<button type="button" disabled={busy} onClick={()=>unpublish(value)}>Unpublish to edit</button>:<button type="button" disabled={busy} onClick={() => edit(value)}>Edit</button>}{kind === 'product' && <button type="button" disabled={busy || !unlocked} onClick={() => download(value.id)}>Open private content</button>}</div></li>)}</ul>
          <a href={`/book/${encodeURIComponent(state.provider.slug)}/${kind==='product'?'marketplace':'memberships'}`} target="_blank" rel="noopener noreferrer">Open customer catalog</a>
        </section>}
        {kind === 'product' && mode==='setup'&&step===3&& unlocked && <section className="commerce-form"><h3>Encrypt and upload content</h3><p>Saved content is immutable. Create another product draft for a replacement. Files up to 10 MB; encrypted before upload.</p><p><strong>{item.title}</strong> · {data.items.find(value=>value.id===item.id)?.assetStatus==='ready'?'Content ready':'Upload required'}</p>
          {products.find(value => value.id === uploadId)?.content_type === 'link' ? <label>Private HTTPS product link<input type="url" value={link} maxLength={4096} onChange={event => setLink(event.target.value)} /></label> : <label>Product file<input key={uploadId} type="file" onChange={event => setFile(event.target.files?.[0] || null)} /></label>}
          <button type="button" disabled={busy || !uploadId || data.items.find(value=>value.id===item.id)?.assetStatus==='ready'} onClick={upload}>Encrypt and upload</button>
        </section>}
        {privateLink && <p><a href={privateLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open decrypted product link</a></p>}
        {busy && <p role="status">Saving securely. Please keep this window open...</p>}
      </>}
    </div>
    {data&&mode==='setup'&&<footer className="commerce-step-footer"><button type="button" disabled={busy||step===0} onClick={()=>setStep(step-1)}>Previous</button><span>Step {step+1} / {steps.length}</span><div className="commerce-actions">{step<steps.length-1?<button type="button" disabled={busy} onClick={advance}>Next step</button>:<><button type="submit" form="commerce-draft-form" disabled={busy}>Save draft</button><button type="button" disabled={busy||item.status!=='draft'} onClick={publish}>Publish listing</button></>}</div></footer>}
  </dialog>;
}
