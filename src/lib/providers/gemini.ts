import "server-only";

/**
 * Gemini client — builds the single batched daily-briefing prompt, requests
 * structured JSON output, Zod-validates it, and records token usage
 * (ADR-0003, spec 0001 § Computational Integrity).
 *
 * **The model output schema below has zero numeric fields, by construction.**
 * Every pre-computed figure (position value, P/L, price) is supplied to the
 * model as data in the prompt and is rendered in the UI straight from the
 * database — never from model text (spec 0001 § Computational Integrity:
 * "the Gemini model is explicitly forbidden from computing or restating
 * numbers"). Citations are constrained the same way: the model may only cite
 * news items by the opaque string `newsKey` tokens ("N1", "N2", ...) assigned
 * in the prompt, never by inventing a numeric database id, and
 * `resolveCitedNewsKeys` below re-validates that every citation the model
 * returns was actually present in the fed news set before it is trusted.
 *
 * Uses the public Gemini REST API directly (no SDK dependency) so the
 * request/response shape stays fully under this file's Zod control per
 * ADR-0002's "no unvalidated provider JSON in the domain layer" rule.
 */
import { z } from "zod";
import { requireEnv } from "./gateway";

export const GEMINI_REQUIRED_ENV = ["GEMINI_API_KEY"] as const;

// spec 0001 § Environment: "gemini 3.6 flash" as stated by the user.
// TODO(verify): confirm this model id exists in Google's current Gemini API
// model catalog before relying on it — no network verification was performed
// when this default was chosen (spec 0001 explicit caveat). The resolved
// value is always recorded on the `briefing.model` column, so a wrong
// default is a one-line env change, not a silent failure.
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export const PROMPT_VERSION = "portfolio-pulse-briefing/v1";

// ---------------------------------------------------------------------------
// Prompt input shape — pre-computed, decimal-safe figures only as strings
// ---------------------------------------------------------------------------

export interface BriefingNewsInput {
  /** Opaque citation key assigned for this prompt only, e.g. "N1". */
  newsKey: string;
  title: string;
  summary?: string;
  lang: "ko" | "en";
  source: string;
  publishedAt: string; // ISO 8601
}

export interface BriefingHoldingInput {
  /** Opaque key assigned for this prompt only, e.g. "S1". */
  securityKey: string;
  nameLocal: string;
  nameEn?: string;
  market: "KRX" | "US";
  /** Pre-computed, decimal-safe figures rendered as strings — the model must
   * reference them verbatim, never recompute or restate a different number. */
  quantityCurrent: string;
  quantityBasis: "exact" | "estimated";
  valueCurrent: string;
  unrealizedPl: string;
  currency: "KRW" | "USD";
  news: BriefingNewsInput[];
}

export interface BriefingMacroInput {
  baseRate?: string;
  cpi?: string;
  usdKrw?: string;
}

export interface BuildBriefingPromptInput {
  briefingDate: string; // YYYY-MM-DD, Asia/Seoul
  lang: "ko" | "en";
  macro: BriefingMacroInput;
  holdings: BriefingHoldingInput[];
  degradedSources: string[];
}

// ---------------------------------------------------------------------------
// Model output schema — NO bare numeric fields (see file header)
// ---------------------------------------------------------------------------

const sentimentSchema = z.enum(["positive", "neutral", "negative", "unclear"]);

const briefingItemOutputSchema = z.object({
  securityKey: z.string(),
  headline: z.string(),
  bodyMd: z.string(),
  sentiment: sentimentSchema,
  citedNewsKeys: z.array(z.string()).default([]),
});

const briefingOutputSchema = z.object({
  overviewMd: z.string(),
  items: z.array(briefingItemOutputSchema),
});

export type BriefingItemOutput = z.infer<typeof briefingItemOutputSchema>;
export type BriefingOutput = z.infer<typeof briefingOutputSchema>;

