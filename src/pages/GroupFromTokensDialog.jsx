import { useState } from 'react';
import { api } from '../api.js';
import { Button, Field, Modal } from '../components.jsx';
import { GroupMemberPicker } from './GroupMemberPicker.jsx';
import { GroupDialog } from './GroupDialog.jsx';

export function GroupFromTokensDialog({ meta, initialTokenIds = [], pool, onClose, onSaved }) {
  const [selected, setSelected] = useState(initialTokenIds);
  const [listName, setListName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [setup, setSetup] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const lists = [...new Set(meta.tokens.map(token => token.name).filter(Boolean))];
  const continueSetup = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const source = pool ? { poolId: pool.id } : { tokenIds: selected };
      const preview = await api('/meta/group-setup/preview', source, 'POST');
      const names = [...new Set(meta.tokens.filter(token => selected.includes(token.id)).map(token => token.name))];
      setSetup({ source, preview, requestId, name: pool?.name || (names.length === 1 ? names[0] : '') });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  if (setup) return <GroupDialog kind="page" meta={meta} setup={setup} initialIds={setup.preview.readyPageIds}
    onClose={onClose} onBack={() => setSetup(null)} onSaved={onSaved} />;
  return <Modal wide title={pool ? 'Tạo nhóm Page từ pool' : 'Tạo nhóm Page từ token'} onClose={busy ? () => {} : onClose}>
    <form className="group-dialog" onSubmit={continueSetup}>
      <fieldset disabled={busy} className="group-setup-fields">
        <p className="group-setup-steps">1. Chọn token → 2. Chọn Page & lịch → Lưu nhóm</p>
        {pool ? <p>Pool <strong>{pool.name}</strong> · {pool.tokenIds.length} token. Nhóm mới sẽ dùng phân công hiện có của pool này.</p> : <>
          <p>Chọn danh sách vừa nhập hoặc tick các token cần dùng. Studio lấy các Page của những token này, gộp Page trùng và tạo pool cùng nhóm Page khi bạn lưu.</p>
          <Field label="Chọn danh sách theo tên kết nối" hint="Các token có cùng tên được gom để chọn nhanh. Bạn vẫn có thể tick thêm hoặc bỏ từng token bên dưới.">
            <select value={listName} onChange={event => { const name = event.target.value; setListName(name); if (name) setSelected(meta.tokens.filter(token => token.name === name && token.status === 'ACTIVE').map(token => token.id)); }}>
              <option value="">Chọn riêng từng token</option>
              {lists.map(name => <option key={name} value={name}>{name} · {meta.tokens.filter(token => token.name === name && token.status === 'ACTIVE').length} token hoạt động</option>)}
            </select>
          </Field>
          <GroupMemberPicker kind="token" items={meta.tokens} selected={selected} onChange={ids => { setSelected(ids); setListName(''); }} />
        </>}
        <p className="group-picker-help">Auto Post mặc định tắt. Bước tiếp theo cho phép chọn Page, đặt giờ và quyết định khi nào bật.</p>
        {error && <p className="mg-error" role="alert">{error}</p>}
        <div className="modal-actions"><Button type="button" onClick={onClose}>Hủy</Button><Button variant="primary" busy={busy} disabled={!pool && !selected.length}>Tiếp tục: chọn Page & lịch</Button></div>
      </fieldset>
    </form>
  </Modal>;
}
