"use client";

import { ArrowArcLeft, ArrowArcRight, MagnifyingGlassMinus, MagnifyingGlassPlus, Robot, Scissors, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { fileUrl, type MediaView } from "@/lib/api";
import { useEditor } from "@/lib/store";
import { clipDuration, clipStarts, timelineDuration } from "@/lib/time";
import type { AudioItem, Clip, Overlay, TextItem } from "@/lib/timeline";

const MIN_CLIP = 0.1;
const TRACK_LABEL_W = 44;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60];
const CLIP_H = 64;
const LANE_H = 26;

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

type Drag =
  | { kind: "move"; clipId: string; startX: number; dx: number }
  | { kind: "trim"; clipId: string; edge: "in" | "out"; startX: number; src_in: number; src_out: number };

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
  const marks = useEditor((s) => s.marks);
  const [drag, setDrag] = useState<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!project) return null;
  const { clips, texts, overlays, audio } = project.timeline;
  const media = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const duration = timelineDuration(clips);
  const locked = project.busy;
  const contentW = Math.max(duration + 8, 30) * px;

  // While trimming, draw the clip at its draft length so later clips slide along live.
  const shown = clips.map((c) =>
    drag?.kind === "trim" && drag.clipId === c.id ? { ...c, src_in: drag.src_in, src_out: drag.src_out } : c,
  );
  const starts = clipStarts(shown);
  const lanes = textLanes(texts);
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - TRACK_LABEL_W;
    return Math.min(Math.max(x / px, 0), duration);
  };

  const splitAtPlayhead = () => {
    // Read the playhead on demand; subscribing would re-render the whole timeline every frame.
    const time = useEditor.getState().time;
    const i = starts.findIndex((s, k) => time > s + MIN_CLIP && time < s + clipDuration(shown[k]) - MIN_CLIP);
    if (i >= 0) applyOps("Potong klip di playhead", [{ op: "split", clip_id: clips[i].id, at: Number(time.toFixed(3)) }]);
  };
  const deleteSelected = () => {
    if (selectedClipId) applyOps("Hapus klip", [{ op: "delete", clip_id: selectedClipId }]);
    else if (selectedTextId) applyOps("Hapus teks", [{ op: "delete_text", text_id: selectedTextId }]);
    else if (selectedOverlayId) applyOps("Hapus B-roll", [{ op: "delete_overlay", overlay_id: selectedOverlayId }]);
    else if (selectedAudioId) applyOps("Hapus musik", [{ op: "delete_audio", audio_id: selectedAudioId }]);
    select({});
  };

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (drag.kind === "move") return setDrag({ ...drag, dx });
    const clip = clips.find((c) => c.id === drag.clipId)!;
    const m = media[clip.media_id];
    // Pixels are timeline seconds; trims move the source range, which runs `speed` times faster.
    const delta = (dx / px) * clip.speed;
    if (drag.edge === "in") {
      const src_in = Math.min(Math.max(clip.src_in + delta, 0), clip.src_out - MIN_CLIP);
      setDrag({ ...drag, src_in });
    } else {
      const src_out = Math.max(Math.min(clip.src_out + delta, m?.duration ?? clip.src_out), clip.src_in + MIN_CLIP);
      setDrag({ ...drag, src_out });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    setDrag(null);
    const i = clips.findIndex((c) => c.id === drag.clipId);
    if (drag.kind === "trim") {
      const c = clips[i];
      if (Math.abs(drag.src_in - c.src_in) > 0.01 || Math.abs(drag.src_out - c.src_out) > 0.01) {
        applyOps("Trim klip", [
          { op: "trim", clip_id: c.id, src_in: Number(drag.src_in.toFixed(3)), src_out: Number(drag.src_out.toFixed(3)) },
        ]);
      }
      return;
    }
    if (Math.abs(drag.dx) < 4) {
      select({ clip: drag.clipId });
      return;
    }
    const center = starts[i] + clipDuration(clips[i]) / 2 + drag.dx / px;
    const index = clips.filter((c, k) => k !== i && starts[k] + clipDuration(c) / 2 < center).length;
    if (index !== i) applyOps("Geser klip", [{ op: "move", clip_id: drag.clipId, index }]);
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col border-t border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <ToolButton label="Potong di playhead (S)" onClick={splitAtPlayhead} disabled={locked}>
          <Scissors size={15} />
        </ToolButton>
        <ToolButton
          label="Hapus (Delete)"
          onClick={deleteSelected}
          disabled={locked || (!selectedClipId && !selectedTextId && !selectedOverlayId && !selectedAudioId)}
        >
          <Trash size={15} />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <ToolButton label="Undo (⌘Z)" onClick={undo} disabled={locked || !project.can_undo}>
          <ArrowArcLeft size={15} />
        </ToolButton>
        <ToolButton label="Redo (⇧⌘Z)" onClick={redo} disabled={locked || !project.can_redo}>
          <ArrowArcRight size={15} />
        </ToolButton>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton label="Perkecil" onClick={() => setZoom(px / 1.5)}>
            <MagnifyingGlassMinus size={15} />
          </ToolButton>
          <ToolButton label="Perbesar" onClick={() => setZoom(px * 1.5)}>
            <MagnifyingGlassPlus size={15} />
          </ToolButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="relative h-full" style={{ width: contentW + TRACK_LABEL_W }}>
          <Ruler px={px} width={contentW} onSeek={(x) => seek(timeAt(x))} />

          {overlays.length > 0 && (
            <Track label="V2" height={36}>
              {overlays.map((o) => (
                <OverlayBlock
                  key={o.id}
                  item={o}
                  media={media[o.media_id]}
                  px={px}
                  selected={selectedOverlayId === o.id}
                  onSelect={() => {
                    select({ overlay: o.id });
                    seek(o.start);
                  }}
                />
              ))}
            </Track>
          )}

          <Track label="V1" height={CLIP_H}>
            {shown.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                media={media[c.media_id]}
                left={starts[i] * px}
                width={clipDuration(c) * px}
                px={px}
                selected={selectedClipId === c.id}
                dragging={drag?.kind === "move" && drag.clipId === c.id ? drag.dx : null}
                locked={locked}
                onMoveStart={(x) => setDrag({ kind: "move", clipId: c.id, startX: x, dx: 0 })}
                onTrimStart={(edge, x) =>
                  setDrag({ kind: "trim", clipId: c.id, edge, startX: x, src_in: c.src_in, src_out: c.src_out })
                }
              />
            ))}
          </Track>

          <Track label="T1" height={laneCount * LANE_H}>
            {texts.map((t, i) => (
              <TextBlock
                key={t.id}
                item={t}
                lane={lanes[i]}
                px={px}
                selected={selectedTextId === t.id}
                onSelect={() => {
                  select({ text: t.id });
                  seek(t.start);
                }}
              />
            ))}
          </Track>

          {audio.length > 0 && (
            <Track label="A1" height={40}>
              {audio.map((a) => (
                <MusicBlock
                  key={a.id}
                  item={a}
                  media={media[a.media_id]}
                  px={px}
                  limit={duration}
                  selected={selectedAudioId === a.id}
                  onSelect={() => select({ audio: a.id })}
                />
              ))}
            </Track>
          )}

          {marks.map((m, i) => (
            <CheckMarkBand key={i} start={m.start} end={m.end} label={m.label} px={px} onSeek={() => seek(m.start)} />
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

function Ruler({ px, width, onSeek }: { px: number; width: number; onSeek: (clientX: number) => void }) {
  const step = TICK_STEPS.find((s) => s * px >= 64) ?? 120;
  const ticks = Array.from({ length: Math.ceil(width / (step * px)) + 1 }, (_, i) => i * step);
  const [scrubbing, setScrubbing] = useState(false);
  return (
    <div
      className="relative h-6 cursor-ew-resize border-b border-line select-none"
      style={{ marginLeft: TRACK_LABEL_W, width }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setScrubbing(true);
        onSeek(e.clientX);
      }}
      onPointerMove={(e) => scrubbing && onSeek(e.clientX)}
      onPointerUp={() => setScrubbing(false)}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-line-strong" style={{ left: t * px }}>
          <span className="absolute left-1 top-1 font-mono text-[10px] leading-none text-faint">
            {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Track({ label, height, children }: { label: string; height: number; children: React.ReactNode }) {
  return (
    <div className="relative flex border-b border-line" style={{ height: height + 12 }}>
      <div
        className="sticky left-0 z-20 grid shrink-0 place-items-center border-r border-line bg-panel font-mono text-[10px] text-faint"
        style={{ width: TRACK_LABEL_W }}
      >
        {label}
      </div>
      <div className="relative flex-1 py-1.5">{children}</div>
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
  const graded = Object.values(clip.grade).some((v) => v !== 0);
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
        <span className="truncate text-[11px] font-medium text-text">{media?.name ?? clip.media_id}</span>
        <span className="shrink-0 font-mono text-[10px] text-text/70">{clipDuration(clip).toFixed(1)}s</span>
        {graded && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" title="Ada grading warna" />}
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

function OverlayBlock(props: { item: Overlay; media: MediaView | undefined; px: number; selected: boolean; onSelect: () => void }) {
  const { item, media, px } = props;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      title={`B-roll ${media?.name ?? ""} (${item.layout})`}
      className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border text-left ${
        props.selected ? "border-accent ring-1 ring-accent" : "border-line-strong"
      }`}
      style={{ left: item.start * px, width: Math.max((item.src_out - item.src_in) * px, 6) }}
    >
      {media && (
        <span
          className="absolute inset-0 opacity-60"
          style={{ backgroundImage: `url(${fileUrl(media.thumb_url)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
        />
      )}
      <span className="relative px-1.5 text-[10px] text-text">B-roll {item.layout !== "full" ? "PiP" : ""}</span>
    </button>
  );
}

function MusicBlock(props: { item: AudioItem; media: MediaView | undefined; px: number; limit: number; selected: boolean; onSelect: () => void }) {
  const { item, media, px } = props;
  const length = Math.max(0, Math.min(item.src_out - item.src_in, props.limit - item.start));
  const total = media?.duration ?? length;
  // Beats inside the used part of the song, mapped onto the timeline.
  const beats = (media?.beats ?? []).filter((b) => b >= item.src_in && b <= item.src_in + length).map((b) => item.start + b - item.src_in);
  return (
    <button
      type="button"
      onClick={props.onSelect}
      title={media?.name}
      className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border bg-panel-2 text-left ${
        props.selected ? "border-accent ring-1 ring-accent" : "border-line-strong"
      }`}
      style={{ left: item.start * px, width: Math.max(length * px, 6) }}
    >
      {media?.filmstrip_url && (
        <span
          className="absolute inset-0 opacity-80"
          style={{
            backgroundImage: `url(${fileUrl(media.filmstrip_url)})`,
            backgroundSize: `${total * px}px 100%`,
            backgroundPosition: `${-item.src_in * px}px 0`,
          }}
        />
      )}
      {beats.map((b) => (
        <span key={b} className="absolute top-0 bottom-0 w-px bg-text/25" style={{ left: (b - item.start) * px }} />
      ))}
      <span className="relative px-1.5 text-[10px] text-text">{media?.name}</span>
    </button>
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
        const second = Math.min(seconds - 1, Math.floor(clip.src_in + ((k + 0.5) * tileW) / px));
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

function TextBlock(props: { item: TextItem; lane: number; px: number; selected: boolean; onSelect: () => void }) {
  const { item, px, selected, onSelect } = props;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={item.text}
      className={`absolute truncate rounded-md border px-1.5 text-left text-[10px] transition-colors ${
        selected ? "border-accent bg-accent-soft text-text" : "border-line-strong bg-panel-2 text-muted hover:text-text"
      }`}
      style={{ left: item.start * px, width: Math.max((item.end - item.start) * px, 6), top: 6 + props.lane * LANE_H, height: LANE_H - 4 }}
    >
      {item.text}
    </button>
  );
}

/** A range the checker flagged (e.g. subject out of frame), shown across all tracks. */
function CheckMarkBand(props: { start: number; end: number; label: string; px: number; onSeek: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={props.onSeek}
      title={props.label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute top-0 bottom-0 z-30 border-x border-danger/70 bg-danger/15"
      style={{ left: TRACK_LABEL_W + props.start * props.px, width: Math.max((props.end - props.start) * props.px, 3) }}
    >
      <span className="absolute top-1 left-1 truncate rounded-[3px] bg-danger px-1 text-[9px] leading-[14px] font-medium text-bg">
        {props.label}
      </span>
    </motion.button>
  );
}

function Playhead({ px }: { px: number }) {
  const time = useEditor((s) => s.time);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-accent"
      style={{ left: TRACK_LABEL_W + time * px }}
    >
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
      Agen sedang mengedit. Timeline dikunci sampai selesai.
    </motion.div>
  );
}
