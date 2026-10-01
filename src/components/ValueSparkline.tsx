import { buildSparkline, type SparklinePoint } from "@/lib/sparkline";

/**
 * Server-rendered inline SVG sparkline, following the accessibility contract
 * the holding-detail chart established (spec 0002 §3.3): `role="img"` with a
 * spoken summary, and the numeric range duplicated as text by the caller so
 * the shape is never the only carrier of the information. Direction is
 * conveyed by an accompanying signed percentage, never by colour alone
 * (WCAG 1.4.1).
 *
 * Renders nothing below two points — `buildSparkline` returns null and there
 * is no line to draw. Callers show their own "not enough history" copy.
 */
export function ValueSparkline({
  points,
  direction,
  ariaLabel,
  className,
  width,
  height,
}: {
  points: readonly SparklinePoint[];
  direction: "up" | "down" | "flat";
  ariaLabel: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const geometry = buildSparkline(points, width, height);
  if (!geometry) return null;

  return (
    <svg
      className={`spark spark--${direction}${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <path className="area" d={geometry.areaPath} />
      <path className="line" d={geometry.linePath} />
    </svg>
  );
}
