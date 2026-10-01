import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProseMd } from "@/components/ProseMd";

const html = (md: string) => renderToStaticMarkup(<ProseMd md={md} />);

describe("ProseMd", () => {
  test("renders bold markdown instead of printing the asterisks", () => {
    const out = html("**거시 경제 지표**");
    expect(out).toContain("<strong>");
    expect(out).toContain("거시 경제 지표");
    expect(out).not.toContain("**");
  });

  test("renders `- ` lines as a list", () => {
    const out = html("- 기준금리: 3%\n- CPI: 120.05");
    expect(out).toContain("<ul");
    expect(out.match(/<li>/g)).toHaveLength(2);
  });

  test("renders other lines as paragraphs", () => {
    const out = html("첫 문단입니다.\n\n둘째 문단입니다.");
    expect(out.match(/<p/g)).toHaveLength(2);
  });

  // The hide-amounts toggle keys off `.money`; the model decides where amounts
  // appear in its prose, so they can only be caught by shape.
  test.each([
    ["평가 금액은 793600 KRW입니다.", "793600 KRW"],
    ["총액 ₩1,234,567 입니다.", "₩1,234,567"],
    ["현재가는 $34.41 입니다.", "$34.41"],
    ["환율은 1341.1원 수준입니다.", "1341.1원"],
  ])("wraps currency-shaped tokens in .money (%s)", (input, token) => {
    const out = html(input);
    expect(out).toContain(`<span class="money">${token}</span>`);
  });

  test("wraps amounts inside bold text too", () => {
    expect(html("**총액 ₩1,000**")).toContain('<span class="money">₩1,000</span>');
  });

  test("leaves plain numbers alone", () => {
    const out = html("보유 수량은 6주입니다.");
    expect(out).not.toContain('class="money"');
  });

  test("handles several amounts in one line without regex state leaking", () => {
    const out = html("매수 ₩1,000 매도 ₩2,000 차익 ₩1,000");
    expect(out.match(/class="money"/g)).toHaveLength(3);
  });
});
