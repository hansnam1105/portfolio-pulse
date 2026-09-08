/**
 * Drizzle schema — portfolio-pulse.
 *
 * Source of truth: docs/specs/0001-portfolio-pulse-system-design.md § Data model,
 * refined by ADR-0004 (manual_transaction, portfolio_snapshot.as_of_date).
 *
 * Money and quantity columns are `numeric` (arbitrary precision) and MUST be
 * handled in TypeScript only via src/lib/money.ts (decimal.js) — never as
 * IEEE-754 `number` (Computational Integrity standard).
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const marketEnum = pgEnum("market", ["KRX", "US"]);
export const currencyEnum = pgEnum("currency", ["KRW", "USD"]);
export const transactionKindEnum = pgEnum("transaction_kind", [
  "buy",
  "sell",
  "set_quantity",
  "remove",
]);
export const newsKindEnum = pgEnum("news_kind", ["news", "disclosure"]);
export const newsSourceEnum = pgEnum("news_source", ["finnhub", "naver", "dart"]);
export const langEnum = pgEnum("lang", ["ko", "en"]);
export const relevanceEnum = pgEnum("relevance", ["primary", "mentioned"]);
export const briefingStatusEnum = pgEnum("briefing_status", [
  "pending",
  "running",
  "ok",
  "partial",
  "failed",
]);
export const sentimentEnum = pgEnum("sentiment", [
  "positive",
  "neutral",
  "negative",
  "unclear",
]);
// job_run.status: the spec leaves the enum's values unspecified ("status enum(...)").
// Reusing briefingStatusEnum's value set here because it matches the job lifecycle
// described in spec 0001 § Job sequence exactly (claim -> running -> ok|partial|failed).
export const jobRunStatusEnum = briefingStatusEnum;

// ---------------------------------------------------------------------------
// security / security_alias
// ---------------------------------------------------------------------------

export const security = pgTable(
  "security",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    market: marketEnum("market").notNull(),
    symbol: text("symbol").notNull(), // '005930' (KRX 6-digit) | 'AAPL'
    nameLocal: text("name_local").notNull(), // 삼성전자
    nameEn: text("name_en"),
    currency: currencyEnum("currency").notNull(),
    isin: text("isin"),
    sector: text("sector"),
    corpCode: text("corp_code"), // DART corp_code, KRX only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  },
  (t) => [unique("security_market_symbol_unique").on(t.market, t.symbol)],
);

export const securityAlias = pgTable(
  "security_alias",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    rawLabel: text("raw_label").notNull(),
    note: text("note"),
  },
  (t) => [unique("security_alias_raw_label_unique").on(t.rawLabel)],
);

// ---------------------------------------------------------------------------
// portfolio_snapshot / holding
// ---------------------------------------------------------------------------

export const portfolioSnapshot = pgTable("portfolio_snapshot", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  // ADR-0004: effective date of the export, Asia/Seoul. Defaults to the upload
  // date and is user-editable at commit. This is the manual-transaction
  // supersession boundary -- never uploadedAt.
  asOfDate: date("as_of_date").notNull(),
  sourceFilename: text("source_filename").notNull(),
  fileSha256: text("file_sha256").notNull().unique(),
  broker: text("broker").notNull().default("samsung-securities"),
  profileVersion: text("profile_version").notNull(),
  rowCount: integer("row_count").notNull(),
  warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
});

export const holding = pgTable(
  "holding",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    snapshotId: bigint("snapshot_id", { mode: "number" })
      .notNull()
      .references(() => portfolioSnapshot.id),
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    // v2: 종목명 verbatim -- the ONLY security identifier the export gives.
    rawLabel: text("raw_label").notNull(),
    // v2: NULLABLE. profile v1 supplies no share count.
    quantity: numeric("quantity", { precision: 24, scale: 8 }),
    avgCost: numeric("avg_cost", { precision: 24, scale: 8 }),
    // v2: 매수금액. EXACT, always present. Total, not per-share.
    costBasisTotal: numeric("cost_basis_total", { precision: 24, scale: 8 }).notNull(),
    // v2: 평가금액. EXACT, always present.
    marketValueAtUpload: numeric("market_value_at_upload", {
      precision: 24,
      scale: 8,
    }).notNull(),
    currency: currencyEnum("currency").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [unique("holding_snapshot_security_unique").on(t.snapshotId, t.securityId)],
);

// ---------------------------------------------------------------------------
// manual_transaction (ADR-0004)
// ---------------------------------------------------------------------------

export const manualTransaction = pgTable(
  "manual_transaction",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    kind: transactionKindEnum("kind").notNull(),
    // required: buy, sell, set_quantity
    quantity: numeric("quantity", { precision: 24, scale: 8 }),
    // per-share, required: buy, sell
    price: numeric("price", { precision: 24, scale: 8 }),
    fees: numeric("fees", { precision: 24, scale: 8 }).notNull().default("0"),
    // optional override, used with set_quantity
    costBasisTotal: numeric("cost_basis_total", { precision: 24, scale: 8 }),
    currency: currencyEnum("currency").notNull(),
    // Asia/Seoul; the ordering + supersession key
    transactionDate: date("transaction_date").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // user "delete" = soft void; rows are never removed
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    supersededBySnapshotId: bigint("superseded_by_snapshot_id", {
      mode: "number",
    }).references(() => portfolioSnapshot.id),
  },
  (t) => [
    index("manual_transaction_security_date_idx").on(t.securityId, t.transactionDate),
  ],
);

// ---------------------------------------------------------------------------
// price_daily / fx_rate_daily / macro_observation
// ---------------------------------------------------------------------------

export const priceDaily = pgTable(
  "price_daily",
  {
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    tradeDate: date("trade_date").notNull(),
    close: numeric("close", { precision: 24, scale: 8 }).notNull(),
    prevClose: numeric("prev_close", { precision: 24, scale: 8 }),
    currency: currencyEnum("currency").notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.securityId, t.tradeDate] })],
);

export const fxRateDaily = pgTable(
  "fx_rate_daily",
  {
    pair: text("pair").notNull(), // 'USDKRW' from ECOS
    rateDate: date("rate_date").notNull(),
    rate: numeric("rate", { precision: 24, scale: 8 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pair, t.rateDate] })],
);

export const macroObservation = pgTable(
  "macro_observation",
  {
    seriesCode: text("series_code").notNull(), // ECOS: base rate, CPI, USD/KRW
    obsDate: date("obs_date").notNull(),
    value: numeric("value", { precision: 24, scale: 8 }).notNull(),
    unit: text("unit").notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.seriesCode, t.obsDate] })],
);

// ---------------------------------------------------------------------------
// news_item / news_link
// ---------------------------------------------------------------------------

export const newsItem = pgTable("news_item", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  kind: newsKindEnum("kind").notNull(),
  source: newsSourceEnum("source").notNull(),
  externalId: text("external_id"),
  url: text("url").notNull(),
  urlSha256: text("url_sha256").notNull().unique(), // dedupe across sources
  title: text("title").notNull(),
  summary: text("summary"),
  lang: langEnum("lang").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
});

export const newsLink = pgTable(
  "news_link",
  {
    newsItemId: bigint("news_item_id", { mode: "number" })
      .notNull()
      .references(() => newsItem.id),
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    relevance: relevanceEnum("relevance").notNull(),
  },
  (t) => [primaryKey({ columns: [t.newsItemId, t.securityId] })],
);

// ---------------------------------------------------------------------------
// briefing / briefing_item (ADR-0003)
// ---------------------------------------------------------------------------

export const briefing = pgTable("briefing", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  briefingDate: date("briefing_date").notNull().unique(),
  status: briefingStatusEnum("status").notNull().default("pending"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  model: text("model"), // resolved GEMINI_MODEL, recorded not assumed
  promptVersion: text("prompt_version"),
  // sha256 of the prompt inputs; skip regen if unchanged
  inputDigest: text("input_digest"),
  overviewMd: text("overview_md"), // market/macro paragraph
  tokenUsage: jsonb("token_usage").$type<Record<string, unknown>>(),
  degradedSources: text("degraded_sources").array().notNull().default([]),
  error: text("error"),
});

export const briefingItem = pgTable(
  "briefing_item",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    briefingId: bigint("briefing_id", { mode: "number" })
      .notNull()
      .references(() => briefing.id),
    securityId: bigint("security_id", { mode: "number" })
      .notNull()
      .references(() => security.id),
    headline: text("headline").notNull(),
    bodyMd: text("body_md").notNull(),
    sentiment: sentimentEnum("sentiment").notNull(),
    // must be a subset of the news fed to the model
    citedNewsIds: bigint("cited_news_ids", { mode: "number" }).array().notNull().default([]),
  },
  (t) => [unique("briefing_item_briefing_security_unique").on(t.briefingId, t.securityId)],
);

// ---------------------------------------------------------------------------
// provider_cache / provider_call_log / job_run (ADR-0002)
// ---------------------------------------------------------------------------

export const providerCache = pgTable("provider_cache", {
  cacheKey: text("cache_key").primaryKey(),
  provider: text("provider").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const providerCallLog = pgTable("provider_call_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  provider: text("provider").notNull(),
  // query strings stripped before persisting (ADR-0002 §6 / spec § Security 8)
  endpoint: text("endpoint").notNull(),
  calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
  status: integer("status"),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms"),
  error: text("error"),
});

export const jobRun = pgTable(
  "job_run",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobName: text("job_name").notNull(),
    runDate: date("run_date").notNull(),
    status: jobRunStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    error: text("error"),
  },
  // makes the daily job idempotent
  (t) => [unique("job_run_job_name_run_date_unique").on(t.jobName, t.runDate)],
);
