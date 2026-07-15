/* The signature asset: a holographic paper-plane, the only chromatic
   moment on the page. Pure SVG so it stays crisp and dependency-free. */
export function HoloPlane({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="drift">
        <svg viewBox="0 0 320 320" className="h-full w-full" fill="none">
          <defs>
            <linearGradient id="face-a" x1="40" y1="40" x2="280" y2="280">
              <stop offset="0%" stopColor="#d1aad7" />
              <stop offset="55%" stopColor="#bbdef2" />
              <stop offset="100%" stopColor="#f4f0ff" />
            </linearGradient>
            <linearGradient id="face-b" x1="160" y1="40" x2="160" y2="300">
              <stop offset="0%" stopColor="#bbdef2" />
              <stop offset="100%" stopColor="#d1aad7" />
            </linearGradient>
            <linearGradient id="face-c" x1="60" y1="300" x2="300" y2="120">
              <stop offset="0%" stopColor="#f4f0ff" />
              <stop offset="100%" stopColor="#bbdef2" />
            </linearGradient>
            <radialGradient id="glow" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#bbdef2" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#000" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx="160" cy="150" r="150" fill="url(#glow)" />

          {/* paper plane — three faces */}
          <path d="M276 44 92 150l64 22L276 44Z" fill="url(#face-a)" />
          <path d="M276 44 156 172l24 78L276 44Z" fill="url(#face-b)" opacity="0.92" />
          <path d="M156 172l24 78 18-40-42-38Z" fill="url(#face-c)" opacity="0.8" />
          <path
            d="M276 44 92 150l64 22L276 44Zm0 0L156 172l24 78L276 44Z"
            stroke="#f4f0ff"
            strokeOpacity="0.35"
            strokeWidth="0.75"
          />
        </svg>
      </div>
    </div>
  );
}
