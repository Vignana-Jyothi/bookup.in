const fs=require('node:fs/promises');const path=require('node:path');const {chromium}=require('playwright');
const origin='http://127.0.0.1:5173',output=path.resolve('artifacts/responsiveness-20261019');
const results=[],pageErrors=[];
async function main(){
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();
page.on('pageerror',e=>pageErrors.push(e.message));
await context.route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  async function measure(label, viewport, mode='normal') {
    const metrics=await page.evaluate(()=>{
      const name=el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className.slice(0,110):'',text:(el.getAttribute('aria-label')||el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,100)});
      const seen=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
      const scrollParent=el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+2)return p.className||p.tagName;}return null;};
      const candidates=[...document.querySelectorAll('h1,h2,h3,p,label,button,a,input,select,textarea,table')].filter(seen);
      const outside=candidates.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left< -2||r.right>innerWidth+2);}).map(el=>({...name(el),left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),scrollParent:scrollParent(el)}));
      const clipped=candidates.filter(el=>!['INPUT','TEXTAREA','TABLE'].includes(el.tagName)&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+3&&['hidden','clip'].includes(getComputedStyle(el).overflowX)).map(name);
      const controls=[...document.querySelectorAll('button,a,input:not([type=hidden]),select,summary')].filter(seen);
      const small=controls.filter(el=>{const r=el.getBoundingClientRect();return r.width<44||r.height<44;}).map(el=>({...name(el),width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)}));
      return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,outside:outside.slice(0,25),clipped:clipped.slice(0,20),smallTargets:small.slice(0,30),controlCount:controls.length};
    });
    results.push({label,viewport,mode,...metrics});
    if(metrics.overflow||metrics.clipped.length||viewport.width===390||viewport.height===390)await page.screenshot({path:path.join(output,`${label.replace(/[^a-z0-9]/gi,'-')}-${viewport.width}x${viewport.height}-${mode}.png`),fullPage:true});
    console.log(label,viewport.width+'x'+viewport.height,mode,JSON.stringify({overflow:metrics.overflow,outside:metrics.outside.length,clipped:metrics.clipped.length,small:metrics.smallTargets.length}));
  }

const sizes=[{width:320,height:740},{width:390,height:844},{width:600,height:900},{width:768,height:1024},{width:820,height:1180},{width:1024,height:768},{width:1440,height:900},{width:844,height:390}];
const routes=['/','/subscriptions','/login','/signup','/forgot-password','/reset-password','/terms-and-conditions','/privacy-policy','/refund-policy','/cancellation-policy','/service-delivery-policy','/cookie-policy','/contact','/sandbox/booking','/payment-status'];
try{
for(const route of routes){for(const size of sizes){await page.setViewportSize(size);await page.goto(origin+route,{waitUntil:'networkidle'});await measure(route==='/'?'landing':route.slice(1),size);}
if(['/','/signup','/login','/subscriptions'].includes(route)){
 const size={width:1024,height:768};await page.setViewportSize(size);await page.goto(origin+route,{waitUntil:'networkidle'});
 await page.evaluate(()=>{const nodes=[...document.querySelectorAll('body *')].filter(el=>!el.closest('svg')&&el.getClientRects().length);const sizes=nodes.map(el=>{const s=getComputedStyle(el);return [el,parseFloat(s.fontSize),parseFloat(s.lineHeight)];});for(const [el,size,line]of sizes){el.style.fontSize=size*2+'px';if(Number.isFinite(line))el.style.lineHeight=line*2+'px';}});
 await measure(route==='/'?'landing':route.slice(1),size,'synthetic-text-200');
}
}
}finally{await fs.writeFile(path.join(output,'public-results.json'),JSON.stringify({results,pageErrors,mode:'Actual local public routes; external requests and writes blocked; synthetic text stress is not native browser zoom'},null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
