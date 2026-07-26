"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * A route-level `template.tsx`, not `layout.tsx` — the whole point:
 * `layout.tsx` persists across navigations within the same segment,
 * `template.tsx` remounts on every navigation, which is what actually
 * lets a fresh 8px-fade-up entrance replay on every page change instead
 * of playing once and never again. Entrance-only (no `AnimatePresence`,
 * no exit transition) — deliberately minimal, matching the brief:
 * "8px fade-up. Nothing else — no parallax, no scroll-jacking."
 * `prefers-reduced-motion` renders `children` directly, no wrapper
 * animation at all.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
