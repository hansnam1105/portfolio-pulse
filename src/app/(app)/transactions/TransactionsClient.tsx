"use client";

/**
 * Client half of `/transactions` (spec 0002 §3.4): the log list's edit/void
 * actions and the add/edit bottom-sheet form. Reads its data from props
 * (server-rendered, ADR-0002: no client-side data-fetching layer) and talks
 * to the existing POST/PATCH /api/transactions + DELETE /api/transactions/[id]
 * routes directly — it never imports src/db or src/lib/providers.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Badge";
import {
  computeAmount,
  kindRequiresPrice,
  kindRequiresQuantity,
  validateTransactionForm,
  type TransactionFormValues,
} from "@/lib/transactions/formValidation";

export type TransactionKind = "buy" | "sell" | "set_quantity" | "remove";

export interface SecurityOption {
  id: number;
  label: string;
  currency: "KRW" | "USD";
  market: "KRX" | "US";
}

export interface TxnRowView {
  id: number;
  securityId: number;
  securityLabel: string;
  isUsSecurity: boolean;
  kind: TransactionKind;
  calcLine: string;
  transactionDate: string;
  status: "active" | "superseded" | "voided";
  supersededAsOfDate: string | null;
  voidedAtCompact: string | null;
  quantity: string | null;
  price: string | null;
  currency: "KRW" | "USD";
}

const KIND_LABELS: Record<TransactionKind, string> = {
  buy: "매수",
  sell: "매도",
  set_quantity: "수량 지정",
  remove: "보유 제거",
};

const KIND_ORDER: TransactionKind[] = ["buy", "sell", "set_quantity", "remove"];

/** Parses the server's English sell-validation message (src/lib/holdings/current.ts
 * `validateSellQuantity`) into the Korean copy spec 0002 §3.4 specifies, without
 * modifying that backend contract. Falls back to the raw message if the shape
 * ever changes, so a message is never silently dropped. */
function localizeSellError(message: string): string {
  const match = /current quantity is only ([\d.]+)/.exec(message);
  if (match) {
    return `⚠ 보유 수량(${match[1]}주)을 초과하는 매도입니다. ${match[1]}주 이하로 입력해 주세요.`;
  }
  return message;
}

