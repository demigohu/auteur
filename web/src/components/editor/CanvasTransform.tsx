"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { clipDuration, clipStarts } from "@/lib/time";
import type { Overlay, Transform } from "@/lib/timeline";
import { boxOf, overlayRect } from "@/lib/overlay";
import { centerOf, fitRect, IDENTITY, moveBy, type Point, rotateBy, scaleBy } from "@/lib/transform";

type Mode = "move" | "scale" | "rotate";
type Drag = { mode: Mode; from: Point; start: Transform; center: Point; last: Transform };

const LABEL: Record<Mode, string> = { move: "Move clip", scale: "Scale clip", rotate: "Rotate clip" };

/** Handles over the preview for the selected clip while it is on screen: drag the box to move it, the
 * corner to scale and the round handle to rotate. Sits exactly over the Player's letterboxed frame. */
export function CanvasTransform({ width: W, height: H }: { width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<Drag | null>(null);
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedClipId);
  const time = useEditor((s) => s.time);
  const before = useEditor((s) => s.before);
  const previewTransform = useEditor((s) => s.previewTransform);
  const applyOps = useEditor((s) => s.applyOps);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clips = project?.timeline.clips ?? [];
  const starts = clipStarts(clips);
  const onScreen = clips.findIndex((c, i) => time >= starts[i] && time < starts[i] + clipDuration(c));
  const clip = onScreen >= 0 && clips[onScreen].id === selected ? clips[onScreen] : null;
  const active = clip && !before && !project?.busy && size.w > 0;

  const frame = fitRect(size.w, size.h, W, H);
  const t = clip?.transform ?? IDENTITY;
  const center = centerOf(frame, t);
  const bw = frame.width * t.scale;
  const bh = frame.height * t.scale;

  const local = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const begin = (mode: Mode, e: React.PointerEvent) => {
    if (!clip) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, from: local(e), start: t, center, last: t };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !clip) return;
    const p = local(e);
    const next =
      d.mode === "move"
        ? moveBy(d.start, p.x - d.from.x, p.y - d.from.y, frame)
        : d.mode === "scale"
          ? scaleBy(d.start, d.center, d.from, p)
          : rotateBy(d.start, d.center, d.from, p, e.shiftKey);
    d.last = next;
    previewTransform(clip.id, next);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !clip || JSON.stringify(d.last) === JSON.stringify(d.start)) return;
    applyOps(LABEL[d.mode], [{ op: "set_transform", clip_id: clip.id, transform: d.last }]);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {size.w > 0 && <TextHandle container={ref} frame={frame} />}
      {size.w > 0 && <OverlayHandle container={ref} frame={frame} width={W} height={H} />}
      {active && (
        <div
          role="group"
          aria-label="Clip position on the canvas"
          className="pointer-events-auto absolute cursor-move border-2 border-dashed border-accent"
          style={{
            left: center.x,
            top: center.y,
            width: bw,
            height: bh,
            transform: `translate(-50%, -50%) rotate(${t.rotation}deg)`,
            touchAction: "none",
          }}
          onPointerDown={(e) => begin("move", e)}
          onPointerMove={move}
          onPointerUp={end}
          onDoubleClick={() => clip.transform && applyOps("Reset position", [{ op: "set_transform", clip_id: clip.id, transform: null }])}
          title="Drag to move. Double-click to reset."
        >
          <span
            aria-label="Scale"
            className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-[3px] border-2 border-ink bg-accent"
            onPointerDown={(e) => begin("scale", e)}
            onPointerMove={move}
            onPointerUp={end}
          />
          <span className="absolute -top-7 left-1/2 h-5 w-px -translate-x-1/2 bg-accent" />
          <span
            aria-label="Rotate"
            className="absolute -top-9 left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-ink bg-accent"
            onPointerDown={(e) => begin("rotate", e)}
            onPointerMove={move}
            onPointerUp={end}
          />
        </div>
      )}
    </div>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The selected text, while on screen: drag its box to place it (TextItem.x / .y, the center as fractions
 * of the frame). The box is measured from the rendered text, so it fits any look and line count. */
