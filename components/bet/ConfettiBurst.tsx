"use client";

import { useEffect, useState } from "react";

const COLORS = ["bg-primary", "bg-accent-gold", "bg-destructive", "bg-chart-4"];
const PARTICLE_COUNT = 14;

interface Particle {
  id: number;
  left: number;
  color: string;
  delayMs: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, id) => ({
    id,
    left: 6 + Math.random() * 88,
    color: COLORS[id % COLORS.length],
    delayMs: Math.random() * 150,
  }));
}

/**
 * A tasteful, ≤1s confetti burst — 14 particles, `animate-confetti-fall`
 * (900ms, see tailwind.config.ts), unmounts itself ~1s after mount so a
 * lingering absolutely-positioned overlay never outstays the moment or
 * blocks clicks on whatever renders after it (e.g. the "View position"
 * link in the same success state). Particles are generated once per
 * mount (`useState(makeParticles)`, not recomputed on every render) so
 * their positions don't jitter mid-animation.
 */
export function ConfettiBurst() {
  const [particles] = useState(makeParticles);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible">
      {particles.map((p) => (
        <span
          key={p.id}
          className={`absolute top-0 block h-2 w-1.5 rounded-sm ${p.color} animate-confetti-fall`}
          style={{ left: `${p.left}%`, animationDelay: `${p.delayMs}ms` }}
        />
      ))}
    </div>
  );
}