export function TransactionsClient({
  rows,
  securities,
  todayIso,
  prefillSecurityId,
  prefillKind,
}: {
  rows: TxnRowView[];
  securities: SecurityOption[];
  todayIso: string;
  prefillSecurityId: number | null;
  prefillKind?: TransactionKind;
  statusFilter: "active" | "superseded" | "voided";
}) {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const voidButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const [formOpen, setFormOpen] = useState(prefillSecurityId !== null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [kind, setKind] = useState<TransactionKind>(prefillKind ?? "buy");
  const [securityId, setSecurityId] = useState<number | "">(prefillSecurityId ?? "");
  const [date, setDate] = useState(todayIso);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateTransactionForm>["errors"]>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voidConfirmId, setVoidConfirmId] = useState<number | null>(null);

  const selectedSecurity = useMemo(() => securities.find((s) => s.id === securityId) ?? null, [securities, securityId]);
  const amount = kind === "buy" || kind === "sell" ? computeAmount(quantity, price) : null;

  function resetForm() {
    setEditingId(null);
    setKind(prefillKind ?? "buy");
    setSecurityId(prefillSecurityId ?? "");
    setDate(todayIso);
    setQuantity("");
    setPrice("");
    setNote("");
    setFieldErrors({});
    setServerError(null);
  }

  function openCreateForm() {
    resetForm();
    setFormOpen(true);
  }

  function openEditForm(row: TxnRowView) {
    setEditingId(row.id);
    setKind(row.kind);
    setSecurityId(row.securityId);
    setDate(row.transactionDate);
    setQuantity(row.quantity ?? "");
    setPrice(row.price ?? "");
    setFieldErrors({});
    setServerError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
    triggerRef.current?.focus();
  }

  // Focus the first control on open; trap Tab within the sheet; Esc closes.
  useEffect(() => {
    if (!formOpen || !sheetRef.current) return;
    const sheet = sheetRef.current;
    const focusables = () =>
      Array.from(sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeForm();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    sheet.addEventListener("keydown", onKeyDown);
    return () => sheet.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    const values: TransactionFormValues = {
      kind,
      securityId: securityId === "" ? null : securityId,
      transactionDate: date,
      quantity,
      price,
    };
    const validation = validateTransactionForm(values);
    setFieldErrors(validation.errors);
    if (!validation.valid) return;

    const sec = securities.find((s) => s.id === securityId);
    if (!sec) return;

    const body: Record<string, unknown> = {
      securityId,
      kind,
      currency: sec.currency,
      transactionDate: date,
    };
    if (kindRequiresQuantity(kind)) body.quantity = quantity.replace(/,/g, "").trim();
    if (kindRequiresPrice(kind)) body.price = price.replace(/,/g, "").trim();
    if (note.trim()) body.note = note.trim();

    setSubmitting(true);
    try {
      const res = await fetch(editingId ? "/api/transactions" : "/api/transactions", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "저장하지 못했습니다." }));
        const message: string = payload.error ?? "저장하지 못했습니다.";
        setServerError(kind === "sell" ? localizeSellError(message) : message);
        return;
      }
      closeForm();
      router.refresh();
    } catch {
      setServerError("네트워크 오류로 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVoid(id: number) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setVoidConfirmId(null);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TxnRowView[]>();
    for (const row of rows) {
      const list = map.get(row.transactionDate) ?? [];
      list.push(row);
      map.set(row.transactionDate, list);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <>
      {formOpen && (
        <div className="sheet" style={{ marginBottom: "var(--space-lg)" }} ref={sheetRef} role="dialog" aria-modal="true" aria-label="거래 입력">
          <div className="sheet__head">
            <h3>{editingId ? "거래 수정" : "거래 입력"}</h3>
            <button className="btn btn--ghost" type="button" aria-label="닫기" onClick={closeForm}>
              ✕
            </button>
          </div>
          <form className="sheet__body" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label id="lbl-type">종류</label>
              <div className="typeselect" role="group" aria-labelledby="lbl-type">
                {KIND_ORDER.map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-sec">종목</label>
              <select
                className={`control${fieldErrors.securityId ? " control--error" : ""}`}
                id="f-sec"
                value={securityId}
                aria-describedby={fieldErrors.securityId ? "f-sec-err" : undefined}
                onChange={(e) => setSecurityId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">종목 선택</option>
                {securities.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {fieldErrors.securityId && (
                <p className="error" id="f-sec-err" role="alert" style={{ marginTop: 6, marginBottom: 0 }}>
                  <span className="icon" aria-hidden="true">
                    ⚠
                  </span>
                  <span>{fieldErrors.securityId}</span>
                </p>
              )}
            </div>

            <div className="field field--date">
              <label htmlFor="f-date">거래일</label>
              <input
                className="control"
                id="f-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <p className="hint">
                오늘 날짜로 기본 설정됩니다. 나중에 기록하는 거래는 <strong>과거 날짜로 직접 입력</strong>할 수 있으며,
                키보드로 바로 입력할 수 있습니다.
              </p>
            </div>

            {kindRequiresQuantity(kind) && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="f-qty">수량</label>
                  <input
                    className={`control${fieldErrors.quantity || serverError ? " control--error" : ""}`}
                    id="f-qty"
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    aria-describedby={[fieldErrors.quantity && "f-qty-err", serverError && "f-sell-err"].filter(Boolean).join(" ") || undefined}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  {fieldErrors.quantity && (
                    <p className="hint" id="f-qty-err" style={{ color: "var(--color-danger)" }}>
                      {fieldErrors.quantity}
                    </p>
                  )}
                </div>
                {kindRequiresPrice(kind) && (
                  <div className="field">
                    <label htmlFor="f-price">단가</label>
                    <input
                      className={`control${fieldErrors.price ? " control--error" : ""}`}
                      id="f-price"
                      type="text"
                      inputMode="decimal"
                      value={price}
                      aria-describedby={fieldErrors.price ? "f-price-err" : undefined}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    {fieldErrors.price && (
                      <p className="hint" id="f-price-err" style={{ color: "var(--color-danger)" }}>
                        {fieldErrors.price}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {serverError && (
              <div className="error" id="f-sell-err" role="alert">
                <span className="icon" aria-hidden="true">
                  ⚠
                </span>
                <span>{serverError}</span>
              </div>
            )}

            {(kind === "buy" || kind === "sell") && (
              <dl className="computed">
                <dt>금액 (자동 계산)</dt>
                <dd>{amount && selectedSecurity ? `${selectedSecurity.currency === "KRW" ? "₩" : "$"}${amount}` : "—"}</dd>
              </dl>
            )}

            <div className="btn-row" style={{ marginTop: 0 }}>
              <button className="btn btn--secondary" type="button" onClick={closeForm}>
                취소
              </button>
              <button className="btn btn--primary" type="submit" style={{ flex: 1, width: "auto" }} disabled={submitting}>
                저장
              </button>
            </div>
          </form>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p className="prose">직접 입력한 거래가 없습니다.</p>
          <p className="prose" style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
            업로드된 자료는 포트폴리오 화면에 반영되며, 이 목록은 직접 입력한 거래만 보여줍니다.
          </p>
        </div>
      ) : (
        grouped.map(([txnDate, group]) => (
          <div key={txnDate}>
            <div className="date-group">{txnDate}</div>
            {group.map((row) => (
              <div className={`txn${row.status !== "active" ? " txn--inactive" : ""}`} key={row.id}>
                <div className="txn__top">
                  <span className={`txn__type txn__type--${row.kind === "set_quantity" ? "setqty" : row.kind}`}>
                    {KIND_LABELS[row.kind]}
                  </span>
                  <span className="txn__name">{row.isUsSecurity ? <span lang="en">{row.securityLabel}</span> : row.securityLabel}</span>
                </div>
                <div className="txn__calc">{row.calcLine}</div>
                <div className="txn__foot">
                  {row.status === "active" && <Badge variant="manual">수동 조정</Badge>}
                  {row.status === "superseded" && (
                    <Badge variant="superseded">대체됨{row.supersededAsOfDate ? ` · ${row.supersededAsOfDate.slice(5)} 스냅샷` : ""}</Badge>
                  )}
                  {row.status === "voided" && <Badge variant="voided">취소됨{row.voidedAtCompact ? ` · ${row.voidedAtCompact.slice(5)}` : ""}</Badge>}

                  {row.status === "active" && voidConfirmId !== row.id && (
                    <span className="txn__actions">
                      <button className="btn btn--ghost" type="button" onClick={() => openEditForm(row)}>
                        수정
                      </button>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        ref={(el) => {
                          if (el) voidButtonRefs.current.set(row.id, el);
                        }}
                        onClick={() => setVoidConfirmId(row.id)}
                      >
                        취소
                      </button>
                    </span>
                  )}
                  {row.status === "active" && voidConfirmId === row.id && (
                    <span className="txn__actions" role="group" aria-label="거래 취소 확인">
                      <span className="meta" style={{ fontSize: "0.75rem" }}>
                        정말 취소할까요?
                      </span>
                      <button className="btn btn--ghost" type="button" disabled={submitting} onClick={() => handleVoid(row.id)}>
                        예, 취소
                      </button>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        onClick={() => {
                          setVoidConfirmId(null);
                          voidButtonRefs.current.get(row.id)?.focus();
                        }}
                      >
                        아니오
                      </button>
                    </span>
                  )}
                  {row.status !== "active" && <span className="meta" style={{ fontSize: "0.6875rem" }}>기록은 보존됩니다</span>}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <button className="btn btn--primary" type="button" ref={triggerRef} onClick={openCreateForm}>
          ＋ 거래 입력
        </button>
      </div>
    </>
  );
}
