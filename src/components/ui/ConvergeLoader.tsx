// Branded page loader: the Converge mark drawn as a thin grey figure-8 track
// with a blue→teal segment running continuously along its path. Transparent
// background; loops seamlessly. Motion traces the logo's interlocking loops.
export function ConvergeLoader({ size = 120, label = "Loading" }: { size?: number; label?: string }) {
  const D = "M 100 100 C 74 72, 44 78, 46 100 C 48 124, 80 128, 100 100 C 120 76, 154 74, 156 100 C 158 126, 126 128, 100 100 Z";
  return (
    <div className="cvl-wrap" role="status" aria-label={label}>
      <svg className="cvl-svg" width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="cvlRun" x1="20" y1="60" x2="180" y2="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5EA8FF" />
            <stop offset="55%" stopColor="#197FF9" />
            <stop offset="100%" stopColor="#13B49B" />
          </linearGradient>
        </defs>
        <g transform="rotate(-22 100 100)">
          <path d={D} stroke="#cbd5e1" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <path className="cvl-runner" d={D} stroke="url(#cvlRun)" strokeWidth="9" strokeLinecap="round"
            pathLength={100} strokeDasharray="24 76" />
        </g>
      </svg>
      {label ? (
        <div className="cvl-label">
          {label}
          <span className="cvl-dot" /><span className="cvl-dot" /><span className="cvl-dot" />
        </div>
      ) : null}
      <style>{`
        .cvl-wrap{display:flex;flex-direction:column;align-items:center;gap:16px}
        .cvl-svg{overflow:visible}
        .cvl-runner{filter:drop-shadow(0 0 4px rgba(25,127,249,.45));
          animation:cvlRun 2s linear infinite}
        .cvl-label{display:flex;align-items:center;gap:7px;color:#94a3b8;font-size:11.5px;font-weight:600;
          letter-spacing:.22em;text-transform:uppercase;padding-left:.22em}
        .cvl-dot{width:4px;height:4px;border-radius:50%;background:#94a3b8;animation:cvlBlink 1.4s ease-in-out infinite}
        .cvl-dot:nth-child(2){animation-delay:.18s}
        .cvl-dot:nth-child(3){animation-delay:.36s}
        @keyframes cvlRun{to{stroke-dashoffset:-100}}
        @keyframes cvlBlink{0%,100%{opacity:.3}50%{opacity:1}}
        @media (prefers-reduced-motion:reduce){.cvl-runner,.cvl-dot{animation:none}}
      `}</style>
    </div>
  );
}
