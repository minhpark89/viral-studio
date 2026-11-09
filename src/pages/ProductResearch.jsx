import { useEffect, useState } from "react";
import {
  Search,
  ExternalLink,
  ArrowRight,
  Bookmark,
  Check,
  KeyRound,
} from "lucide-react";
import { api } from "../api.js";
import { Button, Field, Notice } from "../components.jsx";
import {
  ProductRevenueChart,
  ShopRevenueBars,
  money,
} from "./ProductRevenueChart.jsx";
import "./product.css";
import { ProductFreeResearchPage } from "./ProductFreeResearch.jsx";
import { ProductSourceLink } from "./ProductSourceLink.jsx";
import { ProductResearchHub } from "./ProductResearchHub.jsx";

export function ProductResearchPage(props) {
  const [mode, setMode] = useState("hub");
  return (
    <div className="product-research-shell">
      <div
        className="market-filter product-research-tabs"
        aria-label="Nguồn nghiên cứu"
      >
        <button className={mode === 'hub' ? 'active' : ''} onClick={() => setMode('hub')}>Research đa nguồn</button>
        <button
          className={mode === "free" ? "active" : ""}
          onClick={() => setMode("free")}
        >
          Research Free
        </button>
        <button
          className={mode === "gmv" ? "active" : ""}
          onClick={() => setMode("gmv")}
        >
          Doanh thu · FastMoss
        </button>
      </div>
      {mode === "hub" ? <ProductResearchHub {...props} key={props.project.id} /> : mode === "free" ? (
        <ProductFreeResearchPage {...props} />
      ) : (
        <ProductMarketPage {...props} />
      )}
    </div>
  );
}

