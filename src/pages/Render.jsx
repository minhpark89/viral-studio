import { useState } from 'react';
import { EditorPage } from './Editor.jsx';
import { Button, Field } from '../components.jsx';
import './news-studio.css';

export function RenderPage(props) {
  const [kind,setKind]=useState('news');
  return <div className="manual-render">
    <section className="manual-render-heading"><h1>Dựng video thủ công</h1><p>Ghép và chỉnh media có sẵn trên timeline. Luồng tạo video tự động nằm trong News Studio và Product Studio.</p>
      <div className="inline-actions"><Button onClick={()=>props.navigate('news')}>Mở News Studio</Button><Button onClick={()=>props.navigate('product')}>Mở Product Studio</Button></div>
      <div className="manual-kind"><Field label="Loại video xuất từ timeline"><select value={kind} onChange={e=>setKind(e.target.value)}><option value="news">News · Output News</option><option value="product">Product · Output Product</option></select></Field></div>
    </section>
    <EditorPage {...props} renderKind={kind} />
  </div>;
}
