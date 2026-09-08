/**
 * `PLFigure` — the single gain/loss renderer (spec 0002 §2.1).
 *
 * EVERY signed figure (gain/loss) in the app must render through this component.
 * No screen may hand-roll a colored `<span>` for a P/L value — colour alone is
 * never a permitted way to carry direction (WCAG 1.4.1 / spec § Accessibility).
 *
 * Direction is carried by FOUR channels: an arrow glyph, an explicit +/− sign,
 * colour, and a visually-hidden direction word (상승/하락/보합). Colour is the
 * only one of the four that is safe to remove.
 */
import type { DecimalInput } from "@/lib/money";
import {
  directionArrow,
  directionOf,
  directionWord,
  formatMoneySigned,
  formatPercentSigned,
  type Currency,
} from "@/lib/format";

export interface PLFigureProps {
  /** Signed delta value in its native currency. Determines direction (up/down/flat). */
  amount: DecimalInput;
  currency: Currency;
  /** Signed percent change. Omit to render the amount only (no percent suffix). */
  percent?: DecimalInput | null;
  /** Renders the percent only, hiding the amount (used in BriefingCard headings). */
  amountHidden?: boolean;
  className?: string;
}

export function PLFigure({ amount, currency, percent, amountHidden, className }: PLFigureProps) {
  const direction = directionOf(amount);
  const classes = ["pl", `pl--${direction}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-atomic="true">
      <span className="pl__arrow" aria-hidden="true">
        {directionArrow(direction)}
      </span>
      {!amountHidden && <span className="pl__amount">{formatMoneySigned(amount, currency)}</span>}
      {percent !== undefined && percent !== null && (
        <span className="pl__pct">({formatPercentSigned(percent)}%)</span>
      )}
      <span className="sr-only">{directionWord(direction)}</span>
    </span>
  );
}
