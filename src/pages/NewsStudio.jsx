import { useEffect, useState } from 'react';
import { Newspaper, Search, Video, Settings2, ListVideo } from 'lucide-react';
import { Button } from '../components.jsx';
import { api } from '../api.js';
import { ResearchPage } from './Research.jsx';
import { ProductionPanel } from './ProductionPanel.jsx';
import { NewsStudioSettings } from './NewsStudioSettings.jsx';
import './news-studio.css';

const views = [
  ['research', 'Research & chọn tin', Search],
  ['automatic', 'Tạo video tự động', Video],
  ['settings', 'Cài đặt News', Settings2],
];
export function NewsStudioPage(props) {
  const {data, project, notify, navigate, renderFocus = {}} = props;
  const [view, setView] = useState(renderFocus.view || (renderFocus.batchIds?.length ? 'automatic' : 'research'));
  const [visited, setVisited] = useState(new Set(['research', view]));
  const [outputDirectory, setOutputDirectory] = useState('');
  const [defaultOutput, setDefaultOutput] = useState('');
  const choose = next => { setVisited(current=>new Set([...current,next])); setView(next); };
  useEffect(()=>{
    if (renderFocus.view || renderFocus.batchIds?.length) choose(renderFocus.view || 'automatic');
  },[renderFocus]);
  useEffect(()=>{
    const refresh=()=>api('/news-output/settings').then(s=>setDefaultOutput(s.defaultDirectory)).catch(e=>notify(e.message,'error'));
    refresh();window.addEventListener('news-output-default-changed',refresh);
    return ()=>window.removeEventListener('news-output-default-changed',refresh);
  },[notify]);
  const batches=(data.productionBatches || []).filter(b=>b.projectId===project.id && b.request?.contentType==='news');
  const active=batches.filter(b=>['pending','preparing','running'].includes(b.status)).length;
  return <div className="page news-studio">
    <div className="page-heading"><div><h1><Newspaper size={25} /> News Studio</h1><p>Tìm tin → chọn nội dung → MC và video → Content. Thiết lập và theo dõi ngay tại đây.</p></div><Button onClick={()=>navigate('queue')}><ListVideo size={16} /> Hàng đợi{active ? ` · ${active} lượt News` : ''}</Button></div>
    <div className="news-studio-summary"><span><b>Output News:</b> <code>{outputDirectory || defaultOutput || 'Đang đọc thư mục…'}</code></span><Button onClick={()=>choose('settings')}>Đổi folder & thiết lập</Button></div>
    <div className="news-studio-tabs" role="tablist" aria-label="Các phần News Studio">{views.map(([id,label,Icon])=><button key={id} id={`news-tab-${id}`} role="tab" aria-selected={view===id} aria-controls={`news-panel-${id}`} onClick={()=>choose(id)}><Icon size={17} />{label}</button>)}</div>
    <section id="news-panel-research" role="tabpanel" aria-labelledby="news-tab-research" hidden={view!=='research'}>
      <ResearchPage {...props} embedded newsOutputDirectory={outputDirectory} onOpenSettings={()=>choose('settings')} />
    </section>
    {visited.has('automatic') && <section id="news-panel-automatic" role="tabpanel" aria-labelledby="news-tab-automatic" hidden={view!=='automatic'}>
      <ProductionPanel {...props} mode="news" hideOutput outputDirectory={outputDirectory} focusBatchIds={renderFocus.batchIds || []} focusResearchId={renderFocus.researchId || ''} />
    </section>}
    {visited.has('settings') && <section id="news-panel-settings" role="tabpanel" aria-labelledby="news-tab-settings" hidden={view!=='settings'}>
      <NewsStudioSettings {...props} outputDirectory={outputDirectory} onOutputChange={setOutputDirectory} />
    </section>}
  </div>;
}
