import React, { useEffect, useRef } from 'react';

// Decorative canvas confined to the subscription page; no global listeners on
// pointer movement, no input interception, and no extra animation dependency.
export default function PlansParticles() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!host || !ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let width = 0;
    let height = 0;
    let particles = [];
    let previous = 0;
    let pointer = null;
    const colors = ['#a78bfa', '#818cf8', '#c4b5fd', '#fbbf24'];
    const random = (min, max) => min + Math.random() * (max - min);

    function draw(time) {
      const dt = previous ? Math.min((time - previous) / 16.67, 2) : 1;
      previous = time;
      ctx.clearRect(0, 0, width, height);
      const animated = !motion.matches;
      const reach = width < 640 ? 95 : 145;

      for (const p of particles) {
        if (animated) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (pointer) {
            const dx = p.x - pointer.x;
            const dy = p.y - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d > 0.1 && d < reach) {
              const force = (1 - d / reach) * 2.4 * dt;
              p.x += dx / d * force;
              p.y += dy / d * force;
            }
          }
          if (p.x < -8) p.x = width + 8;
          if (p.x > width + 8) p.x = -8;
          if (p.y < -8) p.y = height + 8;
          if (p.y > height + 8) p.y = -8;
        }
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        if (animated && pointer) {
          const distance = Math.hypot(p.x - pointer.x, p.y - pointer.y);
          if (distance < reach) {
            ctx.globalAlpha = (1 - distance / reach) * 0.38;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function tick(time) {
      frame = 0;
      if (document.hidden || motion.matches) return;
      draw(time);
      frame = window.requestAnimationFrame(tick);
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
    }

    function syncAnimation() {
      stop();
      draw(0);
      if (!document.hidden && !motion.matches && width > 0 && height > 0) {
        frame = window.requestAnimationFrame(tick);
      }
    }

    function resize() {
      const bounds = host.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(width < 640 ? 30 : 64, Math.max(18, Math.round(width * height / 23000)));
      particles = Array.from({ length: count }, (_, i) => ({
        x: random(0, width),
        y: random(0, height),
        vx: random(-0.32, 0.32),
        vy: random(-0.30, 0.30),
        radius: random(1, 2.7),
        opacity: random(0.25, 0.7),
        color: colors[i % colors.length],
      }));
      syncAnimation();
    }

    function track(event) {
      if (motion.matches) return;
      const bounds = host.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }
    function clearPointer() { pointer = null; }
    function release(event) { if (event.pointerType !== 'mouse') clearPointer(); }

    host.addEventListener('pointermove', track, { passive: true });
    host.addEventListener('pointerdown', track, { passive: true });
    host.addEventListener('pointerleave', clearPointer);
    host.addEventListener('pointerup', release);
    host.addEventListener('pointercancel', clearPointer);
    document.addEventListener('visibilitychange', syncAnimation);
    motion.addEventListener('change', syncAnimation);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(host);
    else window.addEventListener('resize', resize);
    resize();

    return () => {
      stop();
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      host.removeEventListener('pointermove', track);
      host.removeEventListener('pointerdown', track);
      host.removeEventListener('pointerleave', clearPointer);
      host.removeEventListener('pointerup', release);
      host.removeEventListener('pointercancel', clearPointer);
      document.removeEventListener('visibilitychange', syncAnimation);
      motion.removeEventListener('change', syncAnimation);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
