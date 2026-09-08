/**
 * Shared empty / loading / error presentational primitives (spec 0002 §4:
 * every screen must implement all applicable states explicitly — no silently
 * showing a false ₩0).
 */
import type { CSSProperties, ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p className="prose" style={{ fontWeight: 700 }}>
        {title}
      </p>
      {description && (
        <p className="prose" style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: "var(--space-md)" }}>{action}</div>}
    </div>
  );
}

/** Section-level error: `--color-danger`, plain-language cause, retry ≥44px. */
export function ErrorState({
  message,
  retryHref,
}: {
  message: string;
  retryHref?: string;
}) {
  return (
    <div className="error" role="alert">
      <span className="icon" aria-hidden="true">
        ⚠
      </span>
      <span>
        {message}
        {retryHref && (
          <>
            {" "}
            <a className="btn btn--ghost" href={retryHref} style={{ display: "inline-flex" }}>
              다시 시도
            </a>
          </>
        )}
      </span>
    </div>
  );
}

/** Skeleton block matching final geometry. No spinner (spec 0002 §3.1 Loading). */
export function Skeleton({ height = "1rem", style }: { height?: string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height, ...style }} aria-hidden="true" />;
}

/** `role="status"` live region announcing a loading section once (spec 0002 §3.1). */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}
