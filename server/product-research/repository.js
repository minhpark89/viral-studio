import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { StudioError } from "../store.js";

// Product-only storage. Research history never expands or rewrites News data.
export class ResearchRepository {
  constructor(root, { now = Date.now } = {}) {
    this.now = now;
    const directory = path.join(root, "product-research");
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "research.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (
        kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS documents_project ON documents(kind,project_id,updated_at);
      CREATE TABLE IF NOT EXISTS snapshots (
        entity_id TEXT NOT NULL, observed_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(entity_id,observed_at));
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, created_at TEXT NOT NULL,
        units INTEGER NOT NULL, status TEXT NOT NULL, records INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS requests_provider ON requests(provider,created_at);
      CREATE TABLE IF NOT EXISTS cache (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, body TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  timestamp() {
    return new Date(this.now()).toISOString();
  }
  get(kind, id) {
    const row = this.db
      .prepare("SELECT body FROM documents WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(row.body) : null;
  }
  require(kind, id, projectId) {
    const value = this.get(kind, id);
    if (!value || (projectId && value.projectId !== projectId))
      throw new StudioError(
        "Không tìm thấy dữ liệu Product trong dự án.",
        "PRODUCT_RESEARCH_NOT_FOUND",
        404,
      );
    return value;
  }
  put(kind, value) {
    const doc = {
      ...value,
      id: value.id || randomUUID(),
      updatedAt: this.timestamp(),
    };
    this.db
      .prepare(
        "INSERT INTO documents(kind,id,project_id,body,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET project_id=excluded.project_id,body=excluded.body,updated_at=excluded.updated_at",
      )
      .run(
        kind,
        doc.id,
        doc.projectId || "",
        JSON.stringify(doc),
        doc.updatedAt,
      );
    return doc;
  }
  patch(kind, id, patch) {
    return this.put(kind, { ...this.require(kind, id), ...patch, id });
  }
  list(kind, projectId = null, limit = 100) {
    const count = Math.min(1000, Math.max(1, Number(limit) || 100));
    const rows =
      projectId === null
        ? this.db
            .prepare(
              "SELECT body FROM documents WHERE kind=? ORDER BY updated_at DESC LIMIT ?",
            )
            .all(kind, count)
        : this.db
            .prepare(
              "SELECT body FROM documents WHERE kind=? AND project_id=? ORDER BY updated_at DESC LIMIT ?",
            )
            .all(kind, projectId, count);
    return rows.map((row) => JSON.parse(row.body));
  }
  remove(kind, id) {
    this.db
      .prepare("DELETE FROM documents WHERE kind=? AND id=?")
      .run(kind, id);
  }
  observe(record) {
    // Only genuine observations go into the time series. Never backfill a video.
    const point = {
      observedAt: record.observedAt,
      metrics: record.metrics,
      provider: record.provider,
      measurement: record.measurement,
    };
    this.db
      .prepare(
        "INSERT OR IGNORE INTO snapshots(entity_id,observed_at,body) VALUES(?,?,?)",
      )
      .run(record.id, point.observedAt, JSON.stringify(point));
    this.put("evidence", record);
    return this.history(record.id);
  }
  history(id, limit = 120) {
    return this.db
      .prepare(
        "SELECT body FROM snapshots WHERE entity_id=? ORDER BY observed_at DESC LIMIT ?",
      )
      .all(id, limit)
      .map((row) => JSON.parse(row.body))
      .reverse();
  }
  cached(id) {
    const row = this.db
      .prepare("SELECT body,expires_at FROM cache WHERE id=?")
      .get(id);
    return row && row.expires_at > this.now() ? JSON.parse(row.body) : null;
  }
  cache(id, value, ttlMs) {
    this.db
      .prepare(
        "INSERT INTO cache VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,body=excluded.body",
      )
      .run(id, this.now() + ttlMs, JSON.stringify(value));
  }
  usage(provider) {
    const date = this.timestamp();
    const row = this.db
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN created_at>=? THEN units ELSE 0 END),0) AS daily,
      COALESCE(SUM(units),0) AS monthly,
      COALESCE(SUM(records),0) AS records
      FROM requests WHERE provider=? AND created_at>=?`,
      )
      .get(date.slice(0, 10), provider, date.slice(0, 7));
    return { ...row, resetTimezone: "UTC" };
  }
  reserve(provider, { dailyLimit = 20, monthlyLimit = 300 } = {}, units = 1) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const used = this.usage(provider);
      if (
        used.daily + units > dailyLimit ||
        used.monthly + units > monthlyLimit
      )
        throw new StudioError(
          "Đã chạm giới hạn lượt API Product đã đặt. Tăng giới hạn trong Kết nối nguồn nếu cần.",
          "RESEARCH_BUDGET_EXCEEDED",
          409,
        );
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO requests(id,provider,created_at,units,status) VALUES(?,?,?,?,?)",
        )
        .run(id, provider, this.timestamp(), units, "reserved");
      this.db.exec("COMMIT");
      return id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  finishRequest(id, status, records = 0) {
    this.db
      .prepare("UPDATE requests SET status=?,records=? WHERE id=?")
      .run(status, records, id);
  }
  prune() {
    this.db.prepare("DELETE FROM cache WHERE expires_at<?").run(this.now());
    // Snapshots have independent retention; deleting a cached response is harmless.
  }
  close() {
    this.db.close();
  }
}
