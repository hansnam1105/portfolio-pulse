CREATE TYPE "public"."briefing_status" AS ENUM('pending', 'running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('KRW', 'USD');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('ko', 'en');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('KRX', 'US');--> statement-breakpoint
CREATE TYPE "public"."news_kind" AS ENUM('news', 'disclosure');--> statement-breakpoint
CREATE TYPE "public"."news_source" AS ENUM('finnhub', 'naver', 'dart');--> statement-breakpoint
CREATE TYPE "public"."relevance" AS ENUM('primary', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'neutral', 'negative', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('buy', 'sell', 'set_quantity', 'remove');--> statement-breakpoint
CREATE TABLE "briefing" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "briefing_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"briefing_date" date NOT NULL,
	"status" "briefing_status" DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone,
	"model" text,
	"prompt_version" text,
	"input_digest" text,
	"overview_md" text,
	"token_usage" jsonb,
	"degraded_sources" text[] DEFAULT '{}' NOT NULL,
	"error" text,
	CONSTRAINT "briefing_briefing_date_unique" UNIQUE("briefing_date")
);
--> statement-breakpoint
CREATE TABLE "briefing_item" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "briefing_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"briefing_id" bigint NOT NULL,
	"security_id" bigint NOT NULL,
	"headline" text NOT NULL,
	"body_md" text NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"cited_news_ids" bigint[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "briefing_item_briefing_security_unique" UNIQUE("briefing_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "fx_rate_daily" (
	"pair" text NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(24, 8) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rate_daily_pair_rate_date_pk" PRIMARY KEY("pair","rate_date")
);
--> statement-breakpoint
CREATE TABLE "holding" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "holding_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"snapshot_id" bigint NOT NULL,
	"security_id" bigint NOT NULL,
	"raw_label" text NOT NULL,
	"quantity" numeric(24, 8),
	"avg_cost" numeric(24, 8),
	"cost_basis_total" numeric(24, 8) NOT NULL,
	"market_value_at_upload" numeric(24, 8) NOT NULL,
	"currency" "currency" NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "holding_snapshot_security_unique" UNIQUE("snapshot_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_name" text NOT NULL,
	"run_date" date NOT NULL,
	"status" "briefing_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_run_job_name_run_date_unique" UNIQUE("job_name","run_date")
);
--> statement-breakpoint
CREATE TABLE "macro_observation" (
	"series_code" text NOT NULL,
	"obs_date" date NOT NULL,
	"value" numeric(24, 8) NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "macro_observation_series_code_obs_date_pk" PRIMARY KEY("series_code","obs_date")
);
--> statement-breakpoint
CREATE TABLE "manual_transaction" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"security_id" bigint NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"quantity" numeric(24, 8),
	"price" numeric(24, 8),
	"fees" numeric(24, 8) DEFAULT '0' NOT NULL,
	"cost_basis_total" numeric(24, 8),
	"currency" "currency" NOT NULL,
	"transaction_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"superseded_by_snapshot_id" bigint
);
--> statement-breakpoint
CREATE TABLE "news_item" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "news_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "news_kind" NOT NULL,
	"source" "news_source" NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"url_sha256" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"lang" "lang" NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "news_item_url_sha256_unique" UNIQUE("url_sha256")
);
--> statement-breakpoint
CREATE TABLE "news_link" (
	"news_item_id" bigint NOT NULL,
	"security_id" bigint NOT NULL,
	"relevance" "relevance" NOT NULL,
	CONSTRAINT "news_link_news_item_id_security_id_pk" PRIMARY KEY("news_item_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "portfolio_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"as_of_date" date NOT NULL,
	"source_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"broker" text DEFAULT 'samsung-securities' NOT NULL,
	"profile_version" text NOT NULL,
	"row_count" integer NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "portfolio_snapshot_file_sha256_unique" UNIQUE("file_sha256")
);
--> statement-breakpoint
CREATE TABLE "price_daily" (
	"security_id" bigint NOT NULL,
	"trade_date" date NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"prev_close" numeric(24, 8),
	"currency" "currency" NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "price_daily_security_id_trade_date_pk" PRIMARY KEY("security_id","trade_date")
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_call_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provider_call_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "security" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market" "market" NOT NULL,
	"symbol" text NOT NULL,
	"name_local" text NOT NULL,
	"name_en" text,
	"currency" "currency" NOT NULL,
	"isin" text,
	"sector" text,
	"corp_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	CONSTRAINT "security_market_symbol_unique" UNIQUE("market","symbol")
);
--> statement-breakpoint
CREATE TABLE "security_alias" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_alias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"security_id" bigint NOT NULL,
	"raw_label" text NOT NULL,
	"note" text,
	CONSTRAINT "security_alias_raw_label_unique" UNIQUE("raw_label")
);
--> statement-breakpoint
ALTER TABLE "briefing_item" ADD CONSTRAINT "briefing_item_briefing_id_briefing_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_item" ADD CONSTRAINT "briefing_item_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_snapshot_id_portfolio_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portfolio_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_superseded_by_snapshot_id_portfolio_snapshot_id_fk" FOREIGN KEY ("superseded_by_snapshot_id") REFERENCES "public"."portfolio_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_link" ADD CONSTRAINT "news_link_news_item_id_news_item_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_link" ADD CONSTRAINT "news_link_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_daily" ADD CONSTRAINT "price_daily_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_alias" ADD CONSTRAINT "security_alias_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_transaction_security_date_idx" ON "manual_transaction" USING btree ("security_id","transaction_date");