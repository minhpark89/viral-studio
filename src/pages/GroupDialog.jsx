import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Button, Field, Modal } from '../components.jsx';
import { GroupMemberPicker, pageCanJoin } from './GroupMemberPicker.jsx';

const blockedLabels = { missing_mapping: 'Chưa có token được xác minh cho Page', token_capacity: 'Đã đầy giới hạn Page / token', page_unavailable: 'Page cần xử lý hoặc đang tạm ngưng' };

export function PoolGuide() {
  return <details className="group-guide"><summary>Cách dùng pool token và nhóm Page</summary>
    <p><strong>Pool token</strong> phân công token phụ trách Page. <strong>Nhóm Page</strong> chọn các Page nhận nội dung và giờ đăng.</p>
    <ol><li>Trong tab Token, thêm và đồng bộ các token có quyền quản lý Page.</li><li>Tạo pool, chọn token, chọn phạm vi Page và cách chia. Bấm <strong>Xem trước phân công</strong>, rồi lưu.</li><li>Tạo hoặc sửa nhóm Page, chọn pool vừa tạo, đặt giờ và khoảng cách, bật Auto Post.</li></ol>
    <p>30 token cùng quản lý 100 Page + <strong>Luân phiên đều</strong> + giới hạn <strong>0</strong>: 10 token nhận 4 Page, 20 token nhận 3 Page. Mỗi Page dùng một token được phân công. Quyền Page khác nhau có thể khiến kết quả không đều.</p>
    <p>Giới hạn 3 Page/token chỉ chứa được 90 Page; 10 Page còn lại sẽ hiện chưa phân công. Chọn 0 để tự chia hoặc 4 để đủ chỗ.</p>
    <p>Auto Post lấy nội dung hoàn chỉnh trong kho, luân phiên Page theo khung giờ; giới hạn video/ngày tính cho cả nhóm. App phải đang chạy và kho còn nội dung. Page lỗi được bỏ qua; xử lý trong Page &amp; avatar rồi đưa về nhóm đăng.</p>
  </details>;
}

export function PoolAssignment({ group, tokens, pages }) {
  return <section className="group-preview" aria-label="Kết quả phân công">
    <strong>{group.assignedPageCount} / {group.pageIds.length} Page đã phân công · {group.tokenIds.length} token</strong>
    {group.assignmentBlockedCount > 0 && <p className="group-warning">{group.assignmentBlockedCount} Page chưa thể phân công. Xem lý do bên dưới.</p>}
    <div className="group-preview-table"><table><thead><tr><th>Token</th><th>Số Page</th><th>Page phụ trách</th></tr></thead><tbody>{group.tokenIds.map(id => <tr key={id}><td>{tokens.find(t => t.id === id)?.name || id}</td><td>{group.assignmentLoads[id] || 0}</td><td>{Object.entries(group.pageAssignments || {}).filter(([, tokenId]) => tokenId === id).map(([pageId]) => pages.find(p => p.id === pageId)?.name || pageId).join(', ') || '—'}</td></tr>)}</tbody></table></div>
    {!!group.assignmentBlocked?.length && <ul>{group.assignmentBlocked.map(item => <li key={item.pageId}>{pages.find(p => p.id === item.pageId)?.name || item.pageId}: {blockedLabels[item.code] || item.code}</li>)}</ul>}
  </section>;
}

