"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const HOLD_MS = 600;

export interface HoldToConfirmButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * A press-and-hold confirm button — 600ms, chosen specifically because it
 * "demos beautifully on mobile" (long enough to read as a deliberate,
 * hard-to-fat-finger commit gesture; short enough not to feel broken).
 *
 * `onConfirm` fires from a plain `setTimeout(HOLD_MS)`, not the fill bar's
 * own CSS `transitionend` — that was the original design (one 600ms
 * transition driving both the visual fill and the real trigger, so they
 * couldn't drift), but live testing surfaced a real failure mode: a
 * backgrounded/throttled tab can let the CSS transition visually complete
 * (computed `transform` reaches its end value) while the browser never
 * dispatches `transitionend` at all, leaving the button stuck reading
 * "Keep holding…" forever with no way to confirm. A `setTimeout` still
 * fires under those same conditions (Chrome throttles background timers
 * to a slower cadence, but never silently drops one the way it can drop a
 * paint-driven event), so it's the only trigger the timer's own cleanup
 * (`clearTimeout` on release) doesn't need to race against. The fill bar
 * is now purely cosmetic — same 600ms CSS transition, just no longer
 * anything's source of truth.
 *
 * Pointer Events (not mouse-only) so this genuinely works with a touch
 * press on mobile, not just a desktop click-and-hold; `onKeyDown`/`onKeyUp`
 * (Enter/Space) give it the same behavior from a keyboard.
 */
export function HoldToConfirmButton({
  onConfirm,
  disabled,
  children,
  className,
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function start() {
    if (disabled || holding) return;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onConfirm();
    }, HOLD_MS);
  }

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") start();
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") cancel();
      }}
      className={cn(
        "relative w-full overflow-hidden rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground",
        "select-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        // Duration is an inline style, not a `duration-*` Tailwind class —
        // that utility is ambiguous between `transitionDuration` and
        // `animationDuration` on an arbitrary value (Tailwind warns on
        // build), so this sidesteps it and stays deterministic. Purely
        // cosmetic now (see doc comment above) — nothing reads this
        // transition's completion.
        style={{ transitionDuration: holding ? `${HOLD_MS}ms` : "150ms" }}
        className={cn(
          "absolute inset-y-0 left-0 w-full origin-left bg-primary-foreground/25 transition-transform",
          holding ? "scale-x-100 ease-linear" : "scale-x-0 ease-out",
        )}
      />
      <span className="relative">{holding ? "Keep holding…" : children}</span>
    </button>
  );
}
