// The number before Generate is a CREDIT COST, not a remaining free-use count.
// A successful session or a generic account-level freeAnimateNum is not proof
// of an available Avatar 3.0 Fast request.
export function classifyDreamFaceQuota({label='',credits=null,effect='',resolution=''}={}) {
  const scope='Avatar 3.0 Fast · 720p';
  if(effect!=='Avatar 3.0 Fast'||resolution!=='720p')return {state:'unknown',scope,message:'Chưa xác nhận được hạn mức cho cấu hình MC.'};
  const normalized=label.replace(/\s+/g,' ').trim();
  const free=/^(?:(\d+)\s+)?Free Daily(?:\s+(\d+))?$/i.exec(normalized);
  if(free){const remaining=Number(free[1]??free[2]??1);return {state:remaining>0?'available':'exhausted',scope,kind:'daily',remaining,label:normalized};}
  const paid=/^(?:(\d+)\s+Generate|Generate\s+(\d+))$/i.exec(normalized);
  const cost=Number(paid?.[1]??paid?.[2]);
  if(!Number.isFinite(cost)||cost<=0||!credits||!Number.isFinite(credits.paid_count)||!Number.isFinite(credits.free_count))return {state:'unknown',scope,label:normalized,message:'Chưa đọc được hạn mức hiện tại từ DreamFace.'};
  const balance=Math.max(0,credits.paid_count)+Math.max(0,credits.free_count);
  return {state:balance>=cost?'available':'exhausted',scope,kind:'credits',balance,cost,label:normalized};
}

export async function inspectDreamFaceQuota(page, {selectRadio,signal}={}) {
  let credits=null;
  const onResponse=async response=>{
    if(!/\/credits\/get_remaining_credits(?:\?|$)/.test(response.url()))return;
    try{const body=await response.json();if(response.ok()&&body.status_code==='THS12140000000')credits=body.data;}catch{}
  };
  page.on('response',onResponse);
  try{
    signal?.throwIfAborted();
    await page.goto('https://www.dreamfaceapp.com/avatar',{waitUntil:'domcontentloaded',timeout:45000});
    const effectButton=page.getByRole('button',{name:/Animate Effect/i}).first();
    await effectButton.waitFor({state:'visible',timeout:15000});
    const effect=await selectRadio(page,effectButton,['Avatar 3.0 Fast'],null,{timeoutMs:10000,signal});
    const resolution=await selectRadio(page,page.getByRole('button',{name:/Resolution/i}).first(),['720p'],null,{timeoutMs:10000,signal});
    // Hydration can replace the cost label after a model/resolution selection.
    let prior='',stable=0;
    const deadline=Date.now()+5000;let label='';
    while(Date.now()<deadline){
      signal?.throwIfAborted();
      const labels=await page.locator('button:visible').allTextContents();
      label=labels.map(text=>text.replace(/\s+/g,' ').trim()).find(text=>/^(?:(?:\d+\s+)?(?:Free Daily|Generate)(?:\s+\d+)?)$/i.test(text))||'';
      stable=label&&label===prior?stable+1:0;prior=label;
      if(stable>=2&&(credits||/Free Daily/i.test(label)))break;
      await page.waitForTimeout(300);
    }
    return classifyDreamFaceQuota({label,credits,effect,resolution});
  }finally{page.off('response',onResponse);}
}
