import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  AlertTriangle,
  Download,
  ExternalLink,
  Film,
  Image,
  ImageDown,
  KeyRound,
  Newspaper,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { buildResearchAssemblyTimeline } from "../../shared/research-assembly.js";
import { researchProgress, researchViews, matchesResearchView } from "../../shared/research-status.js";
import { Button, Empty, Field, Notice, Modal } from "../components.jsx";
import "./research.css";
import { NewsMcPicker } from "../NewsMcPicker.jsx";
import { NewsVideoOptions, useNewsVideoOptions } from '../NewsVideoOptions.jsx';
import { researchSourceDates, matchesSourceAge, sourceDateLabel } from "../../shared/source-context.js";
import { MAX_NEWS_VIDEOS, MAX_RESEARCH_STORIES } from "../../shared/mc-rotation.js";
import { ResearchBatchProgress } from "../ResearchBatchProgress.jsx";

const emptyResearch = {
  topic: "",
  niche: "General news",
  language: "en",
  feeds: "",
  count: 10,
  includeImages: true,
};

function dateLabel(value) {
  if (!value) return "Chưa có ngày";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function articleDateLabel(value) {
  if (!value) return "Ngày đăng chưa rõ";
  try {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return "Ngày đăng chưa rõ";
  }
}

function accountStatus(account) {
  return account.status === "ready" ? "Sẵn sàng" : account.status === "checking" ? "Đang kiểm tra" : account.status === "needs_login" ? "Cần đăng nhập" : account.status || "Chưa kiểm tra";
}

function isLlmFallback(result) {
  return result?.contentSource !== "llm" || result?.warnings?.some((warning) => /LLM/i.test(warning));
}

function ResearchImageTile({ image }) {
  const [failed, setFailed] = useState(false);
  return (
    <a className="research-image-tile" href={image.pageUrl || image.imageUrl} target="_blank" rel="noreferrer">
      <div className={`research-image-thumb${failed ? " is-failed" : ""}`}>
        {failed ? <span>Preview unavailable</span> : <img src={image.imageUrl} alt={image.title || image.query} loading="eager" decoding="async" onError={() => setFailed(true)} />}
      </div>
      <span>{image.title || image.query}</span>
      <small>{image.license || "Commons"}</small>
    </a>
  );
}

function ResearchForm({ project, notify, active }) {
  const [value, setValue] = useState(emptyResearch);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!value.topic.trim() || busy || active) return;
    setBusy(true);
    try {
      const payload = {
        projectId: project.id,
        topic: value.topic.trim(),
        niche: value.niche.trim() || "Tin tức tổng hợp",
        language: value.language,
        feeds: value.feeds.split(/\r?\n|,/).map((feed) => feed.trim()).filter(Boolean),
        requestId: crypto.randomUUID(),
        count: Number(value.count),
        includeImages: value.includeImages,
      };
      await api("/research/batches", payload);
      notify(`Đang tìm tối đa ${payload.count} tin mới riêng biệt. Bạn có thể chuyển màn hình; tiến độ được lưu trong dự án.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const update = (key, next) => setValue((current) => ({ ...current, [key]: next }));
  return (
    <form className="research-form" onSubmit={submit}>
      <div className="research-form-grid">
        <Field label="Chủ đề cần nghiên cứu">
          <input value={value.topic} required maxLength={200} autoFocus placeholder="Ví dụ: Xu hướng video ngắn 2026" onChange={(event) => update("topic", event.target.value)} />
        </Field>
        <Field label="Ngách nội dung">
          <input value={value.niche} maxLength={120} onChange={(event) => update("niche", event.target.value)} />
        </Field>
        <Field label="Ngôn ngữ">
          <select value={value.language} onChange={(event) => update("language", event.target.value)}><option value="en">English (US)</option></select>
        </Field>
        <Field label="Số tin muốn research" hint="Nhập 1–100. Mỗi nguồn mới tạo một tin riêng để render; bỏ tin trùng và tin đã research.">
          <input type="number" min="1" max={MAX_RESEARCH_STORIES} step="1" required value={value.count} onChange={event => update('count', event.target.value)} />
        </Field>
      </div>
      <Field label="RSS/Atom feeds riêng (tùy chọn)" hint="Mỗi dòng một URL HTTPS. Bỏ trống để tìm tin theo chủ đề, đăng trong ngày hiện tại theo giờ Mỹ. Nếu nguồn ít hơn số yêu cầu, app báo số tin thực tế.">
        <textarea rows="3" value={value.feeds} placeholder="https://example.com/feed.xml" onChange={(event) => update("feeds", event.target.value)} />
      </Field>
      <label className="research-check"><input type="checkbox" checked={value.includeImages} onChange={(event) => update("includeImages", event.target.checked)} /><span /> Gợi ý hình ảnh cho từng góc nội dung</label>
      <div className="research-form-actions"><span><ShieldCheck size={14} /> Mỗi tin được lưu ngay · tiếp tục khi mở lại app</span><Button type="submit" variant="primary" busy={busy} disabled={active}><Search size={15} /> {active ? "Đang research trong nền…" : "Bắt đầu research"}</Button></div>
    </form>
  );
}

function ResultCard({ result, data, notify, accounts, onImport, importing, onUse, onDreamFace, dreaming, onAssemble, onSearchImages, searchingImages, onImportSearchImages, importingSearchImages, onRerunLlm, rerunning, progress, onOpenRender, onOpenVideo, selected = false, onToggleSelect, onDelete, deleting, onQuickRender, quickCount, actionBusy }) {
  const [expanded, setExpanded] = useState(false);
  const [videoCount, setVideoCount] = useState(1);
  const [avatarMediaId, setAvatarMediaId] = useState('');
  const [mcRotation, setMcRotation] = useState([]);
  const [accountId, setAccountId] = useState("auto");
  const [autoCreateContent, setAutoCreateContent] = useState(true);
  const feedFallback = isLlmFallback(result);
  return (
    <article className={`research-result-card${selected ? " is-selected" : ""}${expanded ? " is-expanded" : " is-compact"}`} data-research-id={result.id}>
      <div className="research-result-select-row"><label><input type="checkbox" checked={selected} onChange={() => onToggleSelect?.(result.id)} /> Chọn tin</label>
        <span className={`research-progress-badge is-${progress.state}`}>{progress.state === 'running' ? `Đang xử lý ${progress.active} video` : progress.state === 'failed' ? `Cần xử lý · ${progress.failed} lỗi / đã dừng` : progress.completed ? `Đã render · ${progress.completed} video` : 'Chưa render'}</span>
        {progress.completed > 0 && progress.state !== 'rendered' && <span className="research-history-rendered">Đã có {progress.completed} video</span>}
        {progress.posted && <span className="research-history-posted">Đã đăng</span>}
        <div className="research-row-actions">
          {!expanded && <Button onClick={() => onQuickRender(result)} busy={dreaming} disabled={progress.active > 0 || actionBusy}>{progress.completed ? 'Render lại' : 'Render'} {quickCount === 1 ? '1 video' : `${quickCount} videos`}</Button>}
          <Button aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Thu gọn' : 'Chi tiết & MC'}</Button>
          <Button className="danger-text" onClick={() => onDelete([result])} busy={deleting} disabled={progress.active > 0 || actionBusy} title={progress.active ? 'Tin đang chuẩn bị hoặc render' : 'Xóa tin khỏi Research'}><Trash2 size={14} /> Xóa tin</Button>
        </div>
      </div>
      <div className="research-result-header"><div><span className="research-kicker">{result.niche} · {dateLabel(result.createdAt)}</span><h3>{result.headline || result.topic}</h3></div><div className="research-result-statuses"><span className={`research-result-source ${feedFallback ? "fallback" : "llm"}`}>{feedFallback ? <CircleHelp size={14} /> : <Sparkles size={14} />}{feedFallback ? "Fallback từ feed" : "LLM đã tổng hợp"}</span><span className="research-result-state"><CheckCircle2 size={14} /> Đã lưu</span></div></div>
      <div className="research-source-date">{sourceDateLabel(result)}<small>Ngày lưu Research: {dateLabel(result.createdAt)}</small></div>
      <div className="research-progress-detail"><span>{progress.lastAt ? `Hoạt động gần nhất: ${dateLabel(progress.lastAt)}` : 'Chưa gửi tác vụ render'}{progress.completed > progress.available ? ' · Có video đã dọn khỏi thư viện; lịch sử vẫn được giữ.' : ''}</span>
        <div>{progress.latestBatchId && <Button onClick={onOpenRender}>Xem lượt render</Button>}{progress.available > 0 && <Button onClick={onOpenVideo}>Xem video</Button>}</div>
      </div>
      {progress.failed > 0 && <p className="research-progress-error" title={progress.error}>{progress.error.slice(0, 180)}</p>}
      {result.imagePreparation?.warning && <Notice>{result.imagePreparation.warning}</Notice>}
      {expanded && <>
      {feedFallback && <div className="research-llm-status"><span><AlertTriangle size={15} /><strong>Research đang dùng bản tóm lược từ feed.</strong><small>{result.llmError || "LLM chưa trả về nội dung cho bản ghi này."} Bật và Test LLM rồi chạy lại để tạo headline, angle, script và image query bằng LLM.</small></span><Button onClick={() => onRerunLlm(result)} busy={rerunning}><RefreshCw size={14} /> Chạy lại bằng LLM</Button></div>}
      {(result.angle || result.script) && <details className="research-detail-block"><summary>Góc kể chuyện &amp; script</summary><div className="research-detail-content">{result.angle && <p className="research-angle"><strong>Góc tiếp cận</strong>{result.angle}</p>}{result.script && <div className="research-script"><strong>Script nháp</strong><p>{result.script}</p></div>}</div></details>}
      {result.articles?.length > 0 && <details className="research-detail-block research-articles"><summary>Nguồn tham khảo · {result.articles.length} tin</summary><div className="research-detail-content"><ol className="research-article-list">{result.articles.map((article, index) => <li key={article.id}><a className="research-article-link" href={article.url} target="_blank" rel="noreferrer" title={`Mở nguồn: ${article.title}`} aria-label={`Mở nguồn: ${article.title}`}><span className="research-article-number">{index + 1}</span><span className="research-article-copy"><b>{article.title}</b><small>{article.source || "Nguồn RSS"} · {articleDateLabel(article.publishedAt)} · Match {Math.round((article.relevance || 0) * 100)}%</small>{article.summary && <em>{article.summary.slice(0, 220)}{article.summary.length > 220 ? "…" : ""}</em>}</span><span className="research-open-source">Mở nguồn <ExternalLink size={14} /></span></a></li>)}</ol></div></details>}
      {result.imageQueries?.length > 0 && <details className="research-detail-block research-tags"><summary>Image queries · {result.imageQueries.length}</summary><div className="research-detail-content"><div>{result.imageQueries.map((query) => <span key={query}>{query}</span>)}</div></div></details>}
      <NewsMcPicker data={data} projectId={result.projectId} value={avatarMediaId} onChange={setAvatarMediaId} rotation={mcRotation} onRotationChange={setMcRotation} count={videoCount} notify={notify} label="Ảnh MC cho tin này" />
      <div className="research-auto-video"><span><Sparkles size={15} /><strong>Render tin này</strong><small>Ảnh, hook và MC DreamFace sẽ được tạo theo tin.</small></span><div className="research-auto-video-controls"><label>Số video<input type="number" min="1" max={MAX_NEWS_VIDEOS} step="1" value={videoCount} onChange={event => setVideoCount(event.target.value === "" ? "" : Number(event.target.value))} /></label><label>Profile chạy MC<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="auto">Auto · xoay profile khỏe</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.status}</option>)}</select></label><label className="research-auto-content-check"><input type="checkbox" checked={autoCreateContent} onChange={(event) => setAutoCreateContent(event.target.checked)} /><span>Tự tạo Content</span></label></div><Button variant="primary" onClick={() => onDreamFace(result, videoCount, accountId, autoCreateContent, avatarMediaId, mcRotation)} busy={dreaming} disabled={progress.active > 0}><Sparkles size={14} /> {progress.completed ? "Render lại" : "Render"} {videoCount === 1 ? "1 video" : `${videoCount} videos`}</Button></div>
      {result.imageQueries?.length > 0 && <details className="research-detail-block research-image-search"><summary>Kho ảnh công khai · {result.imageSearchResults?.length || 0} ảnh đã tìm</summary><div className="research-detail-content"><div className="research-image-search-heading"><div><strong>Wikimedia Commons</strong><small>Có giấy phép và nguồn để kiểm tra</small></div><Button onClick={() => onSearchImages(result)} busy={searchingImages}><Image size={14} /> {result.imageSearchResults?.length ? "Tìm lại ảnh" : "Tìm ảnh theo query"}</Button></div>{result.imageSearchResults?.length > 0 && <><div className="research-image-grid">{result.imageSearchResults.slice(0, 6).map((image) => <ResearchImageTile key={image.id} image={image} />)}</div><div className="research-image-actions"><span>{result.imageSearchResults.length} ảnh đã tìm được · tối đa 12 ảnh sẽ nhập</span><Button onClick={() => onImportSearchImages(result)} busy={importingSearchImages}><Download size={14} /> Tải ảnh về thư viện</Button></div></>}</div></details>}
      {(result.articles?.some((article) => article.imageUrl) || result.imageMediaIds?.length > 0 || result.script) && <details className="research-detail-block research-assets"><summary>Media &amp; thao tác · {result.imageMediaIds?.length || 0} ảnh sẵn sàng</summary><div className="research-detail-content">{result.articles?.some((article) => article.imageUrl) && <div className="research-image-actions"><span>{result.imageMediaIds?.length || 0} ảnh đã nhập vào thư viện</span><Button onClick={() => onImport(result)} busy={importing}><ImageDown size={14} /> Tải ảnh bài viết</Button></div>}{result.imageMediaIds?.length > 0 && <div className="research-image-actions"><span>{result.imageMediaIds.length} ảnh sẵn sàng để dựng</span><Button onClick={() => onAssemble(result)}><Film size={14} /> Ráp ảnh + caption</Button></div>}{result.script && <div className="research-image-actions"><span>Script đã sẵn sàng cho trình dựng video</span><Button onClick={() => onUse(result)}><Film size={14} /> Dùng script tạo video</Button></div>}</div></details>}
      {result.warnings?.length > 0 && <div className="research-warning"><CircleHelp size={15} />{result.warnings.join(" · ")}</div>}
      </>}
    </article>
  );
}

function DreamFacePanel({ data, notify }) {
  const accounts = (data.accounts || []).filter((account) => account.provider === "dreamface");
  const [selectedId, setSelectedId] = useState(accounts[0]?.id || "");
  const [loginAccount, setLoginAccount] = useState(null);
  const [method, setMethod] = useState("credentials");
  const [login, setLogin] = useState({ email: "", password: "", cookies: "" });
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!accounts.some((account) => account.id === selectedId)) setSelectedId(accounts[0]?.id || "");
  }, [accounts, selectedId]);
  const selected = accounts.find((account) => account.id === selectedId);
  const action = async (key, operation, message) => {
    if (busy) return;
    setBusy(key);
    try {
      await operation();
      notify(message);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy("");
    }
  };
  const submitLogin = async (event) => {
    event.preventDefault();
    const account = loginAccount;
    const payload = method === "cookie" ? { cookies: login.cookies } : { email: login.email, password: login.password };
    await action(`login:${account.id}`, () => method === "cookie" ? api(`/accounts/${account.id}/cookies`, payload) : api(`/accounts/${account.id}/login`, payload), "Đã gửi thông tin đăng nhập DreamFace. Hãy hoàn tất MFA/xác minh trong cửa sổ nếu được yêu cầu.");
    setLogin({ email: "", password: "", cookies: "" });
    setLoginAccount(null);
  };
  return (
    <section className="research-card dreamface-card">
      <div className="research-card-heading"><div><span className="research-kicker">PROVIDER PROFILE</span><h2><Sparkles size={19} /> DreamFace</h2><p>Profile trình duyệt riêng cho tài khoản DreamFace. Automation chạy ẩn; đăng nhập luôn mở cửa sổ hiển thị.</p></div><span className="research-safe-pill"><ShieldCheck size={14} /> User-owned account</span></div>
      <div className="dreamface-notice"><ShieldCheck size={16} /><span>Studio không tự đăng ký tài khoản, tạo account ngẫu nhiên hoặc vượt CAPTCHA. Chỉ dùng email/mật khẩu hoặc cookie do bạn cung cấp.</span></div>
      {selected ? <div className="dreamface-account"><div className="dreamface-avatar"><UserRound size={18} /></div><div className="dreamface-account-copy"><strong>{selected.name}</strong><span>{selected.email || "Cookie session"} · {accountStatus(selected)}</span></div><div className="dreamface-account-actions"><Button disabled={busy === `check:${selected.id}`} onClick={() => action(`check:${selected.id}`, () => api(`/accounts/${selected.id}/check`), "Đã kiểm tra phiên DreamFace.")}><RefreshCw size={14} /> Kiểm tra</Button><Button onClick={() => setLoginAccount(selected)}><KeyRound size={14} /> Đăng nhập</Button><Button onClick={() => action(`open:${selected.id}`, () => api(`/accounts/${selected.id}/open`), "Đã mở profile DreamFace.")}><ExternalLink size={14} /></Button></div></div> : <Empty icon={UserRound} title="Chưa có profile DreamFace">Thêm account DreamFace ở mục Tài khoản, sau đó quay lại đây để đăng nhập.</Empty>}
      {accounts.length > 1 && <label className="dreamface-switcher"><span>Profile đang chọn</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
      {loginAccount && <div className="dreamface-login"><div className="dreamface-login-top"><div><strong>Đăng nhập {loginAccount.name}</strong><small>Cửa sổ hiển thị sẽ được mở cho bước xác minh của bạn.</small></div><button className="icon-button" type="button" onClick={() => setLoginAccount(null)} aria-label="Đóng"><X size={17} /></button></div><div className="research-tabs"><button type="button" className={method === "credentials" ? "active" : ""} onClick={() => setMethod("credentials")}>Email + mật khẩu</button><button type="button" className={method === "cookie" ? "active" : ""} onClick={() => setMethod("cookie")}>Cookie session</button></div><form onSubmit={submitLogin}>{method === "credentials" ? <div className="research-form-grid"><Field label="Email"><input type="email" required value={login.email} onChange={(event) => setLogin((current) => ({ ...current, email: event.target.value }))} /></Field><Field label="Mật khẩu"><input type="password" required autoComplete="off" value={login.password} onChange={(event) => setLogin((current) => ({ ...current, password: event.target.value }))} /></Field></div> : <Field label="Cookie JSON / Cookie-Editor / header" hint="Cookie chỉ được gửi vào profile DreamFace và không hiển thị trong public snapshot."><textarea rows="4" required value={login.cookies} onChange={(event) => setLogin((current) => ({ ...current, cookies: event.target.value }))} /></Field>}<div className="research-form-actions"><span>Không lưu thông tin nhạy cảm vào trình duyệt UI.</span><Button type="submit" variant="primary" busy={busy === `login:${loginAccount.id}`}><KeyRound size={14} /> Gửi đăng nhập</Button></div></form></div>}
    </section>
  );
}

export function ResearchPage({ data, project, notify, navigate }) {
  const [results, setResults] = useState(data.researchResults || []);
  const [view, setView] = useState("research");
  const [importing, setImporting] = useState("");
  const [searchingImages, setSearchingImages] = useState("");
  const [importingSearchImages, setImportingSearchImages] = useState("");
  const [dreaming, setDreaming] = useState("");
  const [autoVideo, setAutoVideo] = useState("");
  const [rerunning, setRerunning] = useState("");
  const [researchFilter, setResearchFilter] = useState("work");
  const [query, setQuery] = useState("");
  const [llmFilter, setLlmFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [previewResearchId, setPreviewResearchId] = useState(null);
  const [sourceAge, setSourceAge] = useState('all');
  const [sortBy, setSortBy] = useState('source-new');
  const [batchAvatarMediaId, setBatchAvatarMediaId] = useState('');
  const [batchMcRotation, setBatchMcRotation] = useState([]);
  const [selectedResearchBatch, setSelectedResearchBatch] = useState('');
  const [batchVideoCount, setBatchVideoCount] = useState(1);
  const [llmBatch, setLlmBatch] = useState({ active: false, done: 0, total: 0 });
  const [batchAutoCreateContent, setBatchAutoCreateContent] = useState(true);
  const [newsOptions, setNewsOptions] = useNewsVideoOptions(project.id);
  const [renderOptions, setRenderOptions] = useState({
    concurrency: Number(data.settings?.concurrency) || 2,
    renderConcurrency: Number(data.settings?.renderConcurrency) || 1,
    threads: Number(data.settings?.renderThreads) || 2,
  });
  const [savingRenderOptions, setSavingRenderOptions] = useState(false);
  const dreamfaceAccounts = useMemo(
    () => (data.accounts || []).filter((account) => account.provider === "dreamface"),
    [data.accounts],
  );
  useEffect(() => setResults(data.researchResults || []), [data.researchResults]);
  useEffect(() => setRenderOptions({
    concurrency: Number(data.settings?.concurrency) || 2,
    renderConcurrency: Number(data.settings?.renderConcurrency) || 1,
    threads: Number(data.settings?.renderThreads) || 2,
  }), [data.settings?.concurrency, data.settings?.renderConcurrency, data.settings?.renderThreads]);
  const researchBatches = (data.researchBatches || []).filter(batch => batch.projectId === project.id);
  const projectResults = useMemo(() => results.filter((result) => result.projectId === project.id).sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)), [results, project.id]);
  const progressById = useMemo(() => researchProgress({ ...data, researchResults: projectResults }, project.id), [data.media, data.jobs, data.productionBatches, data.socialPosts, data.settings?.meta?.publications, projectResults, project.id]);
  const visibleResults = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return projectResults.filter(result => (!selectedResearchBatch || result.batchId === selectedResearchBatch) && matchesResearchView(progressById.get(result.id), researchFilter)
      && matchesSourceAge(result, sourceAge)
      && (llmFilter === 'all' || isLlmFallback(result) === (llmFilter === 'needs-llm'))
      && (!search || [result.headline, result.topic, result.niche, ...(result.articles || []).flatMap(article => [article.title, article.source])].join(' ').toLocaleLowerCase().includes(search)))
      .sort((a, b) => {
        const saved = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (sortBy === 'source-new') return (researchSourceDates(b).newest || 0) - (researchSourceDates(a).newest || 0) || saved;
        if (sortBy === 'render-new') return (Date.parse(progressById.get(b.id).lastAt) || 0) - (Date.parse(progressById.get(a.id).lastAt) || 0) || saved;
        return saved;
      });
  }, [projectResults, researchFilter, progressById, query, llmFilter, sourceAge, sortBy, selectedResearchBatch]);
  const totalPages = Math.max(1, Math.ceil(visibleResults.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageResults = visibleResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const onResult = (result) => setResults((current) => [result, ...current.filter((item) => item.id !== result.id)]);
  const [selectedResearchIds, setSelectedResearchIds] = useState([]);
  const [deletingResearch, setDeletingResearch] = useState(false);
  const selectedResults = visibleResults.filter(result => selectedResearchIds.includes(result.id));
  const fallbackResults = (selectedResearchIds.length ? selectedResults : visibleResults).filter(isLlmFallback);
  const previewVideos = (progressById.get(previewResearchId)?.mediaIds || []).map(id => data.media.find(media => media.id === id)).filter(Boolean);
  const eligibleRenderResults = (selectedResearchIds.length ? selectedResults : visibleResults).filter(result => {
    const progress = progressById.get(result.id);
    return !progress.completed && !progress.active;
  });
  const renderCandidates = eligibleRenderResults.slice(0, Math.floor(MAX_NEWS_VIDEOS / (Number(batchVideoCount) || 1)));
  const actionBusy = deletingResearch || Boolean(autoVideo || dreaming || rerunning) || llmBatch.active;
  useEffect(() => { setPage(1); setSelectedResearchIds([]); }, [project.id, researchFilter, query, llmFilter, sourceAge, selectedResearchBatch]);
  useEffect(() => setPage(1), [pageSize, sortBy]);
  const toggleResearch = (id) => setSelectedResearchIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const deleteResearch = async (targets = selectedResults) => {
    if (actionBusy || !targets.length) return;
    const message = targets.length === 1 ? 'Xóa tin “' + (targets[0].headline || targets[0].topic) + '” khỏi Research?' : 'Xóa ' + targets.length + ' tin đã chọn khỏi Research?';
    if (!confirm(message + '\nVideo và bài đã đăng vẫn được giữ. Tin đang xử lý sẽ được bỏ qua.')) return;
    setDeletingResearch(true);
    try {
      const response = await api('/research/delete', { projectId: project.id, ids: targets.map(result => result.id) });
      const removed = new Set([...response.deletedIds, ...response.missingIds]);
      setResults(current => current.filter(result => !removed.has(result.id)));
      setSelectedResearchIds(current => current.filter(id => !removed.has(id)));
      notify('Đã xóa ' + response.deletedIds.length + ' tin.' + (response.skipped.length ? ' Giữ lại ' + response.skipped.length + ' tin đang chuẩn bị hoặc render.' : ''));
    } catch (error) { notify(error.message, 'error'); }
    finally { setDeletingResearch(false); }
  };
  const rerunLlm = async (result) => {
    if (rerunning || llmBatch.active) return;
    setRerunning(result.id);
    try {
      const updated = await api(`/research/${result.id}/llm`, {});
      onResult(updated);
      notify("LLM đã tổng hợp lại Research từ đúng các nguồn đã lưu.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setRerunning("");
    }
  };
  const rerunAllLlm = async ({ renderAfter = false } = {}) => {
    if (rerunning || llmBatch.active || autoVideo || dreaming || !fallbackResults.length) return;
    const selected = (renderAfter ? renderCandidates : fallbackResults).filter(isLlmFallback);
    const workerCount = Math.max(1, Math.min(4, Number(data.settings?.concurrency) || 2));
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    setLlmBatch({ active: true, done: 0, total: selected.length });
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= selected.length) return;
        try {
          const updated = await api(`/research/${selected[index].id}/llm`, {});
          onResult(updated);
          succeeded += 1;
        } catch {
          failed += 1;
        } finally {
          setLlmBatch((current) => ({ ...current, done: current.done + 1 }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(workerCount, selected.length) }, worker));
    setLlmBatch({ active: false, done: selected.length, total: selected.length });
    if (failed) {
      notify(`LLM đã xử lý ${succeeded}/${selected.length} tin; ${failed} tin vẫn cần kiểm tra cấu hình hoặc thử lại.`, "error");
      return;
    }
    notify(`LLM đã xử lý xong ${succeeded} tin. Có thể đưa toàn bộ vào render.`);
    if (renderAfter) await renderAllResearch();
  };
  const importImages = async (result) => {
    if (importing) return;
    setImporting(result.id);
    try {
      const response = await api(`/research/${result.id}/import-images`, {
        articleIds: result.articles.filter((article) => article.imageUrl).map((article) => article.id),
      });
      onResult(response.result);
      notify(`Đã tải ${response.imported.length} ảnh vào thư viện.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setImporting("");
    }
  };
  const searchImages = async (result) => {
    if (searchingImages) return;
    setSearchingImages(result.id);
    try {
      const response = await api(`/research/${result.id}/search-images`, { queries: result.imageQueries || [] });
      onResult(response.result);
      notify(`Đã tìm ${response.images.length} ảnh công khai theo image query.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSearchingImages("");
    }
  };
  const importSearchImages = async (result) => {
    if (importingSearchImages) return;
    setImportingSearchImages(result.id);
    try {
      const response = await api(`/research/${result.id}/import-search-images`, { imageIds: (result.imageSearchResults || []).map((image) => image.id) });
      onResult(response.result);
      notify(`Đã tải ${response.imported.length} ảnh vào thư viện.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setImportingSearchImages("");
    }
  };
  const useScript = (result) => {
    sessionStorage.setItem(`studio-research-prompt:${project.id}`, result.script || result.headline || "");
    notify("Đã chuyển script sang màn hình tạo video.");
    navigate?.("create");
  };
  const createDreamFaceVideo = async (result, requestedCount = 1, selectedAccountId = "auto", autoCreateContent = false, selectedAvatarMediaId = '', mcRotation = []) => {
    if (dreaming || autoVideo) return;
    if (progressById.get(result.id)?.active) { notify("Tin này đang có lượt render. Mở lượt render để theo dõi.", "error"); return; }
    const readyCount = dreamfaceAccounts.filter((account) => account.status === "ready").length;
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_NEWS_VIDEOS) { notify('Nhập số video nguyên từ 1 đến 100.', 'error'); return; }
    setDreaming(result.id);
    try {
      const batch = await api("/production/batches", {
        requestId: crypto.randomUUID(),
        projectId: project.id,
        contentType: "news",
        autoCreateContent,
        autoResearch: true,
        researchId: result.id,
        topic: (result.topic || result.headline || "US news").slice(0, 200),
        count,
        engine: "dreamface",
        accountId: selectedAccountId || "auto",
        avatarMediaId: mcRotation.length ? null : selectedAvatarMediaId || null,
        mcRotation,
        references: [],
        feeds: [],
        variationPolicy: "visual-unique",
        fontStyle: "news",
        ...newsOptions,
      });
      notify(`Đã đưa ${batch.items?.length || count} video vào hàng đợi. ${mcRotation.length ? 'MC xoay theo số video đã nhập.' : selectedAvatarMediaId ? 'Dùng ảnh MC đã chọn.' : 'Dùng MC theo profile.'}${readyCount ? ` ${readyCount} profile sẵn sàng.` : ' Hãy đăng nhập DreamFace để chạy.'}`);
      // The News render workspace owns the preparation batch as well as the
      // provider jobs. Keep the user there so image/LLM failures are visible
      // and the failed item can be retried instead of disappearing in Queue.
      navigate?.("editor", { focusBatchId: batch.id, researchId: result.id });
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDreaming("");
    }
  };
  const saveRenderOptions = async () => {
    setSavingRenderOptions(true);
    try {
      await api("/settings", {
        concurrency: renderOptions.concurrency,
        renderConcurrency: renderOptions.renderConcurrency,
        renderThreads: renderOptions.threads,
      }, "PATCH");
      notify(`Đã lưu: ${renderOptions.concurrency} tác vụ AI · ${renderOptions.renderConcurrency} video render song song · ${renderOptions.threads} FFmpeg threads/video.`);
      return true;
    } catch (error) {
      notify(error.message, "error");
      return false;
    } finally {
      setSavingRenderOptions(false);
    }
  };
  const renderAllResearch = async () => {
    if (actionBusy || savingRenderOptions || !renderCandidates.length) return;
    const perStory = Number(batchVideoCount);
    if (!Number.isInteger(perStory) || perStory < 1 || perStory > MAX_NEWS_VIDEOS) { notify('Nhập số video mỗi tin từ 1 đến 100.', 'error'); return; }
    if (!(await saveRenderOptions())) return;
    const selected = renderCandidates;
    setAutoVideo("all");
    try {
    const batch = await api("/production/batches", {
      requestId: crypto.randomUUID(),
      projectId: project.id,
      contentType: "news",
      autoCreateContent: batchAutoCreateContent,
      autoResearch: true,
      researchIds: selected.flatMap(result => Array(perStory).fill(result.id)),
      topic: (selected[0].topic || selected[0].headline || "US news").slice(0, 200),
      count: selected.length * perStory,
      engine: "dreamface",
      accountId: "auto",
      avatarMediaId: batchMcRotation.length ? null : batchAvatarMediaId || null,
      mcRotation: batchMcRotation,
      references: [],
      feeds: [],
      variationPolicy: "visual-unique",
      fontStyle: "news",
      ...newsOptions,
    });
    notify(`Đã đưa ${selected.length} tin · ${batch.items.length} video vào một lượt render. ${batchMcRotation.length ? 'MC xoay liên tục qua toàn bộ lượt theo cấu hình.' : 'Dùng cấu hình MC đã chọn.'}`);
    navigate?.("editor", { focusBatchId: batch.id });
    } catch (error) { notify(error.message, 'error'); }
    finally { setAutoVideo(''); }
  };
  const autoBuildVideo = async (result) => {
    if (autoVideo) return;
    setAutoVideo(result.id);
    try {
      const response = await api(`/research/${result.id}/auto-video`, {});
      onResult(response.result);
      notify(`Đã tìm ${response.imported.length} ảnh, ráp ${response.assembly.overlays} caption và đưa render tin tức vào hàng đợi.`);
      navigate?.("queue");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setAutoVideo("");
    }
  };
  const assembleImages = async (result) => {
    try {
      const fresh = await api("/state");
      const freshProject = fresh.projects.find((item) => item.id === project.id);
      const assets = (result.imageMediaIds || [])
        .map((id) => fresh.media.find((item) => item.id === id))
        .filter((item) => item && item.kind === "image");
      const assembly = buildResearchAssemblyTimeline(freshProject.timeline, assets, result);
      if (!assembly.additions.length) {
        notify("Các ảnh này đã có trong timeline.");
        navigate?.("editor");
        return;
      }
      await api(`/projects/${project.id}`, { timeline: assembly.timeline }, "PATCH");
      notify(`Đã ráp ${assembly.additions.length} ảnh và ${assembly.overlays.length} caption vào timeline.`);
      navigate?.("editor");
    } catch (error) {
      notify(error.message, "error");
    }
  };
      return <div className="page research-page"><div className="page-heading research-heading"><div><div className="eyebrow">RESEARCH WORKSPACE</div><h1>Từ chủ đề đến góc kể chuyện.</h1><p>News Studio là luồng riêng: research → ảnh editorial → MC DreamFace → bài website → first comment.</p></div><div className="research-heading-actions"><Button variant="primary" onClick={() => renderCandidates[0] ? createDreamFaceVideo(renderCandidates[0], 1, "auto", batchAutoCreateContent, batchAvatarMediaId, batchMcRotation) : navigate?.("editor")} busy={Boolean(dreaming)}><Newspaper size={15} /> Render 1 News video</Button><div className="research-heading-mark"><Newspaper size={20} /><span>{projectResults.length} kết quả</span></div></div></div><div className="research-tabs research-primary-tabs"><button className={view === "research" ? "active" : ""} onClick={() => setView("research")}><Search size={15} /> Research &amp; News</button><button className={view === "dreamface" ? "active" : ""} onClick={() => setView("dreamface")}><Sparkles size={15} /> DreamFace profiles</button></div>{view === "research" && <><section className="research-card research-run-card"><div className="research-card-heading"><div><span className="research-kicker">EDITORIAL INPUT</span><h2><Search size={19} /> Nghiên cứu chủ đề</h2><p>RSS/Atom được giới hạn và deduplicate trước khi tổng hợp.</p></div><span className="research-step"><span>01</span> INPUT</span></div><ResearchForm key={project.id} project={project} notify={notify} active={researchBatches.some(batch => ['pending', 'running'].includes(batch.status))} /><ResearchBatchProgress batches={researchBatches} results={projectResults} notify={notify} onSelect={ids => { setSelectedResearchBatch(projectResults.find(result => ids.includes(result.id))?.batchId || ''); setResearchFilter('work'); setQuery(''); setLlmFilter('all'); setSourceAge('all'); setSelectedResearchIds([]); }} /></section><section className="research-results">
  <div className="research-section-heading">
    <div><span className="research-kicker">NEWS STUDIO · PROJECT RESULTS</span><h2>Quản lý tin Research</h2></div>
    {projectResults.length > 0 && <div className="research-batch-toolbar">
      <span className="research-batch-count">{selectedResults.length ? `${selectedResults.length} tin đã chọn` : `${visibleResults.length}/${projectResults.length} tin trong bộ lọc`}</span>
      <label>Tác vụ AI song song<select aria-label="Tác vụ AI song song" value={renderOptions.concurrency} onChange={(event) => setRenderOptions((current) => ({ ...current, concurrency: Number(event.target.value) }))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Video render song song<select aria-label="Video render song song" value={renderOptions.renderConcurrency} onChange={event => setRenderOptions(current => ({ ...current, renderConcurrency: Number(event.target.value) }))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>FFmpeg threads<select value={renderOptions.threads} onChange={(event) => setRenderOptions((current) => ({ ...current, threads: Number(event.target.value) }))}>{[1, 2, 4, 8, 16, 32].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="research-batch-content"><input type="checkbox" checked={batchAutoCreateContent} onChange={(event) => setBatchAutoCreateContent(event.target.checked)} /> Tự tạo Content</label>
      {fallbackResults.length > 0 && <Button onClick={() => rerunAllLlm()} busy={llmBatch.active || Boolean(rerunning)}><RefreshCw size={14} /> {llmBatch.active ? `LLM ${llmBatch.done}/${llmBatch.total}` : `Chạy LLM cho ${fallbackResults.length} tin`}</Button>}
      {fallbackResults.length > 0 && <Button variant="primary" onClick={() => rerunAllLlm({ renderAfter: true })} busy={llmBatch.active || Boolean(rerunning)} disabled={!renderCandidates.length}><Sparkles size={14} /> LLM → Render {renderCandidates.length} tin</Button>}
    </div>}
  </div>
  {projectResults.length > 0 && <div className="research-batch-mc"><h3>MC và số video khi render hàng loạt</h3><Field label="Số video mỗi tin" hint="Mỗi lượt tối đa 100 video. MC xoay liên tục qua các tin; một tin có thể tạo nhiều phiên bản."><input type="number" min="1" max={MAX_NEWS_VIDEOS} step="1" value={batchVideoCount} onChange={event => setBatchVideoCount(event.target.value === "" ? "" : Number(event.target.value))} /></Field><NewsMcPicker data={data} projectId={project.id} value={batchAvatarMediaId} onChange={setBatchAvatarMediaId} rotation={batchMcRotation} onRotationChange={setBatchMcRotation} count={renderCandidates.length * batchVideoCount || batchVideoCount} notify={notify} /></div>}
  {projectResults.length > 0 && <NewsVideoOptions value={newsOptions} onChange={setNewsOptions} />}
  {projectResults.length > 0 && <div className="research-manager">
    <div className="research-status-tabs" aria-label="Trạng thái render Research">{researchViews.map(([value, label]) => <button key={value} type="button" aria-pressed={researchFilter === value} className={researchFilter === value ? 'active' : ''} onClick={() => setResearchFilter(value)}>{label}<b>{projectResults.filter(result => matchesResearchView(progressById.get(result.id), value)).length}</b></button>)}</div>
    <div className="research-manager-filters">
      <Field label="Lượt research"><select value={selectedResearchBatch} onChange={event => { setSelectedResearchBatch(event.target.value); setSelectedResearchIds([]); setPage(1); }}><option value="">Tất cả lượt research</option>{researchBatches.slice().reverse().map(batch => <option key={batch.id} value={batch.id}>{batch.request.topic} · {dateLabel(batch.createdAt)} · {batch.items.filter(item => item.resultId).length} tin</option>)}</select></Field>
      <Field label="Tìm tin Research"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tiêu đề, chủ đề, ngách hoặc nguồn tin…" /></Field>
      <Field label="Chất lượng nội dung"><select aria-label="Lọc Research" value={llmFilter} onChange={event => setLlmFilter(event.target.value)}><option value="all">Tất cả nội dung</option><option value="needs-llm">Cần chạy LLM</option><option value="llm">Đã có LLM</option></select></Field>
      <Field label="Số tin mỗi trang"><select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>{[12, 24, 48].map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Ngày đăng nguồn"><select value={sourceAge} onChange={event => setSourceAge(event.target.value)}><option value="all">Tất cả ngày nguồn</option><option value="24h">Nguồn mới trong 24 giờ</option><option value="7d">Nguồn trong 7 ngày</option><option value="older">Nguồn cũ hơn 24 giờ</option><option value="unknown">Chưa rõ ngày nguồn</option></select></Field>
      <Field label="Sắp xếp tin"><select value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="source-new">Ngày nguồn mới nhất</option><option value="render-new">Lượt render mới nhất</option><option value="saved-new">Ngày lưu Research mới nhất</option></select></Field>
    </div>
    <p className="research-manager-hint">Mặc định ưu tiên tin chưa có video hoặc lượt render cần xử lý. “Đã có video” và “Tất cả / lịch sử” giữ các tin đã xong. Các nhóm có thể trùng khi một tin đang render thêm.</p>
  </div>}
  {projectResults.length > 0 && <section className="research-selection-toolbar" aria-label="Chọn và xử lý tin">
    <div className="research-selection-controls">
      <label><input type="checkbox" aria-label="Chọn trang này" disabled={actionBusy || !pageResults.length} checked={pageResults.length > 0 && pageResults.every(result => selectedResearchIds.includes(result.id))} ref={node => { if (node) node.indeterminate = pageResults.some(result => selectedResearchIds.includes(result.id)) && !pageResults.every(result => selectedResearchIds.includes(result.id)); }} onChange={event => setSelectedResearchIds(current => event.target.checked ? [...new Set([...current, ...pageResults.map(result => result.id)])] : current.filter(id => !pageResults.some(result => result.id === id)))} /> Chọn trang này ({pageResults.length})</label>
      <Button onClick={() => setSelectedResearchIds(visibleResults.map(result => result.id))} disabled={actionBusy || !visibleResults.length}>Chọn tất cả {visibleResults.length} tin theo bộ lọc</Button>
      <Button onClick={() => setSelectedResearchIds([])} disabled={actionBusy || !selectedResearchIds.length}>Bỏ chọn tất cả</Button>
    </div>
    <div className="research-selection-actions"><strong>{selectedResults.length} tin đã chọn · {visibleResults.length} tin trong bộ lọc</strong><div>
      <Button variant="primary" onClick={renderAllResearch} busy={autoVideo === 'all' || savingRenderOptions} disabled={actionBusy || !renderCandidates.length}><Sparkles size={14} /> Render {renderCandidates.length} tin chưa có video{batchVideoCount > 1 ? ' · ' + renderCandidates.length * batchVideoCount + ' video' : ''}</Button>
      <Button className="danger-text" onClick={() => deleteResearch()} busy={deletingResearch} disabled={actionBusy || !selectedResults.length || selectedResults.every(result => progressById.get(result.id).active > 0)}><Trash2 size={14} /> Xóa {selectedResults.length} tin đã chọn</Button>
    </div></div>
    <small>{selectedResearchIds.length ? 'Thao tác áp dụng cho tin đã chọn trong bộ lọc.' : 'Chọn các tin muốn xử lý. Nếu chưa chọn, nút Render áp dụng cho các tin trong bộ lọc.'} Render hàng loạt bỏ qua tin đã có video hoặc đang chạy.{eligibleRenderResults.length > renderCandidates.length ? ' Giới hạn 100 video/lượt; còn ' + (eligibleRenderResults.length - renderCandidates.length) + ' tin cho lượt sau.' : ''}</small>
  </section>}
  {pageResults.length ? pageResults.map((result) => <ResultCard key={result.id} result={result} data={data} notify={notify} accounts={dreamfaceAccounts} progress={progressById.get(result.id)} onOpenRender={() => navigate?.('editor', { focusBatchId: progressById.get(result.id).latestBatchId, researchId: result.id })} onOpenVideo={() => setPreviewResearchId(result.id)} selected={selectedResearchIds.includes(result.id)} onToggleSelect={toggleResearch} onDelete={deleteResearch} deleting={deletingResearch} actionBusy={actionBusy} quickCount={Number(batchVideoCount) || 1} onQuickRender={result => createDreamFaceVideo(result, Number(batchVideoCount) || 1, "auto", batchAutoCreateContent, batchAvatarMediaId, batchMcRotation)} onImport={importImages} importing={importing === result.id} onUse={useScript} onDreamFace={createDreamFaceVideo} dreaming={dreaming === result.id} onAssemble={assembleImages} onSearchImages={searchImages} searchingImages={searchingImages === result.id} onImportSearchImages={importSearchImages} importingSearchImages={importingSearchImages === result.id} onRerunLlm={rerunLlm} rerunning={rerunning === result.id || llmBatch.active} />) : <Empty icon={Newspaper} title={projectResults.length ? "Không có tin khớp bộ lọc" : "Chưa có research nào"}>{projectResults.length ? 'Chọn “Tất cả / lịch sử” hoặc thay đổi tìm kiếm để xem các tin đã lưu.' : 'Nhập một chủ đề để tạo bản ghi đầu tiên cho dự án này.'}</Empty>}
  {visibleResults.length > 0 && <div className="research-pagination"><Button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trang trước</Button><span>Trang {currentPage}/{totalPages} · {visibleResults.length} tin</span><Button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Trang sau</Button></div>}
  </section></>}{view === "dreamface" && <DreamFacePanel data={data} notify={notify} />}
  {previewResearchId && <Modal title="Video của tin Research" wide onClose={() => setPreviewResearchId(null)}><div className="research-video-previews">{previewVideos.length ? previewVideos.map(media => <div key={media.id}><h3>{media.name}</h3><video src={media.url} controls playsInline preload="metadata" /></div>) : <p>Video đã được dọn khỏi thư viện. Lịch sử render vẫn được giữ.</p>}</div></Modal>}
  </div>;
}

export const Research = ResearchPage;
