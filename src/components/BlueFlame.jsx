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
      // Effect is soft/blurry by nature, so render at 1x to save GPU work on high-DPI screens
      const dpr = 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnFlame = () => {
      // Steady burn: very slow rise, long life so tongues hold their shape
      const life = 120 + Math.random() * 60;
      flames.push({
        x: Math.random() * w,
        y: h + 10,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -(0.25 + Math.random() * 0.4),
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
        vy: -(0.3 + Math.random() * 0.8),
        size: 0.8 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
        life,
        max: life,
      });
    };

    // Fairies: glowing orbs with four fluttering wings, drifting up slowly
    const fairies = [];
    const MAX_FAIRIES = 4;
    const spawnFairy = (startY = h + 20) => {
      fairies.push({
        x: w * (0.1 + Math.random() * 0.8),
        y: startY,
        vy: -(0.35 + Math.random() * 0.35),
        size: 2.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        wander: 20 + Math.random() * 40,
        flap: 0.25 + Math.random() * 0.15,
        baseX: 0,
      });
      fairies[fairies.length - 1].baseX = fairies[fairies.length - 1].x;
    };

    const drawWing = (x, y, rx, ry, angle, alpha) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(190, 250, 255, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(rx, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawFairy = (f) => {
      const flap = 0.35 + Math.abs(Math.sin(t * f.flap + f.phase)) * 0.65; // 0.35..1 wing open
      const s = f.size;
      // Upper wings (larger) and lower wings (smaller), mirrored left/right
      for (const side of [-1, 1]) {
        const up = side === 1 ? -0.5 : Math.PI + 0.5;
        const down = side === 1 ? 0.45 : Math.PI - 0.45;
        drawWing(f.x, f.y, s * 1.9, s * 1.1 * flap, up, 0.35);
        drawWing(f.x, f.y, s * 1.3, s * 0.8 * flap, down, 0.28);
      }
      // Glowing body
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, s * 4);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.25, 'rgba(140, 250, 255, 0.6)');
      g.addColorStop(1, 'rgba(0, 200, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, s * 4, 0, Math.PI * 2);
      ctx.fill();
    };

    for (let i = 0; i < 8; i++) spawnEmber(h * Math.random());
    spawnFairy(h * 0.6);

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
      // ~80% fewer flame particles than the original (w / 60)
      // (w / 420 offsets the longer flame life so on-screen particle count stays the same)
      const flameRate = w / 650;
      for (let i = 0; i < Math.floor(flameRate); i++) spawnFlame();
      if (Math.random() < flameRate % 1) spawnFlame();
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.x += f.vx + Math.sin((t + f.y) * 0.008) * 0.12;
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
      if (Math.random() < 0.12) spawnEmber();
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.x += e.vx + Math.sin(t * 0.02 + e.phase) * 0.4;
        e.y += e.vy;
        e.life--;
        if (e.life <= 0 || e.y < -10) { embers.splice(i, 1); continue; }
        const p = e.life / e.max;
        const flicker = 0.6 + Math.sin(t * 0.2 + e.phase) * 0.4;
        const a = Math.min(1, p * 1.5) * flicker;
        // Cheap glow: faint halo circle instead of shadowBlur
        ctx.fillStyle = `rgba(0, 180, 255, ${a * 0.25})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(150, 245, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fairies
      if (fairies.length < MAX_FAIRIES && Math.random() < 0.004) spawnFairy();
      for (let i = fairies.length - 1; i >= 0; i--) {
        const f = fairies[i];
        f.y += f.vy;
        f.x = f.baseX + Math.sin(t * 0.012 + f.phase) * f.wander;
        if (f.y < -30) { fairies.splice(i, 1); continue; }
        drawFairy(f);
      }

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
