const iterations = 600000;
const maxBytes = 10 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const random = size => crypto.getRandomValues(new Uint8Array(size));
const encode = bytes => {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(text);
};
const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
const aes = bytes => crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
const binding = (owner,context) => encoder.encode(`calup-vault:v1:${owner}:${context}`);
async function passwordKey(password,salt) {
  const material = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(key,data,aad) {
  const iv = random(12);
  return {iv:encode(iv),data:encode(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,data)))};
}
async function unseal(key,value,aad) {
  return crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv),additionalData:aad},key,decode(value.data));
}
export async function createProductVault(owner,password) {
  if (!crypto?.subtle) throw new Error('Private uploads require HTTPS or localhost.');
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use a separate vault password of at least 12 characters.');
  const master = random(32);
  const recovery = random(32);
  const salt = random(16);
  const envelope = {version:1,iterations,salt:encode(salt),
    password:await seal(await passwordKey(password,salt),master,binding(owner,'password')),
    recovery:await seal(await aes(recovery),master,binding(owner,'recovery'))};
  return {envelope,key:await aes(master),recoveryKey:encode(recovery)};
}
export async function unlockProductVault(owner,envelope,secret,recovery = false) {
  if (envelope?.version !== 1 || envelope.iterations !== iterations) throw new Error('Unsupported vault format.');
  try {
    const key = recovery ? await aes(decode(secret.trim())) : await passwordKey(secret,decode(envelope.salt));
    return aes(await unseal(key,envelope[recovery ? 'recovery' : 'password'],binding(owner,recovery ? 'recovery' : 'password')));
  } catch { throw new Error('Could not unlock the vault. Check the password or recovery key.'); }
}
export async function encryptProduct(owner,id,master,{file,link}) {
  let bytes;
  let metadata;
  if (file) {
    if (!file.size || file.size > maxBytes) throw new Error('Choose a non-empty file up to 10 MB.');
    bytes = new Uint8Array(await file.arrayBuffer());
    metadata = {type:'file',name:file.name.slice(0,200),mime:'application/octet-stream'};
  } else {
    let url;
    try {url = new URL(link);} catch {throw new Error('Enter a valid HTTPS product link.');}
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 4096) throw new Error('Use an HTTPS link without embedded credentials.');
    bytes = encoder.encode(url.href); metadata = {type:'link'};
  }
  const contentBytes = random(32);
  const contentKey = await aes(contentBytes);
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:binding(owner,`asset:${id}`)},contentKey,bytes);
  const envelope = {version:1,iv:encode(iv),key:await seal(master,contentBytes,binding(owner,`key:${id}`)),metadata:await seal(contentKey,encoder.encode(JSON.stringify(metadata)),binding(owner,`metadata:${id}`))};
  return {ciphertext:new Blob([ciphertext],{type:'application/octet-stream'}),envelope};
}
export async function decryptProduct(owner,id,master,envelope,ciphertext) {
  if (envelope?.version !== 1) throw new Error('Unsupported product format.');
  const key = await aes(await unseal(master,envelope.key,binding(owner,`key:${id}`)));
  const metadata = JSON.parse(decoder.decode(await unseal(key,envelope.metadata,binding(owner,`metadata:${id}`))));
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:binding(owner,`asset:${id}`)},key,ciphertext);
  return {metadata,bytes};
}
