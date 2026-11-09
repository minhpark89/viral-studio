import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components.jsx';
const size = n => `${((n || 0)/1048576).toLocaleString('vi-VN',{maximumFractionDigits:1})} MB`;
export function ResearchStorage({projectId, notify}) {
  const [stats,setStats]=useState(null), [busy,setBusy]=useState(false);
  const refresh=()=>api(`/product-research/storage?projectId=${projectId}`).then(setStats).catch(e=>notify(e.message,'error'));
  useEffect(()=>{refresh();},[projectId]);
  const clear=async()=>{setBusy(true);try{
    const result=await api('/product-research/cache/clear',{projectId});setStats(result);
    notify(`Đã dọn cache; lịch sử, mẫu đã lưu và video render vẫn giữ nguyên. Còn ${size(result.previewBytes)} preview đang được dùng.`);
  }catch(e){notify(e.message,'error');}finally{setBusy(false);}};
  return <details className="panel pr-storage"><summary>Lưu trữ Research · tự lưu trên máy {stats ? `· ${size(stats.databaseBytes+stats.previewBytes)}` : ''}</summary>
    <p>Kết quả và mẫu đã chọn được lưu theo dự án, mở lại app vẫn còn. Danh sách hiện 40 lần quét gần nhất; dữ liệu cũ vẫn nằm trong cơ sở dữ liệu.</p>
    <p>Ảnh tải khi hiện trên màn hình; video chỉ tải khi bấm xem. Cache preview tối đa khoảng 512 MB, tự thay các file cũ khi đầy. Research không chạy render khi bạn chỉ xem kết quả.</p>
    {stats && <><p>{stats.scans} lần quét của dự án · Database toàn workspace: {size(stats.databaseBytes)} · Preview: {size(stats.previewBytes)}</p><code className="product-output-path">{stats.directory}</code></>}
    <div className="pr-actions"><Button onClick={refresh}>Cập nhật dung lượng</Button><Button busy={busy} onClick={clear}>Dọn cache Research</Button></div>
    <p className="small muted">Dọn ảnh/video xem trước và phản hồi API tạm của workspace này. Lần xem hoặc quét tiếp theo sẽ tải lại, có thể dùng lượt API. Không xóa lịch sử, API key, số lượt đã dùng hay MP4 đã render.</p>
  </details>;
}
