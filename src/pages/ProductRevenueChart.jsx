import { useState } from "react";

export const money = (value) =>
  value == null
    ? "Chưa có"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value);
const compact = (value) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const colors = ["#71e5c2", "#8db8ff", "#fbbf77"];

export function ProductRevenueChart({ products }) {
  const [active, setActive] = useState(null);
  const series = products.slice(0, 3),
    dates = [
      ...new Set(series.flatMap((p) => p.trend.series.map((r) => r.date))),
    ].sort();
  if (!dates.length)
    return <p className="muted">Chưa có chuỗi doanh thu từ nguồn.</p>;
  const first = Date.parse(dates[0]),
    last = Date.parse(dates.at(-1)),
    max =
      Math.max(
        1,
        ...series.flatMap((p) => p.trend.series.map((r) => r.revenue)),
      ) * 1.1;
  const x = (date) =>
      58 +
      ((Date.parse(date) - first) / Math.max(86400000, last - first)) * 700,
    y = (value) => 230 - (value / max) * 200;
  const segments = (rows) => {
    const groups = [];
    for (const r of rows) {
      const tail = groups.at(-1);
      if (
        !tail ||
        Date.parse(r.date) - Date.parse(tail.at(-1).date) !== 86400000
      )
        groups.push([r]);
      else tail.push(r);
    }
    return groups;
  };
  const point = active || dates.at(-1);
  return (
    <div className="revenue-chart">
      <svg
        viewBox="0 0 790 275"
        role="img"
        aria-label="Biểu đồ GMV sản phẩm theo ngày, USD, trục doanh thu bắt đầu từ 0"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1="58"
              x2="758"
              y1={y(max * t)}
              y2={y(max * t)}
              className="chart-grid"
            />
            <text x="49" y={y(max * t) + 4} textAnchor="end">
              ${compact(max * t)}
            </text>
          </g>
        ))}
        {series.map((p, i) => (
          <g key={p.id}>
            {segments(p.trend.series).map((rows, j) => (
              <polyline
                key={j}
                points={rows
                  .map((r) => `${x(r.date)},${y(r.revenue)}`)
                  .join(" ")}
                fill="none"
                stroke={colors[i]}
                strokeWidth="2.5"
              />
            ))}
            {p.trend.series.map((r) => (
              <circle
                key={r.date}
                cx={x(r.date)}
                cy={y(r.revenue)}
                r={r.date === point ? 5 : 2.5}
                fill={r.provisional ? "#18212b" : colors[i]}
                stroke={colors[i]}
              >
                <title>
                  {p.name}: {r.date}, {money(r.revenue)}
                  {r.provisional ? " (ngày chưa hoàn tất)" : ""}
                </title>
              </circle>
            ))}
          </g>
        ))}
        {dates
          .filter((_, i) => i === 0 || i === dates.length - 1 || i % 7 === 0)
          .map((d) => (
            <text key={d} x={x(d)} y="257" textAnchor="middle">
              {d.slice(5)}
            </text>
          ))}
        {dates.map((d) => (
          <rect
            key={d}
            x={x(d) - 9}
            y="25"
            width="18"
            height="210"
            fill="transparent"
            onMouseEnter={() => setActive(d)}
            onFocus={() => setActive(d)}
            tabIndex={0}
            aria-label={`Xem số liệu ngày ${d}`}
          />
        ))}
      </svg>
      <div className="chart-readout">
        <strong>{point}</strong>
        {series.map((p, i) => {
          const r = p.trend.series.find((r) => r.date === point);
          return (
            <span key={p.id} style={{ borderColor: colors[i] }}>
              {p.name.slice(0, 58)}:{" "}
              <b>{r ? money(r.revenue) : "Thiếu dữ liệu"}</b>
              {r?.provisional ? " · chưa chốt ngày" : ""}
            </span>
          );
        })}
      </div>
      <p className="small muted">
        GMV ước tính / ngày · USD · trục bắt đầu từ 0. Ngắt đường ở ngày thiếu;
        ngày chưa hoàn tất không dùng tính tăng trưởng.
      </p>
      <details>
        <summary>Bảng số liệu đầy đủ</summary>
        <div className="product-table-wrap">
          <table className="product-data-table">
            <thead>
              <tr>
                <th>Ngày</th>
                {series.map((p) => (
                  <th key={p.id}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d}>
                    <td>{d}</td>
                    {series.map((p) => {
                      const r = p.trend.series.find((r) => r.date === d);
                      return (
                        <td key={p.id}>
                          {r ? money(r.revenue) : "Thiếu dữ liệu"}
                          {r?.provisional ? " *" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function ShopRevenueBars({ products }) {
  const shops = [
    ...new Map(
      products
        .filter((p) => p.shopRevenue7?.revenue != null)
        .map((p) => [p.sellerId, p]),
    ).values(),
  ].sort((a, b) => b.shopRevenue7.revenue - a.shopRevenue7.revenue);
  if (!shops.length)
    return (
      <p className="muted">
        Nguồn chưa trả doanh thu toàn shop. Không suy ra tổng shop từ một sản
        phẩm.
      </p>
    );
  const max = Math.max(1, ...shops.map((p) => p.shopRevenue7.revenue));
  return (
    <div className="shop-bars">
      {shops.map((p) => (
        <div key={p.sellerId}>
          <div>
            <span>{p.sellerName}</span>
            <b>{money(p.shopRevenue7.revenue)}</b>
          </div>
          <div className="shop-bar-track">
            <div
              style={{ width: `${(p.shopRevenue7.revenue / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <small>
        GMV ước tính toàn shop trong 7 ngày do FastMoss cung cấp. Nguồn này
        không có chuỗi doanh thu toàn shop theo ngày; kỳ dữ liệu có thể khác 7
        ngày hoàn tất trên biểu đồ sản phẩm.
      </small>
    </div>
  );
}
