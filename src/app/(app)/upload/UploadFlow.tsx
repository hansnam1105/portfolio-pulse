"use client";

/**
 * `/upload` client flow: file pick → preview (`POST /api/upload`) → resolve
 * unresolved rows → confirm `as_of_date` → commit (`POST /api/upload/commit`).
 * Functional-only screen (spec 0002 §OQ-1 defers its visual design) built
 * from the same shared primitives (Badge, EmptyState-style card, .btn/.field)
 * as the four designed screens.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Badge";
import {
  bindableRawLabel,
  computeDiffPreview,
  summarizeUpload,
  type UploadDiffVsCurrentRow,
  type UploadParsedRow,
  type UploadUnresolvedRow,
} from "@/lib/upload/diffPreview";

export interface SecurityOption {
  id: number;
  label: string;
}

interface PreviewResponse {
  fileSha256: string;
  asOfDate: string;
  alreadyCommitted: boolean;
  profileVersion: string;
  parsed: UploadParsedRow[];
  unresolved: UploadUnresolvedRow[];
  warnings: string[];
  diffVsCurrent: UploadDiffVsCurrentRow[];
  willSupersede: { id: number; transactionDate: string }[];
}

export function UploadFlow({ securities, todayIso }: { securities: SecurityOption[]; todayIso: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [aliasBindings, setAliasBindings] = useState<Map<string, number>>(new Map());
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{ snapshotId: number; rowCount: number } | null>(null);

  async function runPreview() {
    if (!file) {
      setError("파일을 선택해 주세요.");
      return;
    }
    setError(null);
    setPreviewing(true);
    setCommitResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("asOfDate", asOfDate);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "파일을 분석하지 못했습니다.");
        setPreview(null);
        return;
      }
      setPreview(data as PreviewResponse);
      setAliasBindings(new Map());
    } catch {
      setError("네트워크 오류로 파일을 분석하지 못했습니다.");
    } finally {
      setPreviewing(false);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    setError(null);
    setCommitting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("asOfDate", asOfDate);
      if (aliasBindings.size > 0) {
        form.set(
          "aliasBindings",
          JSON.stringify([...aliasBindings.entries()].map(([rawLabel, securityId]) => ({ rawLabel, securityId }))),
        );
      }
      const res = await fetch("/api/upload/commit", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        if (data.unresolved) {
          setError(`아직 해결되지 않은 종목이 있습니다: ${data.unresolved.length}건. 아래에서 종목을 지정해 주세요.`);
        } else {
          setError(data.error ?? "업로드를 확정하지 못했습니다.");
        }
        return;
      }
      setCommitResult({ snapshotId: data.snapshotId, rowCount: data.rowCount });
      setPreview(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch {
      setError("네트워크 오류로 업로드를 확정하지 못했습니다.");
    } finally {
      setCommitting(false);
    }
  }

  const summary = preview ? summarizeUpload(preview.parsed, preview.unresolved) : null;
  const diffRows = preview ? computeDiffPreview(preview.diffVsCurrent) : [];
  const unboundUnresolved = preview
    ? preview.unresolved.filter((u) => {
        const label = bindableRawLabel(u);
        return !(label && aliasBindings.has(label));
      })
    : [];

  return (
    <>
      {commitResult && (
        <div className="card">
          <p className="prose" style={{ fontWeight: 700, color: "var(--color-success)" }}>
            업로드가 완료되었습니다.
          </p>
          <p className="prose">스냅샷 #{commitResult.snapshotId} · {commitResult.rowCount}개 종목 반영됨</p>
          <a className="btn btn--primary" href="/portfolio" style={{ marginTop: "var(--space-sm)" }}>
            포트폴리오 보기
          </a>
        </div>
      )}

      <div className="card">
        <div className="field">
          <label htmlFor="f-file">증권사 거래내역 파일 (.xlsx)</label>
          <input
            ref={fileInputRef}
            className="control"
            id="f-file"
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
          />
        </div>
        <div className="field field--date">
          <label htmlFor="f-asof">기준일 (as_of_date)</label>
          <input className="control" id="f-asof" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          <p className="hint">파일이 반영하는 날짜입니다. 이 날짜 이전(포함)의 활성 거래는 이 업로드로 대체됩니다.</p>
        </div>
        <button className="btn btn--primary" type="button" onClick={runPreview} disabled={!file || previewing}>
          {previewing ? "분석 중…" : "미리보기"}
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          <span className="icon" aria-hidden="true">
            ⚠
          </span>
          <span>{error}</span>
        </div>
      )}

      {preview && summary && (
        <>
          {preview.alreadyCommitted && (
            <div className="error" role="alert">
              <span className="icon" aria-hidden="true">
                ⚠
              </span>
              <span>이 파일은 이미 스냅샷으로 커밋되었습니다. 같은 파일을 다시 업로드할 수 없습니다.</span>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="card">
              <p className="prose" style={{ fontWeight: 700 }}>
                경고 {preview.warnings.length}건
              </p>
              {preview.warnings.map((w, i) => (
                <p className="prose" key={i} style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="card">
            <p className="prose">
              총 {summary.totalRows}행 · 해석됨 {summary.resolvedRows}행 ·{" "}
              {summary.unresolvedRowNumbers.length > 0 ? `미해결 ${summary.unresolvedRowNumbers.length}행` : "모두 해석됨"}
            </p>
            {preview.willSupersede.length > 0 && (
              <p className="prose" style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                이 업로드를 확정하면 기존 수동 거래 {preview.willSupersede.length}건이 대체됩니다 (기록은 보존됩니다).
              </p>
            )}
          </div>

          {preview.unresolved.length > 0 && (
            <div className="card">
              <p className="prose" style={{ fontWeight: 700 }}>
                종목을 찾을 수 없는 행
              </p>
              {preview.unresolved.map((u) => {
                const label = bindableRawLabel(u);
                return (
                  <div key={u.rowNumber} className="diff-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--space-xs)" }}>
                    <span>
                      {u.rowNumber}행 — {u.reason}
                    </span>
                    {label && (
                      <select
                        className="control"
                        aria-label={`${label} 종목 지정`}
                        value={aliasBindings.get(label) ?? ""}
                        onChange={(e) => {
                          const next = new Map(aliasBindings);
                          if (e.target.value) next.set(label, Number(e.target.value));
                          else next.delete(label);
                          setAliasBindings(next);
                        }}
                      >
                        <option value="">종목 선택 안 함</option>
                        {securities.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {diffRows.length > 0 && (
            <div className="card">
              <p className="prose" style={{ fontWeight: 700 }}>
                현재 보유 대비 변경사항
              </p>
              {diffRows.map((row) => (
                <div className="diff-row" key={row.securityId}>
                  <span>
                    {row.rawLabel}{" "}
                    {row.status === "new" && <Badge variant="estimated">신규</Badge>}
                    {row.status === "changed" && <Badge variant="manual">변경됨</Badge>}
                  </span>
                  <span>
                    {row.currentCostBasis ?? "—"} → {row.incomingCostBasisTotal}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn btn--primary"
            type="button"
            onClick={runCommit}
            disabled={committing || preview.alreadyCommitted || unboundUnresolved.length > 0}
          >
            {committing ? "확정 중…" : "업로드 확정"}
          </button>
          {unboundUnresolved.length > 0 && (
            <p className="hint" style={{ marginTop: "var(--space-sm)" }}>
              모든 미해결 행에 종목을 지정해야 확정할 수 있습니다.
            </p>
          )}
        </>
      )}
    </>
  );
}
