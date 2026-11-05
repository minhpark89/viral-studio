import { Button } from './components.jsx';
import { NewsVideoOptions } from './NewsVideoOptions.jsx';
import { NewsMcPicker } from './NewsMcPicker.jsx';

export function ResearchRenderSettings({ data, project, options, onOptions, count, avatar, onAvatar, rotation, onRotation, performance, onPerformance, onSavePerformance, savingPerformance, busy, renderBlocked, notify, fallbackCount, renderCount, llmProgress, onLlm }) {
  return <details className="research-render-settings">
    <summary>Tùy chọn ảnh, font, MC &amp; tốc độ <span>{options.newsDuration === 'auto' ? '15–30s' : `khoảng ${options.newsDuration}s`} · {options.newsImageCount === 'auto' ? 'thường 8 ảnh' : `tối đa ${options.newsImageCount} ảnh`} · {rotation.length ? `${rotation.length} MC xoay vòng` : avatar ? 'MC đã chọn' : 'MC theo profile'}</span></summary>
    <fieldset disabled={busy}>
      <NewsVideoOptions value={options} onChange={onOptions} showStyle={false} showFont />
      <div className="research-batch-mc"><h3>MC cho các video sắp render</h3><NewsMcPicker data={data} projectId={project.id} value={avatar} onChange={onAvatar} rotation={rotation} onRotationChange={onRotation} count={count} notify={notify} /></div>
      <h3>Hiệu suất · áp dụng toàn app</h3>
      <div className="research-batch-toolbar">
        <label>Tác vụ AI song song<select aria-label="Tác vụ AI song song" value={performance.concurrency} onChange={event => onPerformance({ ...performance, concurrency: Number(event.target.value) })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Video render song song<select aria-label="Video render song song" value={performance.renderConcurrency} onChange={event => onPerformance({ ...performance, renderConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>FFmpeg threads<select value={performance.threads} onChange={event => onPerformance({ ...performance, threads: Number(event.target.value) })}>{[1, 2, 4, 8, 16, 32].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <Button onClick={() => onSavePerformance()} busy={savingPerformance}>Lưu hiệu suất</Button>
      </div>
      {fallbackCount > 0 && <div className="research-llm-actions">
        <Button onClick={() => onLlm()} busy={llmProgress.active}>{llmProgress.active ? `LLM ${llmProgress.done}/${llmProgress.total}` : `Chạy LLM cho ${fallbackCount} tin`}</Button>
        <Button onClick={() => onLlm({ renderAfter: true })} busy={llmProgress.active} disabled={!renderCount || renderBlocked}>LLM → Render {renderCount} tin</Button>
      </div>}
    </fieldset>
  </details>;
}
