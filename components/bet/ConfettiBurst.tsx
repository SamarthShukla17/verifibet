"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const COLORS = ["bg-primary", "bg-accent-gold", "bg-destructive", "bg-chart-4"];
const PARTICLE_COUNT = 14;
const FALL_DURATION_S = 0.9;

interface Particle {
  id: number;
  left: number;
  color: string;
  delaySec: number;
  rotate: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, id) => ({
    id,
    left: 6 + Math.random() * 88,
    color: COLORS[id % COLORS.length],
    delaySec: Math.random() * 0.15,
    rotate: 300 + Math.random() * 80,
  }));
}

/**
 * A tasteful, single, ≤1s confetti burst — 14 particles falling over
 * `FALL_DURATION_S` (900ms), unmounts itself ~1s after mount so a
 * lingering absolutely-positioned overlay never outstays the moment or
 * blocks clicks on whatever renders after it (e.g. the "View position"
 * link in the same success state). Particles are generated once per
 * mount (`useState(makeParticles)`, not recomputed on every render) so
 * their positions don't jitter mid-animation.
 *
 * `prefers-reduced-motion` renders nothing at all — a shower of falling
 * particles is squarely the kind of motion that preference exists to
 * suppress, and the surrounding "Bet placed!" text/checkmark already
 * carries the same information without it.
 */
export function ConfettiBurst() {
  const [particles] = useState(makeParticles);
  const [visible, setVisible] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible || reduceMotion) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className={`absolute top-0 block h-2 w-1.5 rounded-sm ${p.color}`}
          style={{ left: `${p.left}%` }}
          initial={{ y: 0, rotate: 0, opacity: 1 }}
          animate={{ y: 110, rotate: p.rotate, opacity: 0 }}
          transition={{ duration: FALL_DURATION_S, delay: p.delaySec, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
