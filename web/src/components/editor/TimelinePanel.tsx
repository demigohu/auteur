"use client";

import {
  ArrowArcLeft,
  ArrowArcRight,
  ArrowsInLineHorizontal,
  ClipboardText,
  Copy,
  MagnetStraight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Robot,
  Scissors,
  TextT,
  Trash,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { fileUrl, type MediaView, type OpInput } from "@/lib/api";
import { useEditor } from "@/lib/store";
import { clipDuration, clipStarts, timelineDuration } from "@/lib/time";
import type { AudioItem, Clip, Overlay, TextItem } from "@/lib/timeline";

const MIN_CLIP = 0.1;
const TRACK_LABEL_W = 44;
const TICK_STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
const CLIP_H = 64;
const LANE_H = 26;
const SNAP_PX = 8;
export const MEDIA_DRAG_TYPE = "application/x-auteur-media";

/** Greedy lane packing so overlapping texts (a title over subtitles) stack instead of hiding each other. */
function textLanes(texts: TextItem[]): number[] {
  const laneEnds: number[] = [];
  return texts.map((t) => {
    let lane = laneEnds.findIndex((end) => end <= t.start + 1e-3);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = t.end;
    return lane;
  });
}

type SpanKind = "text" | "overlay" | "audio";
type Edge = "move" | "in" | "out";

type Drag =
  | { kind: "clip-move"; id: string; startX: number; dx: number }
  | { kind: "clip-trim"; id: string; edge: "in" | "out"; startX: number; src_in: number; src_out: number }
  | { kind: "span"; span: SpanKind; id: string; edge: Edge; startX: number; dt: number };

/** Timeline [start, end) of a span item, and how an edge drag changes it. */
function spanOf(kind: SpanKind, item: TextItem | Overlay | AudioItem): [number, number] {
  if (kind === "text") return [(item as TextItem).start, (item as TextItem).end];
  const it = item as Overlay | AudioItem;
  return [it.start, it.start + it.src_out - it.src_in];
}

export function TimelinePanel() {
  const project = useEditor((s) => s.project);
  const px = useEditor((s) => s.pxPerSecond);
  const setZoom = useEditor((s) => s.setZoom);
  const applyOps = useEditor((s) => s.applyOps);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selectedTextId = useEditor((s) => s.selectedTextId);
  const selectedOverlayId = useEditor((s) => s.selectedOverlayId);
  const selectedAudioId = useEditor((s) => s.selectedAudioId);
  const check = useEditor((s) => s.project?.last_check ?? null);
  // Marks point at times in the timeline the checker saw; a later edit can move what sits there.
  const stale = check !== null && (project?.history.at(-1)?.id ?? null) !== check.head;
  const multiClipIds = useEditor((s) => s.multiClipIds);
  const toggleMulti = useEditor((s) => s.toggleMulti);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snap, setSnap] = useState(true);
  const [dropAt, setDropAt] = useState<{ track: "V1" | "V2" | "A1"; t: number } | null>(null);
  const [viewW, setViewW] = useState(1200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasProject = project !== null;

  // Track the visible width so the timeline always fills the panel, however short the video is.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasProject]);

  if (!project) return null;
  const { clips, texts, overlays, audio } = project.timeline;
  const media = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const duration = timelineDuration(clips);
  const locked = project.busy;
  const contentW = Math.max(viewW - TRACK_LABEL_W, (duration + 20) * px);

  // While dragging, draw items at their draft position so everything else reacts live.
  const shown = clips.map((c) =>
    drag?.kind === "clip-trim" && drag.id === c.id ? { ...c, src_in: drag.src_in, src_out: drag.src_out } : c,
  );
  const starts = clipStarts(shown);
  const lanes = textLanes(texts);
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - TRACK_LABEL_W;
    return Math.max(x / px, 0);
  };

  // Snap targets: playhead, clip edges, other items' edges, and the music's beats.
  const snapPoints = (excludeId?: string): number[] => {
    const pts = [0, useEditor.getState().time];
    clips.forEach((c, i) => c.id !== excludeId && pts.push(starts[i], starts[i] + clipDuration(c)));
    texts.forEach((t) => t.id !== excludeId && pts.push(t.start, t.end));
    overlays.forEach((o) => o.id !== excludeId && pts.push(...spanOf("overlay", o)));
    audio.forEach((a) => {
      const m = media[a.media_id];
      for (const b of m?.beats ?? []) if (b >= a.src_in && b <= a.src_out) pts.push(a.start + b - a.src_in);
    });
    return pts;
  };
  const snapTo = (t: number, excludeId?: string): number => {
    if (!snap) return t;
    let best = t;
    let dist = SNAP_PX / px;
    for (const p of snapPoints(excludeId)) {
      if (Math.abs(p - t) < dist) {
        best = p;
        dist = Math.abs(p - t);
      }
    }
    return best;
  };

  const splitAtPlayhead = () => {
    // Read the playhead on demand; subscribing would re-render the whole timeline every frame.
    const time = useEditor.getState().time;
    const i = starts.findIndex((s, k) => time > s + MIN_CLIP && time < s + clipDuration(shown[k]) - MIN_CLIP);
    if (i >= 0) applyOps("Split clip at playhead", [{ op: "split", clip_id: clips[i].id, at: Number(time.toFixed(3)) }]);
  };
  const deleteSelected = () => useEditor.getState().deleteSelection();
  // The track row under the pointer, for dragging items between V1 and V2.
  const trackAt = (e: React.PointerEvent) =>
    document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-track]")?.getAttribute("data-track");
  const addText = () => {
    const t = Number(useEditor.getState().time.toFixed(2));
    applyOps("Add text", [{ op: "add_text", text: "Title", start: t, end: Number((t + 2).toFixed(2)), style: "title", y: 0.2 }]);
  };
  const duplicate = () => selectedClipId && applyOps("Duplicate clip", [{ op: "duplicate_clip", clip_id: selectedClipId }]);
  const fit = () => setZoom((viewW - TRACK_LABEL_W - 40) / Math.max(duration, 1));

  // Ctrl/⌘ + wheel zooms around the cursor, like a pro editor.
  function onWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = scrollRef.current!;
    const t = timeAt(e.clientX);
    const next = Math.min(240, Math.max(12, px * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setZoom(next);
    requestAnimationFrame(() => {
      el.scrollLeft = t * next - (e.clientX - el.getBoundingClientRect().left - TRACK_LABEL_W);
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (drag.kind === "clip-move") return setDrag({ ...drag, dx });
    if (drag.kind === "span") return setDrag({ ...drag, dt: dx / px });
    const i = clips.findIndex((c) => c.id === drag.id);
    const clip = clips[i];
    const m = media[clip.media_id];
    // Pixels are timeline seconds; trims move the source range, which runs `speed` times faster.
    if (drag.edge === "in") {
      const src_in = Math.min(Math.max(clip.src_in + (dx / px) * clip.speed, 0), clip.src_out - MIN_CLIP);
      setDrag({ ...drag, src_in });
    } else {
      const end = snapTo(starts[i] + clipDuration(clip) + dx / px, clip.id);
      const src_out = Math.max(Math.min(clip.src_in + (end - starts[i]) * clip.speed, m?.duration ?? clip.src_out), clip.src_in + MIN_CLIP);
      setDrag({ ...drag, src_out });
    }
  }

  function spanOps(d: Extract<Drag, { kind: "span" }>): OpInput[] {
    const r3 = (v: number) => Number(v.toFixed(3));
    if (d.span === "text") {
      const t = texts.find((x) => x.id === d.id)!;
      let { start, end } = t;
      if (d.edge === "move") {
        const s = snapTo(start + d.dt, t.id);
        const e2 = snapTo(end + d.dt, t.id);
        const shift = Math.abs(s - (start + d.dt)) <= Math.abs(e2 - (end + d.dt)) ? s - start : e2 - end;
        start = Math.max(0, start + shift);
        end = start + (t.end - t.start);
      } else if (d.edge === "in") start = Math.min(Math.max(0, snapTo(start + d.dt, t.id)), end - MIN_CLIP);
      else end = Math.max(snapTo(end + d.dt, t.id), start + MIN_CLIP);
      return [{ op: "update_text", text_id: t.id, start: r3(start), end: r3(end) }];
    }
    const item = (d.span === "overlay" ? overlays : audio).find((x) => x.id === d.id)!;
    const m = media[item.media_id];
    let { start, src_in, src_out } = item;
    if (d.edge === "move") {
      const [s0, e0] = spanOf(d.span, item);
      const s = snapTo(s0 + d.dt, item.id);
      const e2 = snapTo(e0 + d.dt, item.id);
      start = Math.max(0, s0 + (Math.abs(s - (s0 + d.dt)) <= Math.abs(e2 - (e0 + d.dt)) ? s - s0 : e2 - e0));
    } else if (d.edge === "in") {
      // Dragging the left edge trims the source start and moves the item, keeping its end in place.
      const newStart = Math.max(0, snapTo(start + d.dt, item.id));
      const shift = Math.min(Math.max(newStart - start, -src_in), src_out - src_in - MIN_CLIP);
      start += shift;
      src_in += shift;
    } else {
      const end = snapTo(start + src_out - src_in + d.dt, item.id);
      src_out = Math.min(Math.max(src_in + end - start, src_in + MIN_CLIP), m?.duration ?? src_out);
    }
    const patch = { start: r3(start), src_in: r3(src_in), src_out: r3(src_out) };
    return d.span === "overlay"
      ? [{ op: "update_overlay", overlay_id: item.id, ...patch }]
      : [{ op: "update_audio", audio_id: item.id, ...patch }];
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === "span") {
      if (Math.abs(drag.dt * px) < 3) return;
      if (drag.span === "overlay" && drag.edge === "move" && trackAt(e) === "V1") {
        // B-roll dropped onto the main track becomes a clip there.
        const o = overlays.find((x) => x.id === drag.id)!;
        const t = o.start + drag.dt;
        const index = clips.filter((c, k) => starts[k] + clipDuration(c) / 2 < t).length;
        applyOps("B-roll to main track", [
          { op: "delete_overlay", overlay_id: o.id },
          { op: "add_clip", media_id: o.media_id, src_in: o.src_in, src_out: o.src_out, index },
        ]);
        return;
      }
      const label = { text: "Move text", overlay: "Move B-roll", audio: "Move music" }[drag.span];
      applyOps(drag.edge === "move" ? label : label.replace("Move", "Trim"), spanOps(drag));
      return;
    }
    const i = clips.findIndex((c) => c.id === drag.id);
    if (drag.kind === "clip-trim") {
      const c = clips[i];
      if (Math.abs(drag.src_in - c.src_in) > 0.01 || Math.abs(drag.src_out - c.src_out) > 0.01) {
        applyOps("Trim clip", [
          { op: "trim", clip_id: c.id, src_in: Number(drag.src_in.toFixed(3)), src_out: Number(drag.src_out.toFixed(3)) },
        ]);
      }
      return;
    }
    if (Math.abs(drag.dx) < 4 && trackAt(e) !== "V2") {
      if (e.shiftKey) toggleMulti(drag.id);
      else select({ clip: drag.id });
      return;
    }
    if (trackAt(e) === "V2") {
      // A clip dragged up onto V2 becomes B-roll at the same moment.
      const c = clips[i];
      applyOps("Clip to B-roll", [
        { op: "delete", clip_id: c.id },
        { op: "add_overlay", media_id: c.media_id, src_in: c.src_in, src_out: c.src_out, start: Number(Math.max(0, starts[i] + drag.dx / px).toFixed(3)) },
      ]);
      return;
    }
    const center = starts[i] + clipDuration(clips[i]) / 2 + drag.dx / px;
    const index = clips.filter((c, k) => k !== i && starts[k] + clipDuration(c) / 2 < center).length;
    if (index !== i) applyOps("Move clip", [{ op: "move", clip_id: drag.id, index }]);
  }

  // Dropping media from the bin: video on V1 inserts a clip, on V2 adds B-roll; audio adds music.
  function onMediaDragOver(track: "V1" | "V2" | "A1", e: React.DragEvent) {
    if (locked || !e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
    e.preventDefault();
    setDropAt({ track, t: snapTo(timeAt(e.clientX)) });
  }
  function onMediaDrop(track: "V1" | "V2" | "A1", e: React.DragEvent) {
    const m = media[e.dataTransfer.getData(MEDIA_DRAG_TYPE)];
    const t = Number(snapTo(timeAt(e.clientX)).toFixed(3));
    setDropAt(null);
    if (!m || locked) return;
    e.preventDefault();
    if (m.kind === "audio") {
      applyOps(`Music: ${m.name}`, [{ op: "add_audio", media_id: m.id, start: t }]);
    } else if (track === "V2") {
      applyOps(`B-roll ${m.name}`, [{ op: "add_overlay", media_id: m.id, src_in: 0, src_out: Number(Math.min(m.duration, 4).toFixed(3)), start: t }]);
    } else {
      const index = clips.filter((c, k) => starts[k] + clipDuration(c) / 2 < t).length;
      applyOps(`Add ${m.name}`, [{ op: "add_clip", media_id: m.id, src_in: 0, src_out: Number(m.duration.toFixed(3)), index }]);
    }
  }

  const spanDraft = (kind: SpanKind, id: string) => (drag?.kind === "span" && drag.span === kind && drag.id === id ? drag : null);

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <ToolButton label="Split at playhead (S)" onClick={splitAtPlayhead} disabled={locked}>
          <Scissors size={15} />
        </ToolButton>
        <ToolButton label="Duplicate clip (⌘D)" onClick={duplicate} disabled={locked || !selectedClipId}>
          <Copy size={15} />
        </ToolButton>
        <ToolButton label="Add text at playhead (T)" onClick={addText} disabled={locked}>
          <TextT size={15} />
        </ToolButton>
        <ToolButton
          label="Delete (Del)"
          onClick={deleteSelected}
          disabled={locked || (!selectedClipId && !selectedTextId && !selectedOverlayId && !selectedAudioId)}
        >
          <Trash size={15} />
        </ToolButton>
        <ToolButton
          label="Copy clip (⌘C), paste at playhead (⌘V)"
          onClick={() => {
            useEditor.getState().copyClips();
            useEditor.getState().pasteClips();
          }}
          disabled={locked || !selectedClipId}
        >
          <ClipboardText size={15} />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <ToolButton label="Undo (⌘Z)" onClick={undo} disabled={locked || !project.can_undo}>
          <ArrowArcLeft size={15} />
        </ToolButton>
        <ToolButton label="Redo (⇧⌘Z)" onClick={redo} disabled={locked || !project.can_redo}>
          <ArrowArcRight size={15} />
        </ToolButton>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-pressed={snap}
            onClick={() => setSnap((v) => !v)}
            title="Snap to playhead, clip edges and music beats"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
              snap ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-text"
            }`}
          >
            <MagnetStraight size={14} /> Snap
          </button>
          <ToolButton label="Fit to view" onClick={fit}>
            <ArrowsInLineHorizontal size={15} />
          </ToolButton>
          <ToolButton label="Zoom out (⌘ + scroll)" onClick={() => setZoom(px / 1.5)}>
            <MagnifyingGlassMinus size={15} />
          </ToolButton>
          <ToolButton label="Zoom in (⌘ + scroll)" onClick={() => setZoom(px * 1.5)}>
            <MagnifyingGlassPlus size={15} />
          </ToolButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onWheel={onWheel}
      >
        <div className="relative min-h-full" style={{ width: contentW + TRACK_LABEL_W }}>
          <Ruler px={px} width={contentW} end={duration} onSeek={(x) => seek(Math.min(timeAt(x), duration))} />

          <Track label="V2" height={34} onDragOver={(e) => onMediaDragOver("V2", e)} onDragLeave={() => setDropAt(null)} onDrop={(e) => onMediaDrop("V2", e)} hint={!overlays.length ? "Drag video here for B-roll" : undefined}>
            {overlays.map((o) => (
              <SpanBlock
                key={o.id}
                kind="overlay"
                item={o}
                px={px}
                draft={spanDraft("overlay", o.id)}
                selected={selectedOverlayId === o.id}
                locked={locked}
                onSelect={() => select({ overlay: o.id })}
                onDragStart={(edge, x) => setDrag({ kind: "span", span: "overlay", id: o.id, edge, startX: x, dt: 0 })}
              >
                <OverlayContent item={o} media={media[o.media_id]} />
              </SpanBlock>
            ))}
            {dropAt?.track === "V2" && <DropLine t={dropAt.t} px={px} />}
          </Track>

          <Track label="V1" height={CLIP_H} onDragOver={(e) => onMediaDragOver("V1", e)} onDragLeave={() => setDropAt(null)} onDrop={(e) => onMediaDrop("V1", e)}>
            {shown.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                media={media[c.media_id]}
                left={starts[i] * px}
                width={clipDuration(c) * px}
                px={px}
                selected={selectedClipId === c.id || multiClipIds.includes(c.id)}
                dragging={drag?.kind === "clip-move" && drag.id === c.id ? drag.dx : null}
                locked={locked}
                onMoveStart={(x) => setDrag({ kind: "clip-move", id: c.id, startX: x, dx: 0 })}
                onTrimStart={(edge, x) =>
                  setDrag({ kind: "clip-trim", id: c.id, edge, startX: x, src_in: c.src_in, src_out: c.src_out })
                }
              />
            ))}
            {dropAt?.track === "V1" && <DropLine t={dropAt.t} px={px} />}
          </Track>

          <Track label="T1" height={laneCount * LANE_H} hint={!texts.length ? "Text and subtitles" : undefined}>
            {texts.map((t, i) => (
              <SpanBlock
                key={t.id}
                kind="text"
                item={t}
                px={px}
                lane={lanes[i]}
                draft={spanDraft("text", t.id)}
                selected={selectedTextId === t.id}
                locked={locked}
                onSelect={() => {
                  select({ text: t.id });
                  seek(t.start);
                }}
                onDragStart={(edge, x) => setDrag({ kind: "span", span: "text", id: t.id, edge, startX: x, dt: 0 })}
              >
                <span className="truncate px-1.5 text-[10px]">{t.text.replace("\n", " ")}</span>
              </SpanBlock>
            ))}
          </Track>

          <Track label="A1" height={40} onDragOver={(e) => onMediaDragOver("A1", e)} onDragLeave={() => setDropAt(null)} onDrop={(e) => onMediaDrop("A1", e)} hint={!audio.length ? "Drag music here" : undefined}>
            {audio.map((a) => (
              <SpanBlock
                key={a.id}
                kind="audio"
                item={a}
                px={px}
                draft={spanDraft("audio", a.id)}
                selected={selectedAudioId === a.id}
                locked={locked}
                onSelect={() => select({ audio: a.id })}
                onDragStart={(edge, x) => setDrag({ kind: "span", span: "audio", id: a.id, edge, startX: x, dt: 0 })}
              >
                <MusicContent item={a} media={media[a.media_id]} px={px} />
              </SpanBlock>
            ))}
            {dropAt?.track === "A1" && <DropLine t={dropAt.t} px={px} />}
          </Track>

          {check?.marks.map((m, i) => (
            <CheckMarkBand key={i} start={m.start} end={m.end} label={m.label} stale={stale} px={px} onSeek={() => seek(m.start)} />
          ))}
          <Playhead px={px} />
        </div>
      </div>

      <AnimatePresence>{locked && <LockedBanner />}</AnimatePresence>
    </section>
  );
}

function ToolButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35"
    >
      {props.children}
    </button>
  );
}

function Ruler({ px, width, end, onSeek }: { px: number; width: number; end: number; onSeek: (clientX: number) => void }) {
  const step = TICK_STEPS.find((s) => s * px >= 64) ?? 120;
  const ticks = Array.from({ length: Math.ceil(width / (step * px)) + 1 }, (_, i) => i * step);
  const [scrubbing, setScrubbing] = useState(false);
  return (
    <div
      className="sticky top-0 z-30 h-6 cursor-ew-resize border-b border-line bg-panel select-none"
      style={{ marginLeft: TRACK_LABEL_W, width }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setScrubbing(true);
        onSeek(e.clientX);
      }}
      onPointerMove={(e) => scrubbing && onSeek(e.clientX)}
      onPointerUp={() => setScrubbing(false)}
    >
      {/* The part past the end of the video is dimmed. */}
      <div className="absolute top-0 bottom-0 bg-bg/40" style={{ left: end * px, right: 0 }} />
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-line-strong" style={{ left: t * px }}>
          <span className="absolute left-1 top-1 font-mono text-[10px] leading-none text-faint">
            {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
            {step < 1 && t % 1 ? `.${Math.round((t % 1) * 100)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Track(props: {
  label: string;
  height: number;
  hint?: string;
  children: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      data-track={props.label}
      className="relative flex border-b border-line"
      style={{ height: props.height + 12 }}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <div
        className="sticky left-0 z-20 grid shrink-0 place-items-center border-r border-line bg-panel font-mono text-[10px] text-faint"
        style={{ width: TRACK_LABEL_W }}
      >
        {props.label}
      </div>
      <div className="relative flex-1 py-1.5">
        {props.hint && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[10px] text-faint">{props.hint}</span>}
        {props.children}
      </div>
    </div>
  );
}

function DropLine({ t, px }: { t: number; px: number }) {
  return <div className="pointer-events-none absolute top-0 bottom-0 z-40 w-0.5 bg-accent" style={{ left: t * px - 1 }} />;
}

/** A movable, trimmable block on the T1, V2 and A1 tracks. */
function SpanBlock(props: {
  kind: SpanKind;
  item: TextItem | Overlay | AudioItem;
  px: number;
  lane?: number;
  draft: { edge: Edge; dt: number } | null;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  onDragStart: (edge: Edge, clientX: number) => void;
  children: React.ReactNode;
}) {
  const { px, draft, selected, locked } = props;
  let [start, end] = spanOf(props.kind, props.item);
  if (draft) {
    if (draft.edge === "move") [start, end] = [start + draft.dt, end + draft.dt];
    else if (draft.edge === "in") start = Math.min(start + draft.dt, end - MIN_CLIP);
    else end = Math.max(end + draft.dt, start + MIN_CLIP);
  }
  const capture = (e: React.PointerEvent) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const style: React.CSSProperties =
    props.lane !== undefined
      ? { left: start * px, width: Math.max((end - start) * px, 6), top: 6 + props.lane * LANE_H, height: LANE_H - 4 }
      : { left: start * px, width: Math.max((end - start) * px, 6), top: 6, bottom: 6 };
  return (
    <div
      role="button"
      tabIndex={0}
      title={props.kind === "text" ? (props.item as TextItem).text : undefined}
      className={`group absolute flex items-center overflow-hidden rounded-md border select-none ${
        selected ? "z-20 border-accent bg-accent-soft text-text ring-1 ring-accent" : "z-10 border-line-strong bg-panel-2 text-muted hover:text-text"
      } ${draft ? "shadow-[0_8px_24px_rgb(0_0_0/0.5)]" : ""} ${locked ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"}`}
      style={style}
      onPointerDown={(e) => {
        if (locked) return;
        capture(e);
        props.onSelect();
        props.onDragStart("move", e.clientX);
      }}
    >
      {props.children}
      {(["in", "out"] as const).map((edge) => (
        <div
          key={edge}
          className={`absolute top-0 bottom-0 z-10 w-1.5 cursor-ew-resize transition-colors group-hover:bg-accent/60 ${edge === "in" ? "left-0" : "right-0"}`}
          onPointerDown={(e) => {
            if (locked) return;
            e.stopPropagation();
            capture(e);
            props.onSelect();
            props.onDragStart(edge, e.clientX);
          }}
        />
      ))}
    </div>
  );
}

function ClipBlock(props: {
  clip: Clip;
  media: MediaView | undefined;
  left: number;
  width: number;
  px: number;
  selected: boolean;
  dragging: number | null;
  locked: boolean;
  onMoveStart: (clientX: number) => void;
  onTrimStart: (edge: "in" | "out", clientX: number) => void;
}) {
  const { clip, media, selected, dragging, locked } = props;
  const reduce = useReducedMotion();
  const graded = Object.entries(clip.grade).some(([k, v]) => !["shadow_hue", "highlight_hue", "look", "log"].includes(k) && v !== 0);
  const capture = (e: React.PointerEvent) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  return (
    <motion.div
      // Layout animation shows clips sliding into place when the agent or the user rearranges them.
      layout={dragging === null && !reduce ? "position" : false}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border bg-raised select-none ${
        selected ? "border-accent ring-1 ring-accent" : "border-line-strong"
      } ${dragging !== null ? "z-30 shadow-[0_8px_24px_rgb(0_0_0/0.5)]" : "z-10"} ${locked ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"}`}
      style={{ left: props.left, width: Math.max(props.width, 4), x: dragging ?? 0 }}
      onPointerDown={(e) => {
        if (locked) return;
        capture(e);
        props.onMoveStart(e.clientX);
      }}
    >
      {media && <Filmstrip media={media} clip={clip} width={props.width} px={props.px} />}
      {clip.transition && (
        <span
          title={`Transisi ${clip.transition.kind} ${clip.transition.duration}s`}
          className="absolute top-0 bottom-0 left-0 z-10 bg-gradient-to-r from-text/35 to-transparent"
          style={{ width: Math.max(6, clip.transition.duration * props.px) }}
        />
      )}
      <div className="absolute bottom-1 left-2 z-10 flex gap-1">
        {clip.speed !== 1 && <Badge>{clip.speed}x</Badge>}
        {clip.zoom && <Badge>zoom</Badge>}
        {clip.transition && <Badge>{clip.transition.kind}</Badge>}
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/70 to-transparent px-2 pt-1 pb-3">
        <span className="truncate text-[11px] font-medium text-paper">{media?.name ?? clip.media_id}</span>
        <span className="shrink-0 font-mono text-[10px] text-paper/70">{clipDuration(clip).toFixed(1)}s</span>
        {graded && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" title="Color graded" />}
      </div>
      {(["in", "out"] as const).map((edge) => (
        <div
          key={edge}
          className={`absolute top-0 bottom-0 w-2 cursor-ew-resize bg-accent/0 transition-colors group-hover:bg-accent/60 ${
            edge === "in" ? "left-0 rounded-l-md" : "right-0 rounded-r-md"
          }`}
          onPointerDown={(e) => {
            if (locked) return;
            e.stopPropagation();
            capture(e);
            props.onTrimStart(edge, e.clientX);
          }}
        />
      ))}
    </motion.div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[3px] bg-bg/80 px-1 font-mono text-[9px] leading-[14px] text-text">{children}</span>;
}

function OverlayContent({ item, media }: { item: Overlay; media: MediaView | undefined }) {
  return (
    <>
      {media && (
        <span
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ backgroundImage: `url(${fileUrl(media.thumb_url)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
        />
      )}
      <span className="relative truncate px-1.5 text-[10px] text-paper [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">B-roll {item.layout !== "full" ? "PiP" : ""}</span>
    </>
  );
}

function MusicContent({ item, media, px }: { item: AudioItem; media: MediaView | undefined; px: number }) {
  const total = media?.duration ?? item.src_out;
  // Beats inside the used part of the song, relative to the block.
  const beats = (media?.beats ?? []).filter((b) => b >= item.src_in && b <= item.src_out).map((b) => b - item.src_in);
  return (
    <>
      {media?.filmstrip_url && (
        <span
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            backgroundImage: `url(${fileUrl(media.filmstrip_url)})`,
            backgroundSize: `${total * px}px 100%`,
            backgroundPosition: `${-item.src_in * px}px 0`,
          }}
        />
      )}
      {beats.map((b) => (
        <span key={b} className="pointer-events-none absolute top-0 bottom-0 w-px bg-text/25" style={{ left: b * px }} />
      ))}
      <span className="relative truncate px-1.5 text-[10px] text-text">{media?.name}</span>
    </>
  );
}

/**
 * Frames at their real aspect ratio, each showing the source second under it, like CapCut's
 * track. Falls back to the media thumbnail for uploads made before filmstrips existed.
 */
function Filmstrip({ media, clip, width, px }: { media: MediaView; clip: Clip; width: number; px: number }) {
  const tileW = (CLIP_H * media.width) / media.height;
  const seconds = Math.max(1, Math.ceil(media.duration));
  if (!media.filmstrip_url) {
    return (
      <div
        className="absolute inset-0 opacity-70"
        style={{ backgroundImage: `url(${fileUrl(media.thumb_url)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
      />
    );
  }
  const tiles = Math.ceil(width / tileW);
  return (
    <div className="absolute inset-0 flex opacity-75">
      {Array.from({ length: tiles }, (_, k) => {
        const second = Math.min(seconds - 1, Math.floor(clip.src_in + (((k + 0.5) * tileW) / px) * clip.speed));
        return (
          <div
            key={k}
            className="h-full shrink-0"
            style={{
              width: tileW,
              backgroundImage: `url(${fileUrl(media.filmstrip_url!)})`,
              backgroundSize: `${seconds * tileW}px 100%`,
              backgroundPosition: `${-second * tileW}px 0`,
            }}
          />
        );
      })}
    </div>
  );
}

/** A range the checker flagged (e.g. subject out of frame), shown across all tracks. */
function CheckMarkBand(props: { start: number; end: number; label: string; stale: boolean; px: number; onSeek: () => void }) {
  const label = props.stale ? `${props.label} · before your edits` : props.label;
  return (
    <motion.button
      type="button"
      onClick={props.onSeek}
      title={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: props.stale ? 0.55 : 1 }}
      className={`absolute top-0 bottom-0 z-30 border-x ${props.stale ? "border-dashed border-danger/60 bg-danger/5" : "border-danger/70 bg-danger/15"}`}
      style={{ left: TRACK_LABEL_W + props.start * props.px, width: Math.max((props.end - props.start) * props.px, 3) }}
    >
      <span
        className={`absolute top-1 left-1 truncate rounded-[3px] px-1 text-[9px] leading-[14px] font-medium ${
          props.stale ? "border border-dashed border-danger bg-bg text-danger" : "bg-danger text-bg"
        }`}
      >
        {label}
      </span>
    </motion.button>
  );
}

function Playhead({ px }: { px: number }) {
  const time = useEditor((s) => s.time);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-accent" style={{ left: TRACK_LABEL_W + time * px }}>
      <div className="absolute -top-px -left-[5px] size-[11px] rotate-45 rounded-[2px] bg-accent" />
    </div>
  );
}

function LockedBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="pointer-events-none absolute right-3 bottom-3 z-50 flex items-center gap-2 rounded-md border border-accent/40 bg-panel-2/95 px-3 py-1.5 text-xs text-text shadow-lg"
    >
      <Robot size={14} className="text-accent" />
      The agent is editing. The timeline is locked until it finishes.
    </motion.div>
  );
}
