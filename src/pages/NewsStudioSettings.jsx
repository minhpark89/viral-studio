import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button, Field } from '../components.jsx';
import { NewsVideoOptions, useNewsVideoOptions } from '../NewsVideoOptions.jsx';
import { NewsOutputPicker } from './ProductOutput.jsx';
import { DreamFacePanel } from './Research.jsx';
import { LlmConnectionSettings } from '../LlmConnectionSettings.jsx';

export function NewsStudioSettings({data,project,notify,navigate,outputDirectory,onOutputChange}) {
  const [options,setOptions,save]=useNewsVideoOptions(project);
  const [performance,setPerformance]=useState({concurrency:data.settings.concurrency || 2,renderConcurrency:data.settings.renderConcurrency || 1,renderThreads:data.settings.renderThreads || 2});
  const [busy,setBusy]=useState(false);
  useEffect(()=>setPerformance({concurrency:data.settings.concurrency || 2,renderConcurrency:data.settings.renderConcurrency || 1,renderThreads:data.settings.renderThreads || 2}),[data.settings.concurrency,data.settings.renderConcurrency,data.settings.renderThreads]);
  const savePerformance=async e=>{e.preventDefault();setBusy(true);try{await api('/settings',performance,'PATCH');notify('Đã lưu tốc độ xử lý.');}catch(error){notify(error.message,'error');}finally{setBusy(false);}};
  return <div className="news-settings-grid">
    <section className="panel"><h2>Output News · Chọn nơi lưu video</h2><NewsOutputPicker value={outputDirectory} onChange={onOutputChange} notify={notify} /><p className="small muted">Folder riêng áp dụng cho lượt mới từ Research và Tạo video tự động trong News Studio đang mở. Đặt làm mặc định để giữ khi mở lại app.</p></section>
    <section className="panel"><h2>Hình thức video · theo dự án</h2><NewsVideoOptions value={options} onChange={setOptions} showFont saveState={save} /><p className="small muted">Ảnh MC hoặc xoay vòng MC được chọn cùng các tin sắp render ở Research, hoặc ngay trong form Tạo video tự động.</p></section>
    <section className="panel"><h2>Kết nối LLM</h2><LlmConnectionSettings value={data.settings.llm} notify={notify} /></section>
    <section className="panel"><h2>Tốc độ xử lý · toàn app</h2><form onSubmit={savePerformance}><div className="form-grid">{[['concurrency','Tác vụ AI song song',4],['renderConcurrency','Video render song song',4],['renderThreads','FFmpeg threads / video',32]].map(([key,label,max])=><Field key={key} label={label}><input type="number" min="1" max={max} required value={performance[key]} onChange={e=>setPerformance({...performance,[key]:Number(e.target.value)})} /></Field>)}</div><p className="small muted">Giới hạn dùng chung cho News, Product và timeline trên máy này.</p><Button type="submit" variant="primary" busy={busy}>Lưu tốc độ</Button></form></section>
    <div className="news-settings-wide research-page"><DreamFacePanel data={data} notify={notify} /><div className="inline-actions"><Button onClick={()=>navigate('accounts')}>Quản lý profile DreamFace</Button><Button onClick={()=>navigate('settings')}>Website, Content & cài đặt hệ thống</Button></div></div>
  </div>;
}
