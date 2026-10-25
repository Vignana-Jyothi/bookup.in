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


try{
 for(const size of [{width:320,height:740},{width:768,height:1024},{width:667,height:375}]){
 await page.setViewportSize(size);await page.goto(origin+'/subscriptions',{waitUntil:'networkidle'});
 const opener=page.getByRole('button',{name:'Open navigation menu',exact:true});
 await opener.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 const bounds=await dialog.evaluate(el=>({width:innerWidth,height:innerHeight,rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
 await page.screenshot({path:path.join(output,`public-menu-${size.width}x${size.height}.png`)});
 await page.keyboard.press('Escape');
 const focusReturned=await opener.evaluate(el=>document.activeElement===el);
 const wrap=page.locator('.sh-table-wrap');const scroll=await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth;return{scrollLeft:el.scrollLeft,max:el.scrollWidth-el.clientWidth};});
 results.push({label:'public menu/table',size,bounds,focusReturned,tableScroll:scroll});
 }
}catch(e){pageErrors.push(e.stack);}finally{await fs.writeFile(path.join(output,'public-interaction-results.json'),JSON.stringify({results,pageErrors},null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
