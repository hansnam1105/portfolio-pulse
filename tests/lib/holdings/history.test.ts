import { describe, expect, test } from "bun:test";
import {
  buildCloseSeries,
  buildPortfolioValueSeries,
  closeOnOrBefore,
  fxOnOrBefore,
  percentChangeOverSeries,
  tradeDateAxis,
  type PriceRowInput,
} from "@/lib/holdings/history";

const prices: PriceRowInput[] = [
  { securityId: 1, tradeDate: "2026-09-07", close: "100" },
  { securityId: 1, tradeDate: "2026-09-09", close: "110" },
  { securityId: 2, tradeDate: "2026-09-08", close: "10" },
  { securityId: 2, tradeDate: "2026-09-09", close: "12" },
];

const fx = [
  { rateDate: "2026-09-08", rate: "1300" },
  { rateDate: "2026-09-09", rate: "1340" },
];

describe("closeOnOrBefore / fxOnOrBefore", () => {
  test("picks the most recent row at or before the date", () => {
    expect(closeOnOrBefore(prices.filter((p) => p.securityId === 1), "2026-09-08")?.toFixed()).toBe("100");
    expect(closeOnOrBefore(prices.filter((p) => p.securityId === 1), "2026-09-09")?.toFixed()).toBe("110");
  });

  test("carries the last value forward past the end of the data", () => {
    expect(closeOnOrBefore(prices.filter((p) => p.securityId === 1), "2026-12-31")?.toFixed()).toBe("110");
  });

  test("returns null before the first row rather than guessing", () => {
    expect(closeOnOrBefore(prices.filter((p) => p.securityId === 1), "2026-09-06")).toBeNull();
  });

  test("does not require sorted input", () => {
    const shuffled = [...prices].reverse();
    expect(closeOnOrBefore(shuffled.filter((p) => p.securityId === 1), "2026-09-09")?.toFixed()).toBe("110");
  });

  test("fxOnOrBefore behaves the same way", () => {
    expect(fxOnOrBefore(fx, "2026-09-08")?.toFixed()).toBe("1300");
    expect(fxOnOrBefore(fx, "2026-09-10")?.toFixed()).toBe("1340");
    expect(fxOnOrBefore(fx, "2026-09-07")).toBeNull();
  });
});

