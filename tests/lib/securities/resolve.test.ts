import { describe, it, expect } from "bun:test";
import {
  marketFromCurrency,
  resolveSecurity,
  type AliasCandidate,
  type SecurityCandidate,
} from "@/lib/securities/resolve";

const securities: SecurityCandidate[] = [
  { id: 1, market: "KRX", symbol: "000001", nameLocal: "가나전자", nameEn: null, currency: "KRW" },
  { id: 2, market: "KRX", symbol: "000002", nameLocal: "가나전자우", nameEn: null, currency: "KRW" },
  { id: 3, market: "US", symbol: "SMPL", nameLocal: "SMPL", nameEn: null, currency: "USD" },
  { id: 4, market: "US", symbol: "SMPL.B", nameLocal: "SMPL.B", nameEn: null, currency: "USD" },
];

const aliases: AliasCandidate[] = [{ securityId: 3, rawLabel: "다라바이오 alias" }];

describe("marketFromCurrency", () => {
  it("maps KRW -> KRX", () => {
    expect(marketFromCurrency("KRW")).toBe("KRX");
  });
  it("maps USD -> US", () => {
    expect(marketFromCurrency("USD")).toBe("US");
  });
});

describe("resolveSecurity", () => {
  it("resolves a KRW row by exact nameLocal match", () => {
    const result = resolveSecurity({ rawLabel: "가나전자", currency: "KRW" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 1, via: "name" });
  });

  it("does NOT strip the Korean preferred-share 우 suffix — 가나전자우 resolves to a distinct security", () => {
    const result = resolveSecurity({ rawLabel: "가나전자우", currency: "KRW" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 2, via: "name" });
  });

  it("resolves a USD row by exact symbol match, case-insensitively", () => {
    const result = resolveSecurity({ rawLabel: "smpl", currency: "USD" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 3, via: "symbol" });
  });

  it("does NOT split a dotted US ticker on '.' — SMPL.B is compared as a whole string", () => {
    const result = resolveSecurity({ rawLabel: "SMPL.B", currency: "USD" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 4, via: "symbol" });
    // and it must not accidentally match the unrelated "SMPL" security
    expect(result.status === "resolved" && result.securityId).not.toBe(3);
  });

  it("trims incidental surrounding whitespace before matching", () => {
    const result = resolveSecurity({ rawLabel: "  SMPL  ", currency: "USD" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 3, via: "symbol" });
  });

  it("falls back to security_alias when there is no direct name/symbol match", () => {
    const result = resolveSecurity({ rawLabel: "다라바이오 alias", currency: "KRW" }, securities, aliases);
    expect(result).toEqual({ status: "resolved", securityId: 3, via: "alias" });
  });

  it("returns unresolved (never throws) when nothing matches", () => {
    const result = resolveSecurity({ rawLabel: "존재하지않음", currency: "KRW" }, securities, aliases);
    expect(result).toEqual({
      status: "unresolved",
      rawLabel: "존재하지않음",
      currency: "KRW",
      market: "KRX",
    });
  });

  it("a USD row is never matched against a KRX security's nameLocal, and vice versa", () => {
    // "가나전자" only exists as a KRX security; asking for it as a USD row must not match.
    const result = resolveSecurity({ rawLabel: "가나전자", currency: "USD" }, securities, aliases);
    expect(result.status).toBe("unresolved");
  });
});