export interface GeminiTokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiBriefingResult {
  ok: boolean;
  data?: BriefingOutput;
  tokenUsage?: GeminiTokenUsage;
  model: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildBriefingPrompt(input: BuildBriefingPromptInput): string {
  const langLabel = input.lang === "ko" ? "Korean" : "English";
  const lines: string[] = [
    `You are writing a daily portfolio briefing in ${langLabel} for a single retail investor.`,
    "You will be given pre-computed figures and news for each holding. You must:",
    "- Reference the supplied figures verbatim in prose (e.g. describe direction/magnitude in words);",
    "  NEVER invent, recompute, or restate a different number than what is supplied.",
    "- Describe and contextualize only. Do NOT give investment advice or recommendations.",
    "- Cite news only by its exact newsKey token (e.g. \"N1\"); never invent a newsKey.",
    "- If a data source is degraded/missing for a holding, say so plainly rather than guessing.",
    "",
    `Briefing date (Asia/Seoul): ${input.briefingDate}`,
    `Degraded sources: ${input.degradedSources.length > 0 ? input.degradedSources.join(", ") : "none"}`,
    "",
    "Macro context:",
    `  Base rate: ${input.macro.baseRate ?? "unavailable"}`,
    `  CPI: ${input.macro.cpi ?? "unavailable"}`,
    `  USD/KRW: ${input.macro.usdKrw ?? "unavailable"}`,
    "",
    "Holdings:",
  ];

  for (const holding of input.holdings) {
    lines.push(
      `- [${holding.securityKey}] ${holding.nameLocal}${holding.nameEn ? ` (${holding.nameEn})` : ""} ` +
        `[${holding.market}/${holding.currency}]`,
      `    quantity: ${holding.quantityCurrent} (${holding.quantityBasis})`,
      `    value: ${holding.valueCurrent} ${holding.currency}`,
      `    unrealized P/L: ${holding.unrealizedPl} ${holding.currency}`,
      "    news:",
    );
    if (holding.news.length === 0) {
      lines.push("      (none available)");
    }
    for (const news of holding.news) {
      lines.push(`      [${news.newsKey}] (${news.lang}/${news.source}) ${news.title}${news.summary ? ` — ${news.summary}` : ""}`);
    }
  }

  lines.push(
    "",
    "Respond with JSON matching this shape exactly:",
    '{ "overviewMd": string, "items": [ { "securityKey": string, "headline": string, "bodyMd": string, "sentiment": "positive"|"neutral"|"negative"|"unclear", "citedNewsKeys": string[] } ] }',
    "Include exactly one item per holding securityKey listed above.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

const geminiApiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })),
        }),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

export async function callGeminiForBriefing(
  input: BuildBriefingPromptInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GeminiBriefingResult> {
  const { GEMINI_API_KEY } = requireEnv(GEMINI_REQUIRED_ENV, env);
  const model = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const prompt = buildBriefingPrompt(input);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    const rawBody = await response.json().catch(() => null);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, model, error: `Gemini returned HTTP ${response.status}` };
    }

    const parsedEnvelope = geminiApiResponseSchema.safeParse(rawBody);
    if (!parsedEnvelope.success) {
      return { ok: false, model, error: `Gemini envelope validation failed: ${parsedEnvelope.error.message}` };
    }

    const text = parsedEnvelope.data.candidates?.[0]?.content.parts
      .map((part) => part.text ?? "")
      .join("");
    if (!text) {
      return { ok: false, model, error: "Gemini response contained no text content" };
    }

    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(text);
    } catch {
      return { ok: false, model, error: "Gemini response text was not valid JSON" };
    }

    const parsedOutput = briefingOutputSchema.safeParse(jsonBody);
    if (!parsedOutput.success) {
      return { ok: false, model, error: `Briefing output validation failed: ${parsedOutput.error.message}` };
    }

    return {
      ok: true,
      data: parsedOutput.data,
      tokenUsage: parsedEnvelope.data.usageMetadata,
      model,
    };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Re-validates that every citation the model returned for a holding was
 * actually present in the news fed to it for that holding — the model output
 * schema alone cannot guarantee this (a string is a string), so this is
 * enforced again here in code, per ADR-0003's "citations constrained to
 * cited_news_ids drawn from the news actually fed to the model".
 */
export function resolveCitedNewsKeys(
  citedKeys: string[],
  fedNewsKeys: readonly string[],
): string[] {
  const fedSet = new Set(fedNewsKeys);
  return citedKeys.filter((key) => fedSet.has(key));
}
