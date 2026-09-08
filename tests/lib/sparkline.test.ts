import { describe, expect, it } from "bun:test";
import { buildSparkline } from "@/lib/sparkline";

describe("buildSparkline", () => {
  it("returns null with fewer than 2 points (nothing to draw a line between)", () => {
    expect(buildSparkline([])).toBeNull();
    expect(buildSparkline([{ tradeDate: "2026-09-01", close: 100 }])).toBeNull();
  });

  it("computes min/max across the series", () => {
    const geometry = buildSparkline([
      { tradeDate: "2026-09-01", close: 1300 },
      { tradeDate: "2026-09-02", close: 1470 },
      { tradeDate: "2026-09-03", close: 1400 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry!.min).toBe(1300);
    expect(geometry!.max).toBe(1470);
  });

  it("does not divide by zero for a perfectly flat series", () => {
    const geometry = buildSparkline([
      { tradeDate: "2026-09-01", close: 1000 },
      { tradeDate: "2026-09-02", close: 1000 },
    ]);
    expect(geometry).not.toBeNull();
    expect(Number.isFinite(geometry!.min)).toBe(true);
    // A flat series draws a horizontal midline — every y coordinate in the
    // path should be finite (no NaN from a 0/0 division).
    expect(geometry!.linePath).not.toContain("NaN");
  });

  it("starts the line path at the first point and ends at the last", () => {
    const geometry = buildSparkline([
      { tradeDate: "2026-09-01", close: 10 },
      { tradeDate: "2026-09-02", close: 20 },
    ], 100, 50);
    expect(geometry!.linePath.startsWith("M0.00,")).toBe(true);
    expect(geometry!.linePath).toContain("L100.00,");
  });
});