export function GroupDialog({ kind, group, initialIds, meta, onClose, onSaved }) {
  const isPool = kind === 'token', config = group?.scheduleConfig || {};
  const review = group?.purpose === 'review' || group?.id.startsWith('pgrp_hold_');
  const [name, setName] = useState(group?.name || '');
  const [selected, setSelected] = useState(initialIds || (isPool ? group?.tokenIds : group?.pageIds) || []);
  const [managedPages, setManagedPages] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [strategy, setStrategy] = useState(group?.strategy || 'round_robin'), [maxPages, setMaxPages] = useState(group?.maxPagesPerToken ?? 0);
  const [scope, setScope] = useState(group?.pageScope || 'all'), [sourceGroup, setSourceGroup] = useState(group?.pageGroupId || ''), [scopePages, setScopePages] = useState(group?.selectedPageIds || []);
  const [times, setTimes] = useState((config.times || []).join(', ')), [timezone, setTimezone] = useState(config.timezone || 'Asia/Bangkok');
  const [stagger, setStagger] = useState(config.staggerMinutes ?? 15), [sameToken, setSameToken] = useState(config.sameTokenMinutes ?? 10), [crossToken, setCrossToken] = useState(config.crossTokenMinutes ?? 1), [samePage, setSamePage] = useState(config.samePageMinutes ?? 60);
  const [dailyLimit, setDailyLimit] = useState(config.dailyLimit ?? 0), [poolId, setPoolId] = useState(config.tokenGroupId || ''), [enabled, setEnabled] = useState(!review && config.enabled === true && config.autoPublish !== false);
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  const poolInput = { ...(group?.id ? { id: group.id } : {}), name: name.trim() || 'Xem trước pool', tokenIds: selected, strategy, maxPagesPerToken: Number(maxPages), pageScope: scope, pageGroupId: sourceGroup, selectedPageIds: scopePages, autoAssign: true };
  const signature = JSON.stringify(poolInput);
  useEffect(() => { let cancelled = false; api('/management/pages').then(result => { if (!cancelled) setManagedPages(result.rows.filter(page => page.externalId && page.lifecycle !== 'deleted')); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);
  useEffect(() => setPreview(null), [signature]);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: 'nearest' }); }, [preview]);
  const run = async operation => { if (busy) return; setBusy('saving'); setError(''); try { await operation(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const save = event => {
    event.preventDefault();
    run(async () => {
      if (isPool) {
        if (!selected.length) throw new Error('Chọn ít nhất một token cho pool.');
        const result = await api('/meta/token-groups', { ...poolInput, name }, 'POST');
        await onSaved(result);
      } else {
        const slots = times.split(/[,\n]+/).map(time => time.trim()).filter(Boolean);
        if (slots.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Khung giờ cần đúng HH:mm, ví dụ 09:00, 15:00, 20:00.');
        if (enabled && !slots.length) throw new Error('Đặt ít nhất một khung giờ trước khi bật Auto Post.');
        try { new Intl.DateTimeFormat('vi', { timeZone: timezone }).format(); } catch { throw new Error('Múi giờ không hợp lệ. Ví dụ Asia/Bangkok.'); }
        const result = await api('/meta/page-groups', { ...(group?.id ? { id: group.id } : {}), name, pageIds: selected, scheduleConfig: { times: slots, timezone, staggerMinutes: Number(stagger), sameTokenMinutes: Number(sameToken), crossTokenMinutes: Number(crossToken), samePageMinutes: Number(samePage), dailyLimit: Number(dailyLimit), tokenGroupId: poolId, enabled, autoPublish: enabled } }, 'POST');
        await onSaved(result);
      }
    });
  };
  const pool = meta.tokenGroups.find(pool => pool.id === poolId);
  const ready = managedPages.filter(page => selected.includes(page.id) && pageCanJoin(page));
  return <Modal wide title={isPool ? group ? 'Sửa pool token' : 'Tạo pool token' : group ? 'Sửa nhóm Page & lịch đăng' : 'Tạo nhóm Page'} onClose={busy ? () => {} : onClose}>
    <form className="group-dialog" onSubmit={save}><fieldset disabled={Boolean(busy)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Tên nhóm"><input required autoFocus maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={isPool ? 'Ví dụ: 30 token tin tức' : 'Ví dụ: Page tin tức'} /></Field>
      <PoolGuide />
      {isPool ? <>
        <div className="form-grid"><Field label="Cách chia Page"><select value={strategy} onChange={e => setStrategy(e.target.value)}><option value="round_robin">Luân phiên đều</option><option value="least_recently_used">Cân bằng, ưu tiên token ít dùng</option><option value="random">Ngẫu nhiên</option></select></Field><Field label="Giới hạn Page / token" hint="0 = tự cân bằng, không giới hạn cứng"><input type="number" min="0" max="50" required value={maxPages} onChange={e => setMaxPages(e.target.value)} /></Field><Field label="Phạm vi Page của pool"><select value={scope} onChange={e => setScope(e.target.value)}><option value="all">Tất cả Page thuộc các token đã chọn</option><option value="group">Theo một nhóm Page</option><option value="selected">Chọn danh sách Page riêng</option></select></Field>{scope === 'group' && <Field label="Nhóm Page của pool"><select required value={sourceGroup} onChange={e => setSourceGroup(e.target.value)}><option value="">Chọn nhóm Page</option>{meta.pageGroups.filter(g => g.purpose !== 'review').map(g => <option key={g.id} value={g.id}>{g.name} · {g.pageIds.length} Page</option>)}</select></Field>}</div>
        <GroupMemberPicker kind="token" items={meta.tokens} selected={selected} onChange={setSelected} />
        {scope === 'selected' && <GroupMemberPicker label="Chọn Page cho pool" items={managedPages} selected={scopePages} onChange={setScopePages} groups={meta.pageGroups} />}
        <Button type="button" disabled={!selected.length || scope === 'group' && !sourceGroup} onClick={() => run(async () => setPreview((await api('/meta/token-groups/preview', poolInput, 'POST')).group))}>Xem trước phân công</Button>
        {preview && <div ref={previewRef}><PoolAssignment group={preview} tokens={meta.tokens} pages={managedPages} /></div>}
      </> : <>
        <GroupMemberPicker items={managedPages} selected={selected} onChange={setSelected} groups={meta.pageGroups} allowIssues={review} />
        <div className="form-grid"><Field label="Khung giờ đăng" hint="HH:mm, cách nhau bằng dấu phẩy"><input value={times} onChange={e => setTimes(e.target.value)} placeholder="09:00, 15:00, 20:00" /></Field><Field label="Múi giờ"><input required value={timezone} onChange={e => setTimezone(e.target.value)} /></Field><Field label="Pool token tự động"><select value={poolId} onChange={e => setPoolId(e.target.value)}><option value="">Tự chọn token hợp lệ của Page</option>{meta.tokenGroups.map(pool => <option key={pool.id} value={pool.id}>{pool.name} · {pool.tokenIds.length} token</option>)}</select></Field><Field label="Giới hạn video/ngày cho cả nhóm" hint="0 = số khung giờ; mỗi khung giờ lấy một bài, luân phiên Page"><input type="number" required min="0" max="200" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} /></Field></div>
        <div className="form-grid"><Field label="Giữa hai lượt đăng trong nhóm (phút)"><input type="number" min="0" max="1440" required value={stagger} onChange={e => setStagger(e.target.value)} /></Field><Field label="Cùng token: cách tối thiểu (phút)"><input type="number" min="0" max="1440" required value={sameToken} onChange={e => setSameToken(e.target.value)} /></Field><Field label="Giữa các token trong pool (phút)"><input type="number" min="0" max="1440" required value={crossToken} onChange={e => setCrossToken(e.target.value)} /></Field><Field label="Cùng Page: cách tối thiểu (phút)"><input type="number" min="0" max="10080" required value={samePage} onChange={e => setSamePage(e.target.value)} /></Field></div>
        <p className="group-picker-help">0 = tắt khoảng cách tương ứng. Lượt đăng chờ đủ tất cả khoảng cách; vẫn giữ khi khởi động lại app. Token và Page dùng chung giữa các nhóm cũng phải chờ.</p>
        <label className="group-auto-toggle"><input type="checkbox" checked={enabled} disabled={review} onChange={e => setEnabled(e.target.checked)} /> Bật Auto Post khi có nội dung sẵn sàng trong kho</label>
        <p className="group-picker-help">{ready.length} Page sẵn sàng / {selected.length} đã chọn. Page cần xử lý sẽ được bỏ qua; gỡ khỏi nhóm không xóa Page. Bài chưa đăng của Page bị gỡ sẽ được giữ trong kho.</p>
        {pool && ready.some(page => !pool.pageAssignments?.[page.id]) && <p className="mg-error">Một số Page chưa được phân công trong pool này. Nếu pool theo nhóm hiện tại, phân công sẽ cập nhật khi lưu; các phạm vi khác cần sửa pool hoặc bấm Tự chia Page.</p>}
      </>}
      {loading && <p role="status">Đang tải tình trạng Page…</p>}{error && <p className="mg-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" onClick={onClose}>Hủy</Button><Button variant="primary" busy={Boolean(busy)} disabled={loading}>{group ? 'Lưu thay đổi' : isPool ? 'Tạo pool' : 'Tạo nhóm'}</Button></div>
    </fieldset></form>
  </Modal>;
}