const statusNames = {
  new: "Mới",
  shortlisted: "Đã nhặt",
  producing: "Đang làm",
  dismissed: "Bỏ qua",
};
export function ProductMarketPage({ data, project, notify, navigate }) {
  const [connection, setConnection] = useState(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [keywords, setKeywords] = useState(""),
    [limit, setLimit] = useState(5),
    [minWeeklyGmv, setMinGmv] = useState(1000),
    [minGrowth, setGrowth] = useState(50),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [focus, setFocus] = useState(""),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all"),
    [compare, setCompare] = useState([]);
  const [autoShortlist, setAutoShortlist] = useState(true);
  const scans = (data.productScans || [])
      .filter((s) => s.projectId === project.id)
      .slice()
      .reverse(),
    scan = scans.find((s) => s.id === focus) || scans[0];
  const products = scan?.products || [],
    visible = products.filter(
      (p) =>
        filter === "all" ||
        (filter === "promising" && p.recommendation.eligible) ||
        p.management === filter,
    );
  const product = products.find((p) => p.id === selected) || visible[0],
    chartProducts = product
      ? [
          product,
          ...products.filter(
            (p) => p.id !== product.id && compare.includes(p.id),
          ),
        ].slice(0, 3)
      : [];
  useEffect(() => {
    api("/product-market/connection")
      .then(setConnection)
      .catch((e) => notify(e.message, "error"));
  }, [notify]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setConnection(await api("/product-market/connection", { key }));
      setKey("");
      notify("Đã lưu kết nối trên máy này. Quét sẽ kiểm tra quyền API.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/product-market/scans", {
        projectId: project.id,
        requestId,
        keywords,
        limit: Number(limit),
        minWeeklyGmv: Number(minWeeklyGmv),
        minGrowth: Number(minGrowth),
        autoShortlist,
      });
      setFocus(r.id);
      setSelected("");
      setCompare([]);
      setRequestId(crypto.randomUUID());
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const manage = async (p, status) => {
    try {
      await api(
        `/product-market/scans/${scan.id}/products/${p.id}`,
        { status },
        "PATCH",
      );
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const prepare = async (p) => {
    setBusy(true);
    try {
      const draft = await api(
        `/product-market/scans/${scan.id}/products/${p.id}/prepare`,
        {},
      );
      localStorage.setItem(
        `product-draft-${project.id}`,
        JSON.stringify(draft),
      );
      navigate("product");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page product-research-page">
      <div className="page-heading">
        <div>
          <h1>AI Research · US</h1>
          <p>
            Phát hiện sản phẩm đang tăng doanh thu, đối chiếu shop và chọn ý
            tưởng video.
          </p>
        </div>
        <span className="product-market-chip">TikTok Shop US · USD</span>
      </div>
      <details
        className="product-card product-connection"
        open={!connection?.configured}
      >
        <summary>
          <KeyRound size={16} /> Nguồn dữ liệu: FastMoss ·{" "}
          {connection?.configured ? "Đã lưu key trên máy này" : "Chưa kết nối"}
        </summary>
        <form onSubmit={save}>
          <Field label="FastMoss client_secret">
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Nhập key API của tài khoản FastMoss"
              minLength={10}
              required
            />
          </Field>
          <Button type="submit" busy={busy}>
            Lưu kết nối
          </Button>
          <a
            href="https://developer.fastmoss.com/api/docs/guide/quickStart"
            target="_blank"
            rel="noreferrer"
          >
            Hướng dẫn API <ExternalLink size={13} />
          </a>
        </form>
        <p className="small muted">
          Key được mã hóa trong dữ liệu riêng của máy. Tài khoản cần quyền và
          quota API. Chỉ có biểu đồ khi nguồn trả số liệu; GMV là doanh số ước
          tính, chưa trừ hoàn hàng, phí và vốn.
        </p>
      </details>
      <form className="product-card market-scan-form" onSubmit={start}>
        <Field label="Sản phẩm / ngách (tiếng Anh)">
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            maxLength={150}
            placeholder="Ví dụ: insulated water bottle · để trống quét top US"
          />
        </Field>
        <Field label="Số sản phẩm">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[5, 10, 20].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="GMV 7 ngày tối thiểu ($)">
          <input
            type="number"
            min={0}
            max={10000000}
            value={minWeeklyGmv}
            onChange={(e) => setMinGmv(Number(e.target.value))}
          />
        </Field>
        <Field label="Tăng trưởng tối thiểu (%)">
          <input
            type="number"
            min={0}
            max={10000}
            value={minGrowth}
            onChange={(e) => setGrowth(Number(e.target.value))}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={
            !connection?.configured || scans.some((s) => s.status === "running")
          }
        >
          <Search size={16} /> Quét thị trường US
        </Button>
        <label className="market-scan-note market-compare">
          <input
            type="checkbox"
            checked={autoShortlist}
            onChange={(e) => setAutoShortlist(e.target.checked)}
          />{" "}
          Tự nhặt sản phẩm đạt “Ngon húp luôn” vào danh sách đề xuất
        </label>
        <p className="small muted market-scan-note">
          Mỗi sản phẩm đọc tối đa 28 ngày. Ưu tiên: đủ 14 ngày liên tiếp, GMV và
          tăng trưởng đạt ngưỡng, đà tăng 3 ngày cuối, có đơn ít nhất 5/7 ngày.
          Dữ liệu quá 3 ngày hoặc thiếu ngày sẽ không được gắn nhãn tốt.
        </p>
      </form>
      {!scan ? (
        <section className="product-card product-empty">
          <Search size={32} />
          <h2>Chưa có lần quét</h2>
          <p>
            Kết nối nguồn, nhập ngách rồi bấm quét. Kết quả và lựa chọn được lưu
            theo dự án trên máy này.
          </p>
        </section>
      ) : (
        <>
          <div className="product-scan-heading">
            <Field label="Lịch sử quét">
              <select
                value={scan.id}
                onChange={(e) => {
                  setFocus(e.target.value);
                  setSelected("");
                  setCompare([]);
                }}
              >
                {scans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.request.keywords || "Top US"} ·{" "}
                    {new Date(s.createdAt).toLocaleString()} · {s.status}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <strong>{scan.stage}</strong>
              <small>
                {products.length} sản phẩm · {scan.apiCalls} lượt API ·{" "}
                {products.filter((p) => p.recommendation.eligible).length} đề
                xuất
              </small>
            </div>
          </div>
          {scan.error && <Notice>{scan.error}</Notice>}
          {!!scan.errors?.length && (
            <details className="product-card">
              <summary>{scan.errors.length} cảnh báo từ nguồn</summary>
              {scan.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </details>
          )}
          <div className="market-filter" role="group" aria-label="Lọc kết quả">
            {[
              ["all", "Tất cả"],
              ["promising", "Ngon húp luôn"],
              ["shortlisted", "Đã nhặt"],
              ["producing", "Đang làm"],
              ["dismissed", "Bỏ qua"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="market-results-grid">
            <section
              className="product-card market-products"
              aria-label="Sản phẩm tìm thấy"
            >
              {!visible.length && (
                <p className="muted">Chưa có sản phẩm phù hợp bộ lọc này.</p>
              )}
              {visible
                .slice()
                .sort(
                  (a, b) =>
                    (b.recommendation.score || 0) -
                    (a.recommendation.score || 0),
                )
                .map((p) => (
                  <article
                    key={p.id}
                    className={`market-product ${product?.id === p.id ? "selected" : ""}`}
                  >
                    <button
                      className="market-product-select"
                      onClick={() => setSelected(p.id)}
                    >
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt="" loading="lazy" />
                      )}
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.sellerName}</small>
                      </span>
                    </button>
                    <div className="market-product-metrics">
                      <span>
                        GMV 7 ngày<b>{money(p.recommendation.current7)}</b>
                      </span>
                      <span>
                        Tăng trưởng
                        <b>
                          {p.recommendation.growth == null
                            ? "Chưa đủ"
                            : `${p.recommendation.growth >= 0 ? "+" : ""}${p.recommendation.growth.toFixed(1)}%`}
                        </b>
                      </span>
                    </div>
                    <div className="market-product-bottom">
                      <span
                        className={`market-verdict ${p.recommendation.eligible ? "good" : ""}`}
                      >
                        {p.recommendation.eligible && <Check size={13} />}{" "}
                        {p.recommendation.label}
                      </span>
                      <small>{statusNames[p.management]}</small>
                    </div>
                    <label className="market-compare">
                      <input
                        type="checkbox"
                        checked={compare.includes(p.id)}
                        onChange={(e) =>
                          setCompare(
                            e.target.checked
                              ? [...compare.slice(-1), p.id]
                              : compare.filter((id) => id !== p.id),
                          )
                        }
                      />{" "}
                      So sánh đường biểu đồ
                    </label>
                  </article>
                ))}
            </section>
            <div className="market-analysis">
              {product && (
                <>
                  <section className="product-card">
                    <div className="product-card-heading">
                      <h2>{product.name}</h2>
                      <span
                        className={`market-verdict ${product.recommendation.eligible ? "good" : ""}`}
                      >
                        {product.recommendation.label}
                      </span>
                    </div>
                    <p className="small muted">
                      {product.sellerName} · Kiểm tra{" "}
                      {new Date(product.trend.checkedAt).toLocaleString()} ·
                      FastMoss · US/USD
                    </p>
                    <ProductRevenueChart products={chartProducts} />
                    <div className="product-reasons">
                      {product.recommendation.eligible && (
                        <p>
                          <strong>Đề xuất làm thử:</strong> video 15 giây gồm mở
                          đầu thu hút, demo sản phẩm và CTA. Product Studio sẽ
                          nghiên cứu cách dựng và đối chiếu đặc điểm sản phẩm
                          trước khi tạo.
                        </p>
                      )}
                      <strong>
                        Lý do đánh giá
                        {product.recommendation.score != null
                          ? ` · điểm ${product.recommendation.score}/100`
                          : ""}
                      </strong>
                      <ul>
                        {product.recommendation.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      <small>
                        Đề xuất nghiên cứu/làm thử; không bảo đảm bán được. Các
                        listing cùng từ khóa có thể khác mẫu, cần đối chiếu
                        trước khi coi là cùng sản phẩm.
                      </small>
                    </div>
                    <div className="product-actions">
                      <Button onClick={() => manage(product, "shortlisted")}>
                        <Bookmark size={14} /> Nhặt sản phẩm
                      </Button>
                      <Button
                        variant="primary"
                        busy={busy}
                        onClick={() => prepare(product)}
                      >
                        Đề xuất làm video <ArrowRight size={14} />
                      </Button>
                      <select
                        aria-label="Trạng thái sản phẩm"
                        value={product.management}
                        onChange={(e) => manage(product, e.target.value)}
                      >
                        {Object.entries(statusNames).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <a
                        href={product.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Mở nguồn <ExternalLink size={13} />
                      </a>
                      {product.url && (
                        <a href={product.url} target="_blank" rel="noreferrer">
                          Listing sản phẩm
                        </a>
                      )}
                    </div>
                  </section>
                  <section className="product-card">
                    <h2>Doanh thu các shop đối thủ</h2>
                    <ShopRevenueBars products={products} />
                  </section>
                  <section className="product-card">
                    <h2>Video bán sản phẩm này</h2>
                    {!product.videos.length ? (
                      <p className="muted">Nguồn chưa trả video liên quan.</p>
                    ) : (
                      product.videos.map((v) => (
                        <article className="market-video" key={v.id}>
                          <ProductSourceLink href={v.url || v.sourceUrl}>
                            {v.title || `Video ${v.id}`}
                          </ProductSourceLink>
                          <small>
                            {v.views == null
                              ? "Chưa có lượt xem"
                              : `${v.views.toLocaleString()} lượt xem`}{" "}
                            · GMV ước tính {money(v.gmv)} ·{" "}
                            {v.units ?? "Chưa có"} đơn vị bán
                          </small>
                        </article>
                      ))
                    )}
                    <p className="small muted">
                      Danh sách từ nguồn trong kỳ 28 ngày. Product Studio sẽ
                      nghiên cứu thêm khung hình và cách dựng từ các video công
                      khai đọc được.
                    </p>
                  </section>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
