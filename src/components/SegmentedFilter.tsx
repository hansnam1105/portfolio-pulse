"use client";

/**
 * `SegmentedFilter` — spec 0002 §3.2/§3.4: a 44px-target segmented control
 * used by both the Portfolio market filter and the Transactions status
 * filter. Drives a URL query param (not client component state) so the
 * filtered view is a real, shareable/back-button-able URL and the pages that
 * read it stay Server Components (ADR-0002: no client-side data-fetching
 * layer) — this component only navigates, it never fetches.
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export interface SegmentedFilterOption {
  value: string;
  label: string;
}

export interface SegmentedFilterProps {
  paramName: string;
  options: readonly SegmentedFilterOption[];
  ariaLabel: string;
  /** The option value treated as the default (omitted from the URL). */
  defaultValue: string;
}

export function SegmentedFilter({ paramName, options, ariaLabel, defaultValue }: SegmentedFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? defaultValue;

  function select(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) {
      params.delete(paramName);
    } else {
      params.set(paramName, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button key={opt.value} type="button" aria-pressed={current === opt.value} onClick={() => select(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
