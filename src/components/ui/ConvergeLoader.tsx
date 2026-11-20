// Branded page loader: the Converge ribbon mark with a spinning brand-colored
// arc, a gloss sweep masked to the logo, and a soft breathing float. Transparent
// background so it sits on the app's light canvas. Loops seamlessly.
export function ConvergeLoader({ size = 120, label = "Loading" }: { size?: number; label?: string }) {
  const inset = Math.round(size * 0.11);
  return (
    <div className="cvl-wrap" role="status" aria-label={label}>
      <div className="cvl-stage" style={{ width: size, height: size }}>
        <div className="cvl-ring" />
        <div className="cvl-logo" style={{ inset }} />
        <div className="cvl-shine" style={{ inset }} />
      </div>
      {label ? (
        <div className="cvl-label">
          {label}
          <span className="cvl-dot" /><span className="cvl-dot" /><span className="cvl-dot" />
        </div>
      ) : null}
      <style>{`
        .cvl-wrap{display:flex;flex-direction:column;align-items:center;gap:20px}
        .cvl-stage{position:relative;animation:cvlFloat 3.2s ease-in-out infinite}
        .cvl-stage::before{content:"";position:absolute;inset:10%;border-radius:50%;
          background:radial-gradient(circle,rgba(25,127,249,.18)0%,rgba(19,180,155,.11)50%,rgba(255,255,255,0)75%);
          filter:blur(8px);animation:cvlAura 2.8s ease-in-out infinite;pointer-events:none}
        .cvl-ring{position:absolute;inset:-10px;border-radius:50%;
          background:conic-gradient(from 0deg,
            rgba(25,127,249,0)0deg,rgba(25,127,249,0)60deg,
            #197ff9 170deg,#15a3c7 210deg,#13b49b 250deg,
            rgba(19,180,155,0)300deg,rgba(19,180,155,0)360deg);
          -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));
                  mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));
          animation:cvlSpin 1.5s cubic-bezier(.65,.1,.35,.9) infinite}
        .cvl-logo{position:absolute;background:url("/logo-signin.png") center/contain no-repeat;
          animation:cvlBreathe 3.2s ease-in-out infinite}
        .cvl-shine{position:absolute;mix-blend-mode:screen;pointer-events:none;
          -webkit-mask:url("/logo-signin.png") center/contain no-repeat;
                  mask:url("/logo-signin.png") center/contain no-repeat;
          background:linear-gradient(112deg,transparent 38%,rgba(255,255,255,.7)50%,transparent 62%);
          background-size:280% 100%;background-position:170% 0;
          animation:cvlSweep 2.6s cubic-bezier(.4,0,.2,1) infinite}
        .cvl-label{display:flex;align-items:center;gap:7px;color:#94a3b8;font-size:11.5px;font-weight:600;
          letter-spacing:.22em;text-transform:uppercase;padding-left:.22em}
        .cvl-dot{width:4px;height:4px;border-radius:50%;background:#94a3b8;animation:cvlBlink 1.4s ease-in-out infinite}
        .cvl-dot:nth-child(2){animation-delay:.18s}
        .cvl-dot:nth-child(3){animation-delay:.36s}
        @keyframes cvlSpin{to{transform:rotate(360deg)}}
        @keyframes cvlSweep{0%{background-position:170% 0}48%{background-position:-70% 0}100%{background-position:-70% 0}}
        @keyframes cvlBreathe{0%,100%{transform:scale(.985)}50%{transform:scale(1.015)}}
        @keyframes cvlFloat{0%,100%{transform:translateY(2px)}50%{transform:translateY(-2px)}}
        @keyframes cvlAura{0%,100%{opacity:.5;transform:scale(.92)}50%{opacity:1;transform:scale(1.04)}}
        @keyframes cvlBlink{0%,100%{opacity:.3}50%{opacity:1}}
        @media (prefers-reduced-motion:reduce){
          .cvl-stage,.cvl-logo,.cvl-shine,.cvl-ring,.cvl-stage::before,.cvl-dot{animation:none}
          .cvl-shine{display:none}.cvl-ring{opacity:.7}}
      `}</style>
    </div>
  );
}
