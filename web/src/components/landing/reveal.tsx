"use client";

import { motion, useReducedMotion } from "motion/react";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * The reference's `data-reveal="lines"`: each line sits in a clipping mask and rises into place with a
 * slight tilt (pivoting on its bottom left) when the heading scrolls into view.
 */
export function RevealLines({ lines, className, as = "h2" }: { lines: { text: React.ReactNode; className?: string }[]; className?: string; as?: "h2" | "h3" | "p" }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.4 }}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-clip pb-[0.06em]">
          <motion.span
            className={`block origin-bottom-left ${l.className ?? ""}`}
            variants={reduce ? undefined : { hidden: { y: "110%", rotate: 4 }, shown: { y: "0%", rotate: 0 } }}
            transition={{ delay: i * 0.1, duration: 1.1, ease: EASE_OUT }}
          >
            {l.text}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

/** The reference's `data-reveal="fade"`: up 44px and in, once, as it enters. */
export function Fade({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 44 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay, duration: 1, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
