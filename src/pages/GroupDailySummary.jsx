export function groupScheduleLabel(group) {
  const c = group.scheduleConfig || {};
  if (c.perPageDaily) return `Mỗi Page 1 bài/ngày · ${c.times?.length ? `Bắt đầu ${[...c.times].sort()[0]}` : 'Chưa đặt giờ bắt đầu'}${c.enabled && c.autoPublish !== false ? '' : ' · Tự động đang tắt'}`;
  return `${c.times?.length ? `Mỗi ngày: ${c.times.join(', ')}` : 'Chưa đặt khung giờ'} · ${c.enabled ? `Tự động ${c.dailyLimit || c.times?.length || 1} video/ngày` : 'Tự động đang tắt'}`;
}

export function GroupDailySummary({ group }) {
  if (!group.scheduleConfig?.perPageDaily) return null;
  const summary = group.dailyAutomation, enabled = group.scheduleConfig.enabled && group.scheduleConfig.autoPublish !== false;
  return <div className="group-daily-summary" aria-label={`Tiến độ đăng hôm nay của ${group.name}`}>
    {summary && enabled ? <>
      <strong>{summary.day} · {summary.target} Page nhận bài</strong>
      <span>{summary.published} đã đăng · {summary.scheduled} đã xếp lịch · {summary.waitingContent} chờ Content</span>
      {summary.waitingTime > 0 && <span className="group-warning">{summary.waitingTime} Page chưa đủ thời gian đăng trong ngày theo khoảng cách hiện tại.</span>}
      {summary.unavailable > 0 && <span className="group-warning">{summary.unavailable} Page cần xử lý kết nối hoặc trạng thái.</span>}
      {summary.shared > 0 && <span>{summary.shared} Page được nhóm khác phụ trách; mỗi Page vẫn chỉ nhận một bài/ngày.</span>}
    </> : <span>{enabled ? 'Đang kiểm tra kho để chia bài cho các Page…' : 'Khi bật Auto Post, kho sẽ tự cấp một bài cho mỗi Page sẵn sàng mỗi ngày.'}</span>}
    {group.dailyScheduleError && <span className="mg-error" role="alert">Không xếp được lịch: {group.dailyScheduleError}</span>}
  </div>;
}
