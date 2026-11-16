import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Button, Field, Modal } from '../components.jsx';
import { GroupMemberPicker, pageCanJoin } from './GroupMemberPicker.jsx';

const blockedLabels = { missing_mapping: 'Chưa có token được xác minh cho Page', token_capacity: 'Đã đầy giới hạn Page / token', page_unavailable: 'Page cần xử lý hoặc đang tạm ngưng' };

export function PoolGuide() {
  return <details className="group-guide"><summary>Cách dùng pool token và nhóm Page</summary>
    <p><strong>Pool token</strong> phân công token phụ trách Page. <strong>Nhóm Page</strong> chọn các Page nhận nội dung và giờ đăng.</p>
    <ol><li>Trong tab Token, thêm và đồng bộ các token có quyền quản lý Page.</li><li>Bấm <strong>Tạo nhóm Page từ token</strong>, chọn danh sách theo tên kết nối hoặc tick các token cần dùng. Sau khi nhập danh sách mới, có thể bấm <strong>Tạo nhóm Page từ danh sách vừa nhập</strong>.</li><li>Kiểm tra các Page được chọn, đặt tên nhóm rồi lưu. Studio tạo pool và liên kết nhóm trong cùng thao tác; Auto Post mặc định tắt.</li><li>Khi muốn đăng tự động, mở <strong>Sửa nhóm & lịch</strong>, đặt giờ và khoảng cách, rồi bật Auto Post. Nếu đã có pool, dùng <strong>Tạo nhóm Page từ pool</strong>.</li></ol>
    <p>30 token cùng quản lý 100 Page + <strong>Luân phiên đều</strong> + giới hạn <strong>0</strong>: 10 token nhận 4 Page, 20 token nhận 3 Page. Mỗi Page dùng một token được phân công. Quyền Page khác nhau có thể khiến kết quả không đều.</p>
    <p>Giới hạn 3 Page/token chỉ chứa được 90 Page; 10 Page còn lại sẽ hiện chưa phân công. Chọn 0 để tự chia hoặc 4 để đủ chỗ.</p>
    <p>Chế độ mỗi Page một bài/ngày tự lấy Content hoàn chỉnh, chia đủ cho các Page sẵn sàng và giữ khoảng cách đăng. Kho thiếu sẽ tự bổ sung khi có Content mới; ngày tiếp theo bắt đầu lượt mới. Page thuộc nhiều nhóm vẫn chỉ nhận một bài/ngày. App phải đang chạy. Page lỗi được bỏ qua; xử lý trong Page &amp; avatar rồi đưa về nhóm đăng.</p>
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

export function GroupDialog({ kind, group, initialIds, meta, setup, onBack, onClose, onSaved }) {
  const isPool = kind === 'token', config = group?.scheduleConfig || {};
  const review = group?.purpose === 'review' || group?.id.startsWith('pgrp_hold_');
  const [name, setName] = useState(group?.name || setup?.name || '');
  const [selected, setSelected] = useState(initialIds || (isPool ? group?.tokenIds : group?.pageIds) || []);
  const [managedPages, setManagedPages] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [strategy, setStrategy] = useState(group?.strategy || 'round_robin'), [maxPages, setMaxPages] = useState(group?.maxPagesPerToken ?? 0);
  const [scope, setScope] = useState(group?.pageScope || 'all'), [sourceGroup, setSourceGroup] = useState(group?.pageGroupId || ''), [scopePages, setScopePages] = useState(group?.selectedPageIds || []);
  const [times, setTimes] = useState((config.times || []).join(', ')), [timezone, setTimezone] = useState(config.timezone || 'Asia/Ho_Chi_Minh');
  const [stagger, setStagger] = useState(config.staggerMinutes ?? 15), [sameToken, setSameToken] = useState(config.sameTokenMinutes ?? 10), [crossToken, setCrossToken] = useState(config.crossTokenMinutes ?? 1), [samePage, setSamePage] = useState(config.samePageMinutes ?? 60);
  const [dailyLimit, setDailyLimit] = useState(config.dailyLimit ?? 0), [poolId, setPoolId] = useState(config.tokenGroupId || ''), [enabled, setEnabled] = useState(!review && config.enabled === true && config.autoPublish !== false);
  const [perPageDaily, setPerPageDaily] = useState(group ? config.perPageDaily === true : true);
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
        if (setup && !selected.length) throw new Error('Chọn ít nhất một Page sẵn sàng để tạo nhóm.');
        const result = await api(setup ? '/meta/group-setup' : '/meta/page-groups', { ...(group?.id ? { id: group.id } : {}), ...(setup ? { ...setup.source, requestId: setup.requestId } : {}), name, pageIds: selected, scheduleConfig: { times: perPageDaily ? slots.slice().sort().slice(0, 1) : slots, timezone, staggerMinutes: Number(stagger), sameTokenMinutes: Number(sameToken), crossTokenMinutes: Number(crossToken), samePageMinutes: Number(samePage), dailyLimit: Number(dailyLimit), perPageDaily, tokenGroupId: poolId, enabled, autoPublish: enabled } }, 'POST');
        await onSaved(result);
      }
    });
  };
  const pool = meta.tokenGroups.find(pool => pool.id === poolId);
  const ready = managedPages.filter(page => selected.includes(page.id) && pageCanJoin(page));
  const sourceIds = new Set(setup?.preview.readyPageIds || []);
  const pickerPages = setup ? managedPages.filter(page => sourceIds.has(page.id)) : managedPages;
  return <Modal wide title={isPool ? group ? 'Sửa pool token' : 'Tạo pool token' : group ? 'Sửa nhóm Page & lịch đăng' : 'Tạo nhóm Page'} onClose={busy ? () => {} : onClose}>
    <form className="group-dialog" onSubmit={save}><fieldset disabled={Boolean(busy)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Tên nhóm"><input required autoFocus maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={isPool ? 'Ví dụ: 30 token tin tức' : 'Ví dụ: Page tin tức'} /></Field>
      {setup ? <section className="group-setup-summary" aria-label="Nguồn Page của nhóm">
        <strong>{setup.preview.pool.tokenIds.length} token · {setup.preview.pages.length} Page riêng biệt · {setup.preview.readyPageIds.length} Page có thể chọn</strong>
        <p>{setup.source.poolId ? `Dùng pool: ${setup.preview.pool.name}.` : 'Pool cùng tên được tạo và chia đều Page khi lưu nhóm.'} Mỗi Page chỉ xuất hiện một lần dù nhiều token cùng quản lý.</p>
        {!!setup.preview.blocked.length && <details><summary>{setup.preview.blocked.length} Page chưa sẵn sàng, không đưa vào nhóm</summary><ul>{setup.preview.blocked.map(page => <li key={page.id}>{page.name}: {page.reason}</li>)}</ul></details>}
        {!setup.preview.readyPageIds.length && <p className="mg-error">Chưa có Page sẵn sàng trong nguồn này. Quay lại chọn token khác hoặc kiểm tra Page trong Page & avatar.</p>}
      </section> : <PoolGuide />}
      {isPool ? <>
        <div className="form-grid"><Field label="Cách chia Page"><select value={strategy} onChange={e => setStrategy(e.target.value)}><option value="round_robin">Luân phiên đều</option><option value="least_recently_used">Cân bằng, ưu tiên token ít dùng</option><option value="random">Ngẫu nhiên</option></select></Field><Field label="Giới hạn Page / token" hint="0 = tự cân bằng, không giới hạn cứng"><input type="number" min="0" max="50" required value={maxPages} onChange={e => setMaxPages(e.target.value)} /></Field><Field label="Phạm vi Page của pool"><select value={scope} onChange={e => setScope(e.target.value)}><option value="all">Tất cả Page thuộc các token đã chọn</option><option value="group">Theo một nhóm Page</option><option value="selected">Chọn danh sách Page riêng</option></select></Field>{scope === 'group' && <Field label="Nhóm Page của pool"><select required value={sourceGroup} onChange={e => setSourceGroup(e.target.value)}><option value="">Chọn nhóm Page</option>{meta.pageGroups.filter(g => g.purpose !== 'review').map(g => <option key={g.id} value={g.id}>{g.name} · {g.pageIds.length} Page</option>)}</select></Field>}</div>
        <GroupMemberPicker kind="token" items={meta.tokens} selected={selected} onChange={setSelected} />
        {scope === 'selected' && <GroupMemberPicker label="Chọn Page cho pool" items={managedPages} selected={scopePages} onChange={setScopePages} groups={meta.pageGroups} />}
        <Button type="button" disabled={!selected.length || scope === 'group' && !sourceGroup} onClick={() => run(async () => setPreview((await api('/meta/token-groups/preview', poolInput, 'POST')).group))}>Xem trước phân công</Button>
        {preview && <div ref={previewRef}><PoolAssignment group={preview} tokens={meta.tokens} pages={managedPages} /></div>}
      </> : <>
        <GroupMemberPicker items={pickerPages} selected={selected} onChange={setSelected} groups={meta.pageGroups} allowIssues={review} />
        <Field label="Cách chia Content mỗi ngày"><select value={perPageDaily ? 'page' : 'group'} onChange={e => setPerPageDaily(e.target.value === 'page')}><option value="page">Mỗi Page 1 bài/ngày</option><option value="group">Giới hạn tổng bài cho nhóm</option></select></Field>
        <div className="form-grid"><Field label={perPageDaily ? 'Giờ bắt đầu mỗi ngày' : 'Khung giờ đăng'} hint={perPageDaily ? 'Lần lượt đăng cho các Page từ giờ này, theo khoảng cách bên dưới.' : 'HH:mm, cách nhau bằng dấu phẩy'}><input type={perPageDaily ? 'time' : 'text'} value={perPageDaily ? times.split(/[,\n]+/).map(t => t.trim()).filter(Boolean).sort()[0] || '' : times} onChange={e => setTimes(e.target.value)} placeholder="09:00, 15:00, 20:00" /></Field><Field label="Múi giờ"><input required value={timezone} onChange={e => setTimezone(e.target.value)} /></Field><Field label="Pool token tự động"><select disabled={Boolean(setup)} value={setup ? "__setup" : poolId} onChange={e => setPoolId(e.target.value)}>{setup && <option value="__setup">{setup.source.poolId ? setup.preview.pool.name : `${name || "Nhóm mới"} · tạo pool khi lưu`} · {setup.preview.pool.tokenIds.length} token</option>}<option value="">Tự chọn token hợp lệ của Page</option>{meta.tokenGroups.map(pool => <option key={pool.id} value={pool.id}>{pool.name} · {pool.tokenIds.length} token</option>)}</select></Field>{!perPageDaily && <Field label="Giới hạn video/ngày cho cả nhóm" hint="0 = số khung giờ; mỗi khung giờ lấy một bài, luân phiên Page"><input type="number" required min="0" max="200" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} /></Field>}</div>
        {perPageDaily && <p className="group-picker-help">Mỗi Page sẵn sàng nhận tối đa 1 bài trong ngày. Kho thiếu sẽ tự bổ sung trong ngày khi có Content hoàn chỉnh. Page đã đăng hoặc đã có lịch hôm nay được bỏ qua; ngày mai tự bắt đầu lượt mới. Kho không bị giữ trước cho ngày mai. Nếu khoảng cách đăng không còn đủ thời gian trong ngày, nhóm sẽ báo số Page đang chờ.</p>}
        <div className="form-grid"><Field label="Giữa hai lượt đăng trong nhóm (phút)"><input type="number" min="0" max="1440" required value={stagger} onChange={e => setStagger(e.target.value)} /></Field><Field label="Cùng token: cách tối thiểu (phút)"><input type="number" min="0" max="1440" required value={sameToken} onChange={e => setSameToken(e.target.value)} /></Field><Field label="Giữa các token trong pool (phút)"><input type="number" min="0" max="1440" required value={crossToken} onChange={e => setCrossToken(e.target.value)} /></Field><Field label="Cùng Page: cách tối thiểu (phút)"><input type="number" min="0" max="10080" required value={samePage} onChange={e => setSamePage(e.target.value)} /></Field></div>
        <p className="group-picker-help">0 = tắt khoảng cách tương ứng. Lượt đăng chờ đủ tất cả khoảng cách; vẫn giữ khi khởi động lại app. Token và Page dùng chung giữa các nhóm cũng phải chờ.</p>
        <label className="group-auto-toggle"><input type="checkbox" checked={enabled} disabled={review} onChange={e => setEnabled(e.target.checked)} /> Bật Auto Post khi có nội dung sẵn sàng trong kho</label>
        <p className="group-picker-help">{ready.length} Page sẵn sàng / {selected.length} đã chọn. Page cần xử lý sẽ được bỏ qua; gỡ khỏi nhóm không xóa Page. Bài chưa đăng của Page bị gỡ sẽ được giữ trong kho.</p>
        {pool && ready.some(page => !pool.pageAssignments?.[page.id]) && <p className="mg-error">Một số Page chưa được phân công trong pool này. Nếu pool theo nhóm hiện tại, phân công sẽ cập nhật khi lưu; các phạm vi khác cần sửa pool hoặc bấm Tự chia Page.</p>}
      </>}
      {loading && <p role="status">Đang tải tình trạng Page…</p>}{error && <p className="mg-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" onClick={onClose}>Hủy</Button>{onBack && <Button type="button" onClick={onBack}>Quay lại chọn token</Button>}<Button variant="primary" busy={Boolean(busy)} disabled={loading || Boolean(setup && !selected.length)}>{group ? 'Lưu thay đổi' : isPool ? 'Tạo pool' : 'Tạo nhóm'}</Button></div>
    </fieldset></form>
  </Modal>;
}
