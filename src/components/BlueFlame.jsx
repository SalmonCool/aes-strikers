import { useEffect, useRef } from 'react';

// Canvas blue flame rising from the bottom edge, with embers drifting up the page.
export default function BlueFlame() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w, h, raf;
    const flames = [];
    const embers = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnFlame = () => {
      const life = 50 + Math.random() * 50;
      flames.push({
        x: Math.random() * w,
        y: h + 10,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -(1.5 + Math.random() * 2.5),
        r: 30 + Math.random() * 50,
        life,
        max: life,
      });
    };

    const spawnEmber = (startY = h) => {
      const life = 200 + Math.random() * 300;
      embers.push({
        x: Math.random() * w,
        y: startY,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.6 + Math.random() * 1.6),
        size: 0.8 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
        life,
        max: life,
      });
    };

    for (let i = 0; i < 40; i++) spawnEmber(h * Math.random());

    let t = 0;
    const tick = () => {
      t++;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Base glow along the bottom
      const glowH = h * 0.35;
      const glow = ctx.createLinearGradient(0, h, 0, h - glowH);
      glow.addColorStop(0, 'rgba(0, 200, 255, 0.35)');
      glow.addColorStop(0.4, 'rgba(0, 90, 220, 0.15)');
      glow.addColorStop(1, 'rgba(0, 40, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, h - glowH, w, glowH);

      // Flame tongues
      const flameRate = Math.ceil(w / 60);
      for (let i = 0; i < flameRate; i++) spawnFlame();
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.x += f.vx + Math.sin((t + f.y) * 0.03) * 0.6;
        f.y += f.vy;
        f.life--;
        const p = f.life / f.max;
        const r = f.r * p;
        if (f.life <= 0 || r < 1) { flames.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(200, 255, 255, ${0.25 * p})`);
        g.addColorStop(0.3, `rgba(0, 220, 230, ${0.18 * p})`);
        g.addColorStop(0.7, `rgba(0, 90, 255, ${0.08 * p})`);
        g.addColorStop(1, 'rgba(0, 30, 120, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Embers
      if (Math.random() < 0.6) spawnEmber();
      ctx.shadowColor = 'rgba(0, 200, 255, 1)';
      ctx.shadowBlur = 8;
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.x += e.vx + Math.sin(t * 0.02 + e.phase) * 0.4;
        e.y += e.vy;
        e.life--;
        if (e.life <= 0 || e.y < -10) { embers.splice(i, 1); continue; }
        const p = e.life / e.max;
        const flicker = 0.6 + Math.sin(t * 0.2 + e.phase) * 0.4;
        ctx.fillStyle = `rgba(120, 240, 255, ${Math.min(1, p * 1.5) * flicker})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';

      if (!reduced) raf = requestAnimationFrame(tick);
    };

    if (reduced) {
      for (let i = 0; i < 60; i++) tick(); // static frame
    } else {
      tick();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="blue-flame" aria-hidden="true" />;
}
