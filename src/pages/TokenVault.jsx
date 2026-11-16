import { useState } from 'react';
import { FolderPlus, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, Button, Empty } from '../components.jsx';
import { fold } from '../../shared/management.js';

export function TokenVault({ tokens, busy, onAdd, onImport, onCreateGroup, onRefresh, onDelete }) {
  const [query, setQuery] = useState('');
  const visible = tokens.filter(token => fold(`${token.name} ${token.id}`).includes(fold(query)));
  return <section className="hub-panel pages-token-panel">
    <div className="hub-panel-heading"><div><span className="hub-kicker">TOKEN VAULT</span><h2>Danh sách token</h2></div>
      <div className="inline-actions"><Button onClick={onImport} disabled={Boolean(busy)}><Plus size={14} /> Nhập danh sách token</Button><Button onClick={onAdd} disabled={Boolean(busy)}><Plus size={14} /> Token</Button></div>
    </div>
    {tokens.length ? <>
      <div className="token-group-toolbar"><input aria-label="Tìm token" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên kết nối hoặc ID token…" />
        <Button variant="primary" disabled={Boolean(busy)} onClick={() => onCreateGroup(visible.filter(token => token.status === 'ACTIVE').map(token => token.id))}><FolderPlus size={14} /> Tạo nhóm Page từ token</Button>
      </div>
      <p className="group-picker-help">{visible.length}/{tokens.length} token. Lọc tên danh sách vừa thêm rồi tạo nhóm; bạn có thể điều chỉnh lựa chọn ở bước tiếp theo.</p>
      <div className="hub-list">{visible.map(item => <article className="hub-list-row" key={item.id}>
        <span className="hub-token-icon"><KeyRound size={14} /></span>
        <div><strong>{item.name}</strong><small>{item.tokenMasked || '***'} · {item.pagesCount || 0} Page · {item.kind === 'VIA_TOKEN' ? `Via Token · App ${item.appId || '?'}` : 'System User'}</small><small>{item.id}</small></div>
        <Badge status={item.status === 'ACTIVE' ? 'ready' : item.status === 'ERROR' ? 'error' : 'offline'} />
        <div className="inline-actions"><Button className="icon-button" title="Đồng bộ lại Page" disabled={Boolean(busy)} busy={busy === `refresh-token:${item.id}`} onClick={() => onRefresh(item)}><RefreshCw size={13} /></Button>
          <Button className="icon-button danger-text" title="Xóa token" disabled={Boolean(busy)} busy={busy === `delete-token:${item.id}`} onClick={() => onDelete(item)}><Trash2 size={13} /></Button></div>
      </article>)}</div>
      {!visible.length && <p className="hub-empty">Không tìm thấy token phù hợp.</p>}
    </> : <Empty icon={KeyRound} title="Vault đang trống">Thêm token do bạn sở hữu để xác minh quyền Page.</Empty>}
  </section>;
}
