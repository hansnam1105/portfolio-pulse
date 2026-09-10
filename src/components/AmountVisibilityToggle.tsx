"use client";

/**
 * Toggles the "hide amounts" mode used when the app is opened somewhere
 * public: currency figures blur, every percentage stays readable.
 *
 * State lives on `<html data-amounts-hidden>` and in localStorage, not in the
 * URL. That is a deliberate exception to this project's URL-query-param
 * convention (see SegmentedFilter): the setting is purely presentational, must
 * survive across sessions, and must NOT be shareable in a link. Keeping it in
 * an attribute + CSS also means every page stays a Server Component — nothing
 * about the money markup has to move client-side to be hideable.
 *
 * `AMOUNT_VISIBILITY_BOOT_SCRIPT` applies the stored value before first paint;
 * without it the balance would flash on every load, which for a privacy
 * control is most of the point lost.
 */
import { useEffect, useState } from "react";

export const AMOUNT_VISIBILITY_STORAGE_KEY = "pp:amountsHidden";

export const AMOUNT_VISIBILITY_BOOT_SCRIPT = `try{if(localStorage.getItem('${AMOUNT_VISIBILITY_STORAGE_KEY}')==='1'){document.documentElement.dataset.amountsHidden='1'}}catch(e){}`;

export function AmountVisibilityToggle() {
  const [hidden, setHidden] = useState(false);

  // The boot script has already applied the stored value to <html>; adopt it
  // after hydration so the label and aria-pressed match what is on screen.
  useEffect(() => {
    setHidden(document.documentElement.dataset.amountsHidden === "1");
  }, []);

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    if (next) document.documentElement.dataset.amountsHidden = "1";
    else delete document.documentElement.dataset.amountsHidden;
    try {
      localStorage.setItem(AMOUNT_VISIBILITY_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode / storage disabled: the toggle still works for this view,
      // it just won't be remembered.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "금액 표시하기" : "금액 숨기기"}
    >
      <span className="glyph" aria-hidden="true">
        {hidden ? "⊙" : "⊘"}
      </span>
      {hidden ? "표시" : "숨김"}
    </button>
  );
}
