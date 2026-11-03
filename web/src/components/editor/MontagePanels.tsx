"use client";

import { Trash } from "@phosphor-icons/react";
import { useEditor } from "@/lib/store";
import { cropAt, upsertKey, volumeAt } from "@/lib/keys";
import { clipDuration, clipStarts } from "@/lib/time";
import type { AudioItem, Clip, CropKey, Overlay, Transition, VolumeKey } from "@/lib/timeline";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const TRANSITIONS: { id: Transition["kind"] | "cut"; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "crossfade", label: "Crossfade" },
  { id: "dip_black", label: "Black" },
  { id: "dip_white", label: "White" },
];
const LAYOUTS: { id: Overlay["layout"]; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "kiri_atas", label: "Top left" },
  { id: "kanan_atas", label: "Top right" },
  { id: "kiri_bawah", label: "Bottom left" },
  { id: "kanan_bawah", label: "Bottom right" },
];
const LETTERBOX: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 1.85, label: "1.85" },
  { value: 2.39, label: "2.39" },
];

function Segmented<T extends string | number | null>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => o.value !== props.value && props.onChange(o.value)}
          className={`rounded-full border-2 px-2.5 py-0.5 font-mono text-[11px] transition active:scale-[0.97] ${
            o.value === props.value ? "border-edge bg-text text-bg" : "border-line text-muted hover:border-line-strong hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider(props: { id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onCommit: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={props.id} className="text-xs text-text">
          {props.label}
        </label>
        <span className="font-mono text-[11px] tabular-nums text-muted">{props.format(props.value)}</span>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        defaultValue={props.value}
        onPointerUp={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
    </div>
  );
}

/** Speed, transition into the clip, Ken Burns zoom and volume. */
export function ClipMotion({ clip, isFirst, locked }: { clip: Clip; isFirst: boolean; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const kind = clip.transition?.kind ?? "cut";
  return (
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Motion and transitions</legend>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Speed</p>
        <Segmented
          options={SPEEDS.map((v) => ({ value: v, label: `${v}x` }))}
          value={clip.speed}
          onChange={(v) => applyOps(`Speed ${v}x`, [{ op: "set_speed", clip_id: clip.id, speed: v }])}
        />
        {clip.speed !== 1 && <p className="text-[11px] text-faint">Clip audio is muted while its speed is changed.</p>}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Transition in</p>
        <Segmented
          options={TRANSITIONS.filter((t) => !(isFirst && t.id === "crossfade")).map((t) => ({ value: t.id, label: t.label }))}
          value={kind}
          onChange={(v) =>
            applyOps(`Transisi ${v}`, [
              {
                op: "set_transition",
                clip_id: clip.id,
                transition: v === "cut" ? null : { kind: v as Transition["kind"], duration: clip.transition?.duration ?? 0.5 },
              },
            ])
          }
        />
        {clip.transition && (
          <Slider
            id="transition-duration"
            label="Transition length"
            value={clip.transition.duration}
            min={0.1}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onCommit={(v) =>
              applyOps("Transition length", [{ op: "set_transition", clip_id: clip.id, transition: { ...clip.transition!, duration: v } }])
            }
          />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Slow zoom</p>
        <Segmented
          options={[
            { value: "none", label: "None" },
            { value: "in", label: "In" },
            { value: "out", label: "Out" },
          ]}
          value={!clip.zoom ? "none" : clip.zoom.end >= clip.zoom.start ? "in" : "out"}
          onChange={(v) =>
            applyOps("Slow zoom", [
              {
                op: "set_zoom",
                clip_id: clip.id,
                zoom: v === "none" ? null : v === "in" ? { start: 1, end: 1.15 } : { start: 1.15, end: 1 },
              },
            ])
          }
        />
      </div>
      <Slider
        id="clip-volume"
        label="Clip volume"
        value={clip.volume}
        min={0}
        max={2}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(v) => applyOps("Clip volume", [{ op: "set_volume", clip_id: clip.id, volume: v }])}
      />
      <VolumeKeys clip={clip} />
      <div className="space-y-1.5">
        <p className="text-xs text-text">Speed ramp at playhead</p>
        <div className="flex gap-1.5">
          {[
            { to: 0.5, label: "To slow-mo" },
            { to: 1, label: "To normal" },
            { to: 2, label: "To fast" },
          ].map((r) => (
            <button
              key={r.to}
              type="button"
              disabled={clip.speed === r.to}
              onClick={() => {
                const at = playheadIn(clip);
                const start = at === null ? null : useEditor.getState().time;
                if (start !== null)
                  applyOps(`Speed ramp to ${r.to}x`, [{ op: "speed_ramp", clip_id: clip.id, at: Number(start.toFixed(3)), to_speed: r.to }]);
              }}
              className="rounded-[10px] border border-line px-2 py-1 text-[11px] text-muted transition hover:border-line-strong hover:text-text active:scale-[0.97] disabled:opacity-35"
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">Put the playhead inside this clip first.</p>
      </div>
    </fieldset>
  );
}

export function OverlayInspector({ item, locked }: { item: Overlay; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const select = useEditor((s) => s.select);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === item.media_id));
  return (
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-50">
      <div>
        <p className="truncate text-sm font-medium text-text">B-roll: {media?.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-faint">
          {item.start.toFixed(2)}s, {(item.src_out - item.src_in).toFixed(2)}s long, no sound
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Position</p>
        <Segmented
          options={LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
          value={item.layout}
          onChange={(v) => applyOps("B-roll position", [{ op: "update_overlay", overlay_id: item.id, layout: v }])}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          applyOps("Delete B-roll", [{ op: "delete_overlay", overlay_id: item.id }]);
          select({});
        }}
        className="flex items-center gap-1.5 text-xs text-muted transition hover:text-danger"
      >
        <Trash size={13} /> Delete B-roll
      </button>
    </fieldset>
  );
}

export function MusicInspector({ item, locked }: { item: AudioItem; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const select = useEditor((s) => s.select);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === item.media_id));
  const update = (patch: Partial<AudioItem>, label: string) => applyOps(label, [{ op: "update_audio", audio_id: item.id, ...patch }]);
  const bpm = media?.beats && media.beats.length > 1 ? Math.round(60 / ((media.beats.at(-1)! - media.beats[0]) / (media.beats.length - 1))) : null;
  return (
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-50">
      <div>
        <p className="truncate text-sm font-medium text-text">Musik: {media?.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-faint">{bpm ? `${bpm} BPM` : "no tempo detected"}</p>
      </div>
      <Slider id="music-volume" label="Volume" value={item.volume} min={0} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => update({ volume: v }, "Music volume")} />
      <Slider id="music-in" label="Start from song time" value={item.src_in} min={0} max={Math.max(0, (media?.duration ?? 0) - 1)} step={0.5} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ src_in: v, src_out: Math.min(media?.duration ?? v + 1, v + (item.src_out - item.src_in)) }, "Shift song")} />
      <Slider id="music-fade-in" label="Fade in" value={item.fade_in} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ fade_in: v }, "Music fade in")} />
      <Slider id="music-fade-out" label="Fade out" value={item.fade_out} min={0} max={8} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ fade_out: v }, "Music fade out")} />
      <label className="flex items-center gap-2 text-xs text-text">
        <input type="checkbox" checked={item.duck} onChange={(e) => update({ duck: e.target.checked }, "Music ducking")} />
        Lower the music when someone speaks
      </label>
      <button
        type="button"
        onClick={() => {
          applyOps("Delete music", [{ op: "delete_audio", audio_id: item.id }]);
          select({});
        }}
        className="flex items-center gap-1.5 text-xs text-muted transition hover:text-danger"
      >
        <Trash size={13} /> Delete music
      </button>
    </fieldset>
  );
}

/** Volume keyframes at the playhead: fade the clip's own sound in or out anywhere. */
function VolumeKeys({ clip }: { clip: Clip }) {
  const applyOps = useEditor((s) => s.applyOps);
  const seek = useEditor((s) => s.seek);
  const keys = clip.volume_keys;
  const clipStart = useEditor((s) => {
    const clips = s.project?.timeline.clips ?? [];
    return clipStarts(clips)[clips.findIndex((c) => c.id === clip.id)] ?? 0;
  });
  const commit = (next: VolumeKey[], label: string) => applyOps(label, [{ op: "set_volume_keys", clip_id: clip.id, keys: next }]);
  const add = (v: number | null) => {
    const at = playheadIn(clip);
    if (at === null) return;
    commit(upsertKey(keys, { t: at, v: v ?? volumeAt(keys, at) }), "Volume keyframes");
  };
  return (
    <div className="space-y-1.5">
      <KeyList
        keys={keys}
        format={(k) => `${Math.round(k.v * 100)}%`}
        onSeek={(k) => seek(clipStart + k.t)}
        onRemove={(k) => commit(keys.filter((x) => x !== k), "Delete volume keyframe")}
      />
      <div className="flex gap-3 text-[11px] text-muted">
        <button type="button" onClick={() => add(null)} className="transition hover:text-text">
          ◆ Volume keyframes
        </button>
        <button type="button" onClick={() => add(0)} className="transition hover:text-text">
          ◆ Silence at playhead
        </button>
        {keys.length > 0 && (
          <button type="button" onClick={() => commit([], "Delete volume keyframe")} className="transition hover:text-danger">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/** Whole-video finishing, shown when nothing is selected. */
export function FinishPanel({ locked }: { locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const finish = useEditor((s) => s.project?.timeline.finish);
  if (!finish) return null;
  return (
    <fieldset disabled={locked} className="space-y-4 border-t border-line pt-5 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Finishing</legend>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Cinematic letterbox</p>
        <Segmented
          options={LETTERBOX}
          value={finish.letterbox}
          onChange={(v) => applyOps("Letterbox", [{ op: "set_finish", letterbox: v, grain: finish.grain }])}
        />
      </div>
      <Slider
        id="grain"
        label="Film grain"
        value={finish.grain}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(v) => applyOps("Film grain", [{ op: "set_finish", letterbox: finish.letterbox, grain: v }])}
      />
    </fieldset>
  );
}

/**
 * Manual framing: where the output-aspect window sits in the source (one crop key). Only the axis
 * that has room to move is shown; a subject-following reframe is replaced when you set it by hand.
 */
/** Playhead position inside a clip (clip-local seconds), or null when the playhead is elsewhere. */
function playheadIn(clip: Clip): number | null {
  const s = useEditor.getState();
  const clips = s.project?.timeline.clips ?? [];
  const i = clips.findIndex((c) => c.id === clip.id);
  if (i < 0) return null;
  const local = s.time - clipStarts(clips)[i];
  return local >= 0 && local <= clipDuration(clip) ? Number(local.toFixed(3)) : null;
}

function KeyList<K extends { t: number }>(props: { keys: K[]; format: (k: K) => string; onRemove: (k: K) => void; onSeek: (k: K) => void }) {
  if (props.keys.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {props.keys.map((k) => (
        <span key={k.t} className="flex items-center gap-1 rounded-[10px] border-2 border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
          <button type="button" onClick={() => props.onSeek(k)} title="Go to this keyframe" className="hover:text-accent">
            ◆ {k.t.toFixed(2)}s {props.format(k)}
          </button>
          <button type="button" aria-label="Delete keyframe" onClick={() => props.onRemove(k)} className="text-muted hover:text-danger">
            <Trash size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Manual framing: where the output-aspect window sits in the source. One key = a fixed position;
 * add keyframes at the playhead to pan over time. Only the axis with room to move is shown, and a
 * subject-following reframe is replaced when you set it by hand.
 */
export function FramePosition({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const seek = useEditor((s) => s.seek);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === clip.media_id));
  const aspect = useEditor((s) => s.project?.timeline.aspect ?? "16:9");
  const clipStart = useEditor((s) => {
    const clips = s.project?.timeline.clips ?? [];
    return clipStarts(clips)[clips.findIndex((c) => c.id === clip.id)] ?? 0;
  });
  if (!media || !media.width) return null;
  const [ow, oh] = aspect === "16:9" ? [16, 9] : aspect === "9:16" ? [9, 16] : [1, 1];
  const srcRatio = media.width / media.height;
  const outRatio = ow / oh;
  if (Math.abs(srcRatio - outRatio) < 0.01) return null;
  const horizontal = srcRatio > outRatio;
  const keys = clip.crop;
  const commit = (next: CropKey[], label = "Frame position") => applyOps(label, [{ op: "set_crop", clip_id: clip.id, keys: next, follow: null }]);
  const withValue = (at: number, v: number): CropKey => {
    const cur = cropAt(keys, at);
    return { t: at, cx: horizontal ? v : cur.cx, cy: horizontal ? cur.cy : v };
  };
  const onSlider = (v: number) => {
    // With keyframes, the slider edits the key at the playhead; otherwise it sets one fixed position.
    const at = playheadIn(clip);
    if (keys.length >= 2 && at !== null) commit(upsertKey(keys, withValue(at, v)));
    else commit([withValue(0, v)]);
  };
  const addKey = () => {
    const at = playheadIn(clip);
    if (at === null) return;
    const cur = cropAt(keys, at);
    const base = keys.length ? keys : [{ t: 0, cx: cur.cx, cy: cur.cy }];
    commit(upsertKey(base, { t: at, cx: cur.cx, cy: cur.cy }), "Frame keyframe");
  };
  const first = keys[0] ?? { t: 0, cx: 0.5, cy: 0.5 };
  return (
    <fieldset disabled={locked} className="space-y-2 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Frame {aspect}</legend>
      {clip.follow ? (
        <p className="text-[11px] leading-relaxed text-faint">
          The frame follows the subject automatically. Changing it here replaces that with a manual position.
        </p>
      ) : null}
      <Slider
        id="frame-pos"
        label={`${horizontal ? "Left-right position" : "Up-down position"}${keys.length >= 2 ? " (at playhead)" : ""}`}
        value={horizontal ? first.cx : first.cy}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={onSlider}
      />
      <KeyList
        keys={keys}
        format={(k) => `${Math.round((horizontal ? k.cx : k.cy) * 100)}%`}
        onSeek={(k) => seek(clipStart + k.t)}
        onRemove={(k) => commit(keys.filter((x) => x !== k), "Delete frame keyframe")}
      />
      <button type="button" onClick={addKey} className="text-[11px] text-muted transition hover:text-text">
        ◆ Add keyframe at playhead
      </button>
    </fieldset>
  );
}