describe("tradeDateAxis", () => {
  test("returns ascending distinct dates", () => {
    expect(tradeDateAxis(prices)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
  });

  test("caps to the most recent N dates", () => {
    expect(tradeDateAxis(prices, 2)).toEqual(["2026-09-08", "2026-09-09"]);
  });
});

describe("buildCloseSeries", () => {
  test("carries closes forward across dates the security did not trade", () => {
    const series = buildCloseSeries(prices, 1, ["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(series.map((p) => [p.tradeDate, p.value.toFixed()])).toEqual([
      ["2026-09-07", "100"],
      ["2026-09-08", "100"],
      ["2026-09-09", "110"],
    ]);
  });

  test("omits dates before the security's first close", () => {
    const series = buildCloseSeries(prices, 2, ["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(series.map((p) => p.tradeDate)).toEqual(["2026-09-08", "2026-09-09"]);
  });

  test("returns empty for a security with no prices", () => {
    expect(buildCloseSeries(prices, 999, ["2026-09-09"])).toEqual([]);
  });
});

describe("buildPortfolioValueSeries", () => {
  const holdings = [
    { securityId: 1, currency: "KRW" as const, quantity: "2" },
    { securityId: 2, currency: "USD" as const, quantity: "3" },
  ];

  test("sums quantity x close, converting USD at that date's FX", () => {
    const series = buildPortfolioValueSeries({
      holdings,
      priceRows: prices,
      fxRows: fx,
      dates: ["2026-09-08", "2026-09-09"],
    });
    // 09-08: KRW 2*100=200, USD 3*10=30 -> 30*1300=39000, total 39200
    // 09-09: KRW 2*110=220, USD 3*12=36 -> 36*1340=48240, total 48460
    expect(series.map((p) => [p.tradeDate, p.value.toFixed()])).toEqual([
      ["2026-09-08", "39200"],
      ["2026-09-09", "48460"],
    ]);
  });

  test("excludes a date where any held security has no price yet", () => {
    // security 2 has no close before 09-08, so 09-07 must not be emitted as a
    // partial (KRW-only) total.
    const series = buildPortfolioValueSeries({
      holdings,
      priceRows: prices,
      fxRows: fx,
      dates: ["2026-09-07", "2026-09-08", "2026-09-09"],
    });
    expect(series.map((p) => p.tradeDate)).toEqual(["2026-09-08", "2026-09-09"]);
  });

  test("excludes dates with no FX when a USD holding is present", () => {
    const series = buildPortfolioValueSeries({
      holdings,
      priceRows: prices,
      fxRows: [{ rateDate: "2026-09-09", rate: "1340" }],
      dates: ["2026-09-08", "2026-09-09"],
    });
    expect(series.map((p) => p.tradeDate)).toEqual(["2026-09-09"]);
  });

  test("does not need FX at all for a KRW-only portfolio", () => {
    const series = buildPortfolioValueSeries({
      holdings: [{ securityId: 1, currency: "KRW", quantity: "2" }],
      priceRows: prices,
      fxRows: [],
      dates: ["2026-09-08", "2026-09-09"],
    });
    expect(series.map((p) => p.value.toFixed())).toEqual(["200", "220"]);
  });

  test("ignores zero-quantity holdings so a sold-out position cannot delay the series", () => {
    const series = buildPortfolioValueSeries({
      holdings: [
        { securityId: 1, currency: "KRW", quantity: "2" },
        { securityId: 2, currency: "USD", quantity: "0" },
      ],
      priceRows: prices,
      fxRows: [],
      dates: ["2026-09-07", "2026-09-08"],
    });
    expect(series.map((p) => p.tradeDate)).toEqual(["2026-09-07", "2026-09-08"]);
  });

  test("returns empty when nothing is held", () => {
    expect(
      buildPortfolioValueSeries({ holdings: [], priceRows: prices, fxRows: fx, dates: ["2026-09-09"] }),
    ).toEqual([]);
  });

  test("keeps fractional-share arithmetic exact", () => {
    const series = buildPortfolioValueSeries({
      holdings: [{ securityId: 2, currency: "USD", quantity: "0.395109" }],
      priceRows: [{ securityId: 2, tradeDate: "2026-09-09", close: "256.97" }],
      fxRows: [{ rateDate: "2026-09-09", rate: "1341.1" }],
      dates: ["2026-09-09"],
    });
    // 0.395109 * 256.97 = 101.53115973, * 1341.1 = 136163.438313903 exactly.
    // Float arithmetic drifts in the last places here; decimal.js must not.
    expect(series[0]!.value.toFixed(6)).toBe("136163.438314");
    expect(series[0]!.value.toFixed()).toBe("136163.438313903");
  });
});

describe("percentChangeOverSeries", () => {
  test("computes first-to-last percent change", () => {
    const series = buildCloseSeries(prices, 1, ["2026-09-07", "2026-09-09"]);
    expect(percentChangeOverSeries(series)?.toFixed(2)).toBe("10.00");
  });

  test("returns null with fewer than two points", () => {
    expect(percentChangeOverSeries([])).toBeNull();
    expect(percentChangeOverSeries(buildCloseSeries(prices, 1, ["2026-09-09"]))).toBeNull();
  });

  test("returns null rather than dividing by a zero base", () => {
    const fromZero = buildCloseSeries(
      [
        { securityId: 1, tradeDate: "2026-09-08", close: "0" },
        { securityId: 1, tradeDate: "2026-09-09", close: "110" },
      ],
      1,
      ["2026-09-08", "2026-09-09"],
    );
    expect(percentChangeOverSeries(fromZero)).toBeNull();
  });
});
