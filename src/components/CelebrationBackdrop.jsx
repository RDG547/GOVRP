import React from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';

export default function CelebrationBackdrop({ active }) {
  const reduced = useReducedMotion();
  if (!active || reduced) return null;
  const colors = ['#3b82f6', '#22c55e', '#facc15', '#ef4444'];
  return createPortal(<div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] overflow-hidden">
    {Array.from({ length: 36 }, (_, i) => <motion.span key={i} className="absolute -top-8 rounded-sm" style={{ left: `${(i * 37) % 100}%`, width: i % 5 ? 7 : 3, height: i % 5 ? 11 : 30, backgroundColor: colors[i % 4] }}
      initial={{ y: -30, rotate: 0 }} animate={{ y: '110vh', rotate: 360 + i * 19, x: [0, 20, -15, 10] }} transition={{ duration: 4 + i % 3, delay: (i % 9) * .15, ease: 'linear' }} />)}
  </div>, document.body);
}
