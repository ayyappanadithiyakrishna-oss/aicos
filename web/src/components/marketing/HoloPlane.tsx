/* The signature asset — "committee convergence."
   Six faint specialist orbits (one per agent) resolve inward to a single
   cobalt verdict point: the whole thesis of AICOS in one mark. Monochrome
   ivory on onyx with cobalt as the only chromatic note, per Mercury.
   Pure SVG so it stays crisp and dependency-free. */
export function HoloPlane({ className }: { className?: string }) {
  const rings = [140, 118, 96, 74, 52, 30];
  return (
    <div className={className}>
      <div className="drift relative h-full w-full">
        {/* cobalt bloom behind the mark */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(82,102,235,0.22) 0%, rgba(82,102,235,0) 62%)",
          }}
        />
        <svg viewBox="0 0 320 320" className="relative h-full w-full" fill="none">
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7d8dff" />
              <stop offset="100%" stopColor="#5266eb" />
            </radialGradient>
          </defs>

          {/* concentric specialist orbits */}
          {rings.map((r, i) => (
            <circle
              key={r}
              cx="160"
              cy="160"
              r={r}
              stroke="#ededf3"
              strokeOpacity={0.06 + i * 0.035}
              strokeWidth={i === rings.length - 1 ? 1 : 0.75}
            />
          ))}

          {/* six agent nodes distributed around the outer orbit, each wired to the core */}
          {Array.from({ length: 6 }).map((_, i) => {
            const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
            const R = 140;
            const x = 160 + Math.cos(a) * R;
            const y = 160 + Math.sin(a) * R;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={y}
                  x2="160"
                  y2="160"
                  stroke="#5266eb"
                  strokeOpacity="0.16"
                  strokeWidth="0.75"
                />
                <circle cx={x} cy={y} r="3.5" fill="#ededf3" fillOpacity="0.8" />
              </g>
            );
          })}

          {/* the verdict — single cobalt point */}
          <circle cx="160" cy="160" r="9" fill="url(#core)" />
          <circle cx="160" cy="160" r="16" stroke="#5266eb" strokeOpacity="0.5" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