function TextHandle({ container, frame }: { container: React.RefObject<HTMLDivElement | null>; frame: ReturnType<typeof fitRect> }) {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedTextId);
  const time = useEditor((s) => s.time);
  const before = useEditor((s) => s.before);
  const previewTextPosition = useEditor((s) => s.previewTextPosition);
  const applyOps = useEditor((s) => s.applyOps);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<{ from: Point; x: number; y: number; last: { x: number; y: number } } | null>(null);

  const item = project?.timeline.texts.find((t) => t.id === selected && time >= t.start && time < t.end) ?? null;
  const show = item && !before && !project?.busy;

  useLayoutEffect(() => {
    if (!show || !item) return; // nothing drawn then; a stale box is never shown
    // The Player draws the frame on its own schedule; measure on the next frame.
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-text-id="${item.id}"]`);
      const host = container.current;
      if (!el || !host) return setBox(null);
      const r = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      setBox({ left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height });
    });
    return () => cancelAnimationFrame(id);
  }, [show, item, item?.x, item?.y, item?.text, frame.width, frame.height, container]);

  if (!show || !item || !box) return null;
  const local = (e: React.PointerEvent): Point => {
    const h = container.current!.getBoundingClientRect();
    return { x: e.clientX - h.left, y: e.clientY - h.top };
  };
  return (
    <div
      role="group"
      aria-label="Text position on the canvas"
      title="Drag to move the text"
      className="pointer-events-auto absolute cursor-move rounded-[4px] border-2 border-dashed border-accent"
      style={{ left: box.left - 6, top: box.top - 4, width: box.width + 12, height: box.height + 8, touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { from: local(e), x: item.x, y: item.y, last: { x: item.x, y: item.y } };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = local(e);
        const next = {
          x: Number(clamp01(d.x + (p.x - d.from.x) / frame.width).toFixed(4)),
          y: Number(clamp01(d.y + (p.y - d.from.y) / frame.height).toFixed(4)),
        };
        d.last = next;
        previewTextPosition(item.id, next.x, next.y);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && (d.last.x !== d.x || d.last.y !== d.y)) {
          applyOps("Move text", [{ op: "update_text", text_id: item.id, x: d.last.x, y: d.last.y }]);
        }
      }}
    />
  );
}

/** The selected B-roll while on screen: drag to place it anywhere, the corner to resize (Overlay.box). */
function OverlayHandle(props: { container: React.RefObject<HTMLDivElement | null>; frame: ReturnType<typeof fitRect>; width: number; height: number }) {
  const { container, frame, width: W, height: H } = props;
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedOverlayId);
  const time = useEditor((s) => s.time);
  const before = useEditor((s) => s.before);
  const previewOverlayBox = useEditor((s) => s.previewOverlayBox);
  const applyOps = useEditor((s) => s.applyOps);
  const drag = useRef<{ mode: "move" | "scale"; from: Point; start: NonNullable<Overlay["box"]>; center: Point; last: NonNullable<Overlay["box"]> } | null>(null);

  const item = project?.timeline.overlays.find(
    (o) => o.id === selected && time >= o.start && time < o.start + (o.src_out - o.src_in),
  );
  if (!item || before || project?.busy) return null;
  const [x, y, w, h] = overlayRect(item, W, H);
  const k = frame.width / W;
  const rect = { left: frame.left + x * k, top: frame.top + y * k, width: w * k, height: h * k };
  const local = (e: React.PointerEvent): Point => {
    const r = container.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const begin = (mode: "move" | "scale", e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const start = boxOf(item);
    drag.current = { mode, from: local(e), start, last: start, center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let next = d.start;
    if (d.mode === "move") {
      next = {
        ...d.start,
        x: Number(clamp(d.start.x + (p.x - d.from.x) / frame.width, -0.5, 1.5).toFixed(4)),
        y: Number(clamp(d.start.y + (p.y - d.from.y) / frame.height, -0.5, 1.5).toFixed(4)),
      };
    } else {
      const ratio = Math.hypot(p.x - d.center.x, p.y - d.center.y) / Math.max(1, Math.hypot(d.from.x - d.center.x, d.from.y - d.center.y));
      next = { ...d.start, scale: Number(clamp(d.start.scale * ratio, 0.05, 1.5).toFixed(3)) };
    }
    d.last = next;
    previewOverlayBox(item.id, next);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && JSON.stringify(d.last) !== JSON.stringify(d.start)) {
      applyOps(d.mode === "move" ? "Move B-roll" : "Resize B-roll", [{ op: "update_overlay", overlay_id: item.id, box: d.last }]);
    }
  };
  return (
    <div
      role="group"
      aria-label="B-roll position on the canvas"
      title="Drag to move; the corner resizes"
      className="pointer-events-auto absolute cursor-move border-2 border-dashed border-pink"
      style={{ ...rect, touchAction: "none" }}
      onPointerDown={(e) => begin("move", e)}
      onPointerMove={move}
      onPointerUp={end}
    >
      <span
        aria-label="Resize B-roll"
        className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-[3px] border-2 border-ink bg-pink"
        onPointerDown={(e) => begin("scale", e)}
        onPointerMove={move}
        onPointerUp={end}
      />
    </div>
  );
}
