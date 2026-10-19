// Gesture physics from Apple's "Designing Fluid Interfaces" (WWDC 2018), for the web.
// Springs are parameterised by damping ratio and response (seconds), animate from the
// current on-screen value, accept the gesture's release velocity, and can be cancelled
// at any frame so a new gesture can take over mid-flight.

export interface SpringOptions {
  damping?: number; // 1 = critically damped (no overshoot); < 1 bounces
  response?: number; // seconds to (roughly) reach the target; not a fixed duration
  velocity?: number; // initial velocity, units per second (absolute, not normalised)
}

export interface SpringHandle {
  cancel: () => void;
  /** Live value and velocity, so an interrupting gesture starts exactly where the motion is. */
  current: () => { value: number; velocity: number };
}

export function spring(from: number, to: number, onFrame: (v: number) => void, opts: SpringOptions = {}, onRest?: () => void): SpringHandle {
  const damping = opts.damping ?? 1;
  const response = opts.response ?? 0.35;
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let x = from;
  let v = opts.velocity ?? 0;
  let last = performance.now();
  let raf = 0;
  const step = (now: number) => {
    // Fixed sub-steps keep the integration stable on slow frames.
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -stiffness * (x - to) - friction * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.25 && Math.abs(v) < 2) {
      onFrame(to);
      onRest?.();
      return;
    }
    onFrame(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { cancel: () => cancelAnimationFrame(raf), current: () => ({ value: x, velocity: v }) };
}

/** Where a flick would come to rest, using Apple's exponential-decay projection. */
export function project(velocityPxPerSec: number, decelerationRate = 0.998) {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary: real things slow down before they stop. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Velocity from a short pointer history (px per second). */
export function velocityOf(history: { x: number; t: number }[]) {
  const a = history[0];
  const b = history[history.length - 1];
  if (!a || !b || a === b) return 0;
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? (b.x - a.x) / dt : 0;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
