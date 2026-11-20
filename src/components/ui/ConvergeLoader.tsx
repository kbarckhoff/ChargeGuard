// Page loader: four dots cycling around a square, in the Converge brand blue.
export function ConvergeLoader({ size = 36, label }: { size?: number; label?: string }) {
  return (
    <div className="cvl-wrap" role="status" aria-label={label || "Loading"}>
      <div className="cvl-loader" style={{ width: size, height: size }} />
      {label ? <div className="cvl-label">{label}</div> : null}
      <style>{`
        .cvl-wrap{display:flex;flex-direction:column;align-items:center;gap:14px}
        .cvl-loader{aspect-ratio:1;
          --_g:no-repeat radial-gradient(farthest-side,#197FF9 90%,#0000);
          background:var(--_g),var(--_g),var(--_g),var(--_g);
          background-size:40% 40%;animation:cvl46 1s infinite}
        .cvl-label{color:#94a3b8;font-size:11.5px;font-weight:600;letter-spacing:.22em;
          text-transform:uppercase;padding-left:.22em}
        @keyframes cvl46{
          0%  {background-position:0 0,100% 0,100% 100%,0 100%}
          40%,50%{background-position:100% 100%,100% 0,0 0,0 100%}
          90%,100%{background-position:100% 100%,0 100%,0 0,100% 0}}
        @media (prefers-reduced-motion:reduce){.cvl-loader{animation:none}}
      `}</style>
    </div>
  );
}
