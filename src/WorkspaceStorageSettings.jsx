import { useEffect, useState } from 'react';
import { api, bytes } from './api.js';
import { Button, Notice } from './components.jsx';

export function WorkspaceStorageSettings({settings,save,run,notify}) {
  const [volume,setVolume]=useState(null),[history,setHistory]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){
    try{const [v,h]=await Promise.all([api('/storage/volume'),api('/storage/history')]);setVolume(v);setHistory(h);setError('');}
    catch(error){setError(error.message);}
  }
  useEffect(()=>{refresh();},[]);
  return <section className="panel workspace-storage-settings"><h3>Ổ dữ liệu & tin đã dùng</h3>
    {volume&&<><p>Thư mục đang dùng: <strong style={{overflowWrap:'anywhere'}}>{volume.dataDir}</strong></p><p>Còn trống <strong>{bytes(volume.freeBytes)}</strong> / {bytes(volume.totalBytes)} trên ổ chứa dữ liệu.</p>{(volume.freeBytes<50*1024**3||volume.freeBytes/volume.totalBytes<.2)&&<Notice error>Ổ dữ liệu sắp đầy. Kiểm tra hàng chờ video và các bản backup trước khi gửi lô render lớn.</Notice>}</>}
    <p className="muted small">Profile, video, ảnh, render tạm và kho tin nằm trong thư mục dữ liệu này. Với máy mới dùng ổ riêng, đặt bản Portable trong một thư mục trên ổ đó; dữ liệu nằm trong “Viral Data” bên cạnh EXE.</p>
    <label className="toggle-field"><input type="checkbox" checked={settings.historyArchiveEnabled!==false} onChange={event=>save({historyArchiveEnabled:event.target.checked})}/><span><strong>Tự lưu trữ tin đã đăng sau 30 ngày</strong><small>Nén nội dung, giữ nguồn và lịch sử chống trùng. Bỏ qua tin còn video, bản nháp hoặc tác vụ cần xử lý; khôi phục đầy đủ từ Research → Đã lưu trữ.</small></span></label>
    {history&&<p>{history.archivedCount} tin đã lưu trữ · {history.eligibleCount} tin đủ điều kiện hiện tại.</p>}
    <Button busy={busy} disabled={!history?.eligibleCount} onClick={async()=>{setBusy(true);try{const result=await run(()=>api('/storage/history/archive',{}));if(result)notify(`Đã lưu trữ ${result.archivedCountThisRun} tin; giảm ${bytes(result.activeMetadataBytesSaved)} dữ liệu đang tải.`);await refresh();}finally{setBusy(false);}}}>Lưu trữ tin đủ điều kiện</Button>
    {error&&<Notice error>{error}</Notice>}
  </section>;
}
