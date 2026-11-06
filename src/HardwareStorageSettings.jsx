import { useEffect, useState } from 'react';
import { Cpu, HardDrive, RefreshCw, ExternalLink, Trash2 } from 'lucide-react';
import { api, bytes } from './api.js';
import { Button, Field, Notice } from './components.jsx';
import { WorkspaceStorageSettings } from './WorkspaceStorageSettings.jsx';

export function GpuStatus({ mode, onOpen }) {
  const [hardware, setHardware] = useState(null);
  useEffect(() => {
    let live = true;
    const check = () => api('/system/render-hardware').then(value => { if (live) setHardware(value); }).catch(() => { if (live) setHardware({ gpuAvailable: false }); });
    if (mode !== 'cpu') check();
    window.addEventListener('focus', check);
    return () => { live = false; window.removeEventListener('focus', check); };
  }, [mode]);
  const text = mode === 'cpu' ? 'Xuất bằng CPU' : !hardware ? 'Đang kiểm tra GPU…' : hardware.gpuAvailable ? `GPU · ${hardware.selected.vendor.toUpperCase()}` : 'Cần thiết lập GPU';
  return <button className={`app-version-pill ${mode !== 'cpu' && hardware && !hardware.gpuAvailable ? 'danger-text' : ''}`} onClick={onOpen} title="Xem GPU, driver phù hợp và dung lượng profile">{text}</button>;
}

export function HardwareStorageSettings({ settings, setSettings, run, notify }) {
  const [hardware, setHardware] = useState(null), [storage, setStorage] = useState(null);
  const [hardwareBusy, setHardwareBusy] = useState(false), [storageBusy, setStorageBusy] = useState(false);
  const [driverBusy, setDriverBusy] = useState(false), [driver, setDriver] = useState(null), [error, setError] = useState('');
  async function loadHardware(refresh = false) {
    setHardwareBusy(true);
    try { setHardware(await api('/system/render-hardware' + (refresh ? '?refresh=true' : ''))); setError(''); }
    catch (error) { setError(error.message); }
    finally { setHardwareBusy(false); }
  }
  async function loadStorage(refresh=false) {
    setStorageBusy(true);
    try { setStorage(await api('/profiles/storage'+(refresh?'?refresh=true':''))); }
    catch (error) { setError(error.message); }
    finally { setStorageBusy(false); }
  }
  useEffect(() => { loadHardware(); loadStorage(); }, []);
  async function save(patch) {
    const result = await run(() => api('/settings', patch, 'PATCH'));
    if (result) { setSettings(current => ({ ...current, ...patch })); notify('Đã lưu cấu hình.'); }
  }
  return <>
    <WorkspaceStorageSettings settings={settings} save={save} run={run} notify={notify}/>
    <section className="panel hardware-settings">
      <div className="panel-heading"><h3><Cpu size={18} /> GPU & bộ mã hóa</h3><Button onClick={() => loadHardware(true)} busy={hardwareBusy}><RefreshCw size={14} /> Kiểm tra GPU</Button></div>
      <Field label="Thiết bị xuất video" hint="Áp dụng cho News và timeline. GPU được thử tạo và giải mã file thật trước khi sử dụng.">
        <select aria-label="Thiết bị xuất video" value={settings.renderAcceleration || 'gpu'} onChange={event => save({ renderAcceleration: event.target.value })}>
          <option value="gpu">Tự chọn GPU · yêu cầu GPU hoạt động</option><option value="cpu">CPU · chế độ tương thích</option>
        </select>
      </Field>
      {hardware ? <>
        <Notice error={!hardware.gpuAvailable && settings.renderAcceleration !== 'cpu'}>{hardware.message}</Notice>
        {hardware.adapters.map((item, index) => <p key={index}><strong>{item.name}</strong><br /><span className="muted small">Driver: {item.driver}</span></p>)}
        {hardware.candidates.map(item => <div className="tool-row" key={item.encoder}>
          <span className={item.available ? 'green-text' : 'danger-text'}>{item.encoder}: {item.available ? 'Đã kiểm tra hoạt động' : 'Chưa hoạt động'}</span>
          {item.recommendation && <div><p className="small">{item.recommendation.message}</p><a href={item.recommendation.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Driver {item.recommendation.vendor} chính thức</a></div>}
        </div>)}
        {hardware.adapters.some(item => item.vendor === 'nvidia') && <Button busy={driverBusy} onClick={async () => { setDriverBusy(true); const result = await run(() => api('/system/nvidia-driver')); if (result) setDriver(result.recommendation); setDriverBusy(false); }}>Tìm bản NVIDIA phù hợp</Button>}
        {driver && <Notice><strong>{driver.version ? `${driver.name} ${driver.version} · WHQL` : driver.gpu}</strong><p>{driver.message}</p><a href={driver.url} target="_blank" rel="noreferrer noopener">Xem bản driver dành cho card này <ExternalLink size={13} /></a></Notice>}
        <p className="muted small">{hardware.cpuNote} Khi bật chế độ GPU mà GPU lỗi, app báo lỗi và giữ MC/ảnh để thử lại; không tự chuyển sang CPU hoặc tạo MC mới.</p>
      </> : <p className="muted">Đang kiểm tra phần cứng…</p>}
      {error && <Notice error>{error}</Notice>}
    </section>
    <section className="panel profile-storage-settings">
      <div className="panel-heading"><h3><HardDrive size={18} /> Dung lượng profile</h3><Button onClick={()=>loadStorage(true)} busy={storageBusy}><RefreshCw size={14} /> Đo dung lượng</Button></div>
      <label className="toggle-field"><input type="checkbox" checked={settings.profileStorageOptimization !== false} onChange={event => save({ profileStorageOptimization: event.target.checked })} /><span><strong>Tối ưu dung lượng profile</strong><small>Giữ cache trang vừa đủ, hạn chế mô hình AI Chrome tải nền. Có hiệu lực từ lần mở profile tiếp theo.</small></span></label>
      {storage && <>
        <p><strong>{storage.profileCount} profile · {bytes(storage.totalBytes)}</strong></p>
        <p className="muted">Cache có thể tái tạo: {bytes(storage.cacheBytes)} · Đang mở/bận hoặc chưa xác minh: {storage.activeCount}</p>
        {!storage.processCheckAvailable && <Notice error>Không xác minh được các trình duyệt đang chạy. App sẽ bỏ qua dọn cache để bảo vệ profile.</Notice>}
        <Button busy={storageBusy} disabled={!storage.processCheckAvailable || storage.cacheBytes === 0} onClick={async () => {
          setStorageBusy(true);
          const result = await run(() => api('/profiles/storage/clean', { mode: 'clear' }));
          if (result) notify(`Đã dọn ${bytes(result.freedBytes)} cache. Bỏ qua ${result.skipped} profile đang bận/chưa xác minh.`);
          await loadStorage();
        }}><Trash2 size={14} /> Dọn cache profile đang đóng</Button>
        {storage.lastCleanup && <p className="small">Lần gần nhất: {bytes(storage.lastCleanup.freedBytes)} · {new Date(storage.lastCleanup.finishedAt).toLocaleString('vi-VN')}</p>}
      </>}
      <p className="muted small">Giữ cookie, mật khẩu, local storage, IndexedDB và phiên đăng nhập. Không dọn profile đang mở/chạy tác vụ; không đụng cache của website trong Service Worker. Lần tải đầu sau dọn có thể lâu hơn; cache trang nhỏ được giữ ở các lần mở tiếp theo.</p>
    </section>
  </>;
}
