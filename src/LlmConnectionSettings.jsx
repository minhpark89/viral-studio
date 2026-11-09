import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Button, Field } from './components.jsx';

// The same server settings and saved key are used by News and Product.
export function LlmConnectionSettings({value = {},notify}) {
  const clean=v=>({enabled:v.enabled===true,endpoint:v.endpoint || '',model:v.model || '',timeoutSeconds:v.timeoutSeconds || 90});
  const [draft,setDraft]=useState(()=>clean(value)),[key,setKey]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(''),[models,setModels]=useState([]);
  useEffect(()=>{if(!dirty)setDraft(clean(value));},[value]);
  const update=(name,next)=>{setDirty(true);setDraft(d=>({...d,[name]:next}));};
  const payload=()=>({...draft,...(key.trim()?{apiKey:key.trim()}:{})});
  const execute=async(action)=>{setBusy(action);try{
    if(action==='models'){const r=await api('/settings/llm/models',{endpoint:draft.endpoint,apiKey:key.trim()});setModels(r.models || []);notify(`Đã đọc ${r.models?.length || 0} model.`);}
    else if(action==='test'){const r=await api('/settings/llm/test',payload());setDraft(d=>({...d,enabled:true}));setKey('');setDirty(false);notify(`LLM phản hồi ${r.latencyMs} ms; cấu hình đã được lưu.`);}
    else {const r=await api('/settings/llm',payload(),'PATCH');setDraft(clean(r));setKey('');setDirty(false);notify('Đã lưu kết nối LLM.');}
  }catch(e){notify(e.message,'error');}finally{setBusy('');}};
  return <form onSubmit={e=>{e.preventDefault();execute('save');}}>
    <p className="small muted">LLM dùng chung cho News, Product và Content. Để trống API key để giữ key đã lưu; đổi cấu hình tại đây cũng áp dụng trong Cài đặt hệ thống.</p>
    <label className="toggle-field"><input type="checkbox" checked={draft.enabled} onChange={e=>update('enabled',e.target.checked)} />Bật LLM</label>
    <Field label="Endpoint LLM"><input type="url" required value={draft.endpoint} onChange={e=>update('endpoint',e.target.value)} placeholder="https://your-endpoint/v1/chat/completions" /></Field>
    <Field label="Model LLM"><input required list="news-llm-models" value={draft.model} onChange={e=>update('model',e.target.value)} /></Field><datalist id="news-llm-models">{models.map(model=><option key={model} value={model} />)}</datalist>
    <Field label="API key LLM"><input type="password" autoComplete="off" value={key} placeholder={value.apiKey ? 'Đã có key · để trống để giữ nguyên' : 'Nhập API key nếu endpoint yêu cầu'} onChange={e=>{setKey(e.target.value);setDirty(true);}} /></Field>
    <div className="inline-actions"><Button type="button" disabled={!!busy || !draft.endpoint} onClick={()=>execute('models')}>Tải danh sách model</Button><Button type="button" disabled={!!busy || !draft.endpoint || !draft.model} onClick={()=>execute('test')}>Kiểm tra & lưu LLM</Button><Button type="submit" variant="primary" busy={busy==='save'} disabled={!!busy}>Lưu LLM</Button></div>
  </form>;
}
