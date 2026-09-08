/**
 * `Badge` — small caption-sized status pill (spec 0002 §2.2).
 *
 * Always TEXT, never an icon or colour alone — spec § Accessibility forbids
 * marking an estimated quantity, stale price, or transaction state with colour,
 * opacity, or italics alone. Every variant below carries its meaning in words.
 */
import type { ReactNode } from "react";

export type BadgeVariant = "estimated" | "stale" | "manual" | "superseded" | "voided" | "up" | "down";

export interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant, children, className }: BadgeProps) {
  const classes = ["badge", `badge--${variant}`, className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}
