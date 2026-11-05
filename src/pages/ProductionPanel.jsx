import { useMemo, useState } from "react";
import { Sparkles, Video } from "lucide-react";
import { api } from "../api.js";
import { Badge, Button, Field, Notice } from "../components.jsx";
import { NewsMcPicker } from "../NewsMcPicker.jsx";
import { isPageAvatar } from "../../shared/output-media.js";
import { MAX_NEWS_VIDEOS } from "../../shared/mc-rotation.js";
import { NewsVideoOptions, NewsFontSelect, useNewsVideoOptions } from '../NewsVideoOptions.jsx';
import { ProductionBatchRecords } from '../ProductionBatchRecords.jsx';

function batchTitle(batch, research) {
  const request = batch.request || {};
  return research?.headline || batch.sources?.[0]?.title || request.topic || request.sourceUrl || request.productName || "Video trực tiếp";
}

export function ProductionPanel({ data, project, mode, notify, navigate, focusBatchIds = [], focusResearchId = "" }) {
  const [topic, setTopic] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [productBrief, setProductBrief] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [autoResearch, setAutoResearch] = useState(true);
  const [count, setCount] = useState(1);
  const [engine, setEngine] = useState("dreamface");
  const [accountId, setAccountId] = useState("auto");
  const [avatarMediaId, setAvatarMediaId] = useState("");
  const [mcRotation, setMcRotation] = useState([]);
  const [references, setReferences] = useState([]);
  const [feeds, setFeeds] = useState("");
  const [newsOptions, setNewsOptions, newsSave] = useNewsVideoOptions(project);
  const [autoCreateContent, setAutoCreateContent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const accounts = (data.accounts || []).filter((account) => account.provider === "dreamface");
  const researchById = useMemo(() => new Map((data.researchResults || []).map((result) => [result.id, result])), [data.researchResults]);
  const newsMediaIds = new Set((data.researchResults || []).filter((result) => result.projectId === project.id).flatMap((result) => result.imageMediaIds || []));
  const newsMcIds = new Set((data.accounts || []).filter((account) => account.provider === "dreamface" && account.avatarMediaId).map((account) => account.avatarMediaId));
  const images = (data.media || []).filter((media) => media.kind === "image" && media.projectId === project.id).filter((media) => {
    const type = String(media.mediaType || "").toLowerCase();
    const name = String(media.name || "");
    const editorial = Boolean(media.sourceUrl || media.attribution || media.license);
    return !isPageAvatar(media, data) && !newsMediaIds.has(media.id) && !newsMcIds.has(media.id) && !["news-editorial", "news-mc", "news-video"].includes(type) && media.production?.contentType !== "news" && !(media.generated && /news|broadcast|mc host/i.test(name)) && !(editorial && type !== "product");
  });
  const allBatches = (data.productionBatches || []).filter((batch) => batch.projectId === project.id && batch.request?.contentType === mode).slice().reverse();
  const focusedSet = new Set((focusBatchIds || []).filter(Boolean));
  const focusedBatch = allBatches.find((batch) => focusedSet.has(batch.id) || (focusResearchId && batch.request?.researchId === focusResearchId));
  if (focusedBatch) focusedSet.add(focusedBatch.id);
  const batches = [...allBatches.filter((batch) => focusedSet.has(batch.id)), ...allBatches.filter((batch) => !focusedSet.has(batch.id))].slice(0, 6);
  const focusedResearch = focusedBatch?.request?.researchId ? researchById.get(focusedBatch.request.researchId) : focusResearchId ? researchById.get(focusResearchId) : null;

  const start = async (event) => {
    event.preventDefault();
    if (busy || mode === 'news' && (newsSave.saving || newsSave.error)) return;
    setBusy(true);
    try {
      const batch = await api("/production/batches", {
        requestId,
        projectId: project.id,
        contentType: mode,
        autoCreateContent,
        autoResearch: mode === "news" || autoResearch,
        topic,
        productName,
        productBrief,
        productUrl,
        sourceUrl: mode === "news" ? sourceUrl : "",
        count: Number(count),
        engine: mode === "product" ? "dreamface" : engine,
        accountId,
        avatarMediaId: mode === "news" && !mcRotation.length ? avatarMediaId || null : null,
        mcRotation: mode === "news" ? mcRotation : [],
        references: mode === "product" ? references : [],
        feeds: feeds.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        variationPolicy: "visual-unique",
        fontStyle: "news",
        ...(mode === 'news' ? newsOptions : {}),
      });
      setRequestId(crypto.randomUUID());
      notify(`${batch.items?.length || count} video${Number(count) === 1 ? "" : "s"} đang được chuẩn bị. Nếu LLM hoặc ảnh lỗi, lỗi sẽ hiện ngay trong bản ghi để Retry.`);
      navigate?.("editor", { focusBatchId: batch.id, researchId: batch.request?.researchId || "" });
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return <section className="production-panel workspace-hub">
    <div className="hub-panel-heading">
      <div>
        <span className="hub-kicker">BATCH PRODUCTION · ENGLISH (US)</span>
        <h2>{mode === "news" ? "Turn a niche into news videos" : "Turn products into video variations"}</h2>
        <p className="muted small">{mode === "news" ? "Research today's reports → create videos → write complete articles in Content." : "Research a product niche or add your own product → create videos → write store-link comments in Content."}</p>
      </div>
    </div>

    {focusedBatch && <article className="production-focus-card" data-testid="render-record" data-production-batch-id={focusedBatch.id}>
      <div className="production-focus-heading">
        <div>
          <span className="hub-kicker">BẢN GHI RENDER ĐANG ĐƯỢC THEO DÕI</span>
          <h3>{batchTitle(focusedBatch, focusedResearch)}</h3>
        </div>
        <Badge status={focusedBatch.status} />
      </div>
      <p className="production-focus-copy">{focusedResearch ? `Đã khóa theo bản research “${focusedResearch.topic || focusedResearch.headline}”. Video sẽ dùng đúng nguồn trong bản ghi này, tự chọn ảnh editorial và tạo narration/MC. Content sẽ ${focusedBatch.request?.autoCreateContent ? "được tạo tự động sau khi render" : "chờ bạn bấm tạo trong Content"}.` : "Bản ghi này đã được tạo. Mở Queue để xem từng bước chuẩn bị, render DreamFace và kết quả cuối."}</p>
      <div className="production-focus-steps">
        <span><b>1</b> Research đã chọn</span>
        <span><b>2</b> Ảnh + narration</span>
        <span><b>3</b> MC DreamFace</span>
        <span><b>4</b> Content &amp; website</span>
      </div>
      <div className="production-focus-actions">
        <Button onClick={() => navigate?.("queue")}><Video size={14} /> Mở Queue để xem tiến độ</Button>
        {focusedBatch.status === "completed" && <Button variant="primary" onClick={() => navigate?.("content")}>Mở Content</Button>}
      </div>
    </article>}

    <form onSubmit={start}>
      {mode === "product" && <div className="content-filter-tabs production-source-tabs"><button type="button" className={autoResearch ? "active" : ""} onClick={() => setAutoResearch(true)}>Auto research</button><button type="button" className={!autoResearch ? "active" : ""} onClick={() => setAutoResearch(false)}>My product</button></div>}
      <div className="production-inputs">
        {mode === "news" || autoResearch ? <Field label={mode === "news" ? "News niche" : "Product niche"}><input required={mode !== "news" || !sourceUrl} minLength={mode === "news" && sourceUrl ? undefined : 2} maxLength={200} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={mode === "news" ? "US technology, space, business…" : "Kitchen gadgets, pet accessories…"} /></Field> : <Field label="Product name"><input required maxLength={200} value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Portable blender" /></Field>}
        <Field label="Number of videos"><input type="number" min="1" max={mode === "news" ? MAX_NEWS_VIDEOS : 50} required value={count} onChange={(event) => setCount(event.target.value)} /></Field>
        {mode === "news" && <NewsFontSelect value={newsOptions} onChange={setNewsOptions} disabled={busy} />}
      </div>
      {mode === "news" && <Field label="Link bài news (tuỳ chọn)" hint="Dán link bài viết để dùng đúng bài đó; bỏ trống để tự research theo từ khóa."><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://news.example.com/article" /></Field>}
      {mode === "news" && <><NewsVideoOptions value={newsOptions} onChange={setNewsOptions} saveState={newsSave} disabled={busy} /><NewsMcPicker data={data} projectId={project.id} value={avatarMediaId} onChange={setAvatarMediaId} rotation={mcRotation} onRotationChange={setMcRotation} count={count || 1} notify={notify} /></>}
      {mode === "product" && <><div className="form-grid"><Field label="Product facts / creative brief"><textarea value={productBrief} maxLength={4000} onChange={(event) => setProductBrief(event.target.value)} placeholder="Verified features and the style you want. No invented offers." rows={3} /></Field><Field label="Product or store link" hint="Leave blank to use the store link from Settings."><input type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder={data.settings?.content?.storeUrl || "https://your-store.com/products/…"} /></Field></div>{images.length > 0 && <Field label="Product reference images" hint="Choose up to 10 images from this project's Library. News/editorial images are hidden."><div className="production-images">{images.map((media) => <label key={media.id}><input type="checkbox" checked={references.includes(media.id)} disabled={!references.includes(media.id) && references.length >= 10} onChange={() => setReferences((current) => current.includes(media.id) ? current.filter((id) => id !== media.id) : [...current, media.id])} /><img src={media.thumbnailUrl || media.url} alt="" /><span>{media.name}</span></label>)}</div></Field>}</>}
      <details className="production-options"><summary>Sources, profile &amp; render rules</summary><div className="form-grid"><Field label="RSS sources (optional)"><textarea rows={2} value={feeds} onChange={(event) => setFeeds(event.target.value)} placeholder="One RSS URL per line. Blank: search current US English news." /></Field><Field label="DreamFace profile" hint="Auto dùng nhiều profile sẵn sàng. Chọn một profile thì các video tạo MC lần lượt trên profile đó."><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="auto">Auto · daily rotation</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.status}</option>)}</select></Field></div><div className="production-render-rules"><strong>Quy tắc render</strong><span>MC dùng ảnh đã chọn hoặc xoay vòng theo số video mỗi ảnh, độc lập với profile DreamFace.</span><span>Auto luân phiên profile sẵn sàng theo số tác vụ AI đồng thời trong Cài đặt.</span><span>Mỗi video có lời đọc, thứ tự ảnh và chuyển động riêng.</span><span>Xuất video dùng giới hạn “Video render song song”, áp dụng chung cho News và timeline.</span></div></details>
      <label className="toggle-field production-auto-content"><input type="checkbox" checked={autoCreateContent} onChange={(event) => setAutoCreateContent(event.target.checked)} /><span><strong>Tự tạo Content sau khi render</strong><small>{autoCreateContent ? "Sau khi có video, LLM sẽ tạo Content và báo lỗi ngay trong Queue/Content nếu không tạo được." : "Chỉ tạo video. Vào Content để chọn video và tạo bài sau."}</small></span></label>
      {!data.settings?.llm?.enabled && <Notice>Configure and enable your LLM in Settings to start automatic production.</Notice>}
      {(mode === "product" || engine === "dreamface") && !accounts.some((account) => account.status === "ready") && <p className="small muted">DreamFace MC videos wait in Queue until a verified profile is ready. <button type="button" className="inline-link" onClick={() => navigate?.("accounts")}>Open accounts</button></p>}
      <div className="production-actions"><span className="small muted">Output được gắn riêng là {mode === "news" ? "News" : "Product"}; Content {autoCreateContent ? "sẽ tạo sau render" : "để tạo sau"}.</span><Button type="submit" variant="primary" busy={busy} disabled={!data.settings?.llm?.enabled || mode === 'news' && (newsSave.saving || Boolean(newsSave.error))}><Sparkles size={16} /> Create {count || 1} video{Number(count) === 1 ? "" : "s"}</Button></div>
    </form>

    {batches.length > 0 && <div className="production-batches">
      <div className="production-batches-heading"><div><span className="hub-kicker">RENDER RECORDS</span><strong>Recent video records</strong></div><small>Each record keeps its source, progress, retry and Content handoff.</small></div>
      <ProductionBatchRecords batches={batches} data={data} notify={notify} navigate={navigate} focusedIds={[...focusedSet]} />
    </div>}
  </section>;
}
