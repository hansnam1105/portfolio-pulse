/**
 * Pure SVG path geometry for the holding-detail sparkline (spec 0002 §3.3).
 * Deliberately has no DOM/React dependency so it's unit-testable in isolation
 * (OQ-5 leaves the sparkline library choice open; this is the inline-SVG path
 * pending that decision). The accessibility contract — `role="img"`,
 * text-duplicated numeric range, `prefers-reduced-motion` disabling any draw
 * animation — is enforced by the caller, not this module.
 */
export interface SparklinePoint {
  tradeDate: string;
  close: number;
}

export interface SparklineGeometry {
  linePath: string;
  areaPath: string;
  min: number;
  max: number;
  width: number;
  height: number;
}

/**
 * Builds line + area path `d` attributes for an SVG of the given size.
 * Returns `null` when there isn't enough data to draw a line (0 or 1 point).
 */
export function buildSparkline(points: readonly SparklinePoint[], width = 330, height = 92): SparklineGeometry | null {
  if (points.length < 2) return null;

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    // Flat series (range === 0) draws a horizontal midline rather than dividing by zero.
    const y = range === 0 ? height / 2 : height - ((p.close - min) / range) * height;
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const firstX = coords[0]!.x.toFixed(2);
  const lastX = coords[coords.length - 1]!.x.toFixed(2);
  const areaPath = `${linePath} L${lastX},${height} L${firstX},${height} Z`;

  return { linePath, areaPath, min, max, width, height };
}
