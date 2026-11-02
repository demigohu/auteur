"use client";

import { Trash } from "@phosphor-icons/react";
import { useEditor } from "@/lib/store";
import type { AudioItem, Clip, Overlay, Transition } from "@/lib/timeline";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const TRANSITIONS: { id: Transition["kind"] | "potong"; label: string }[] = [
  { id: "potong", label: "Potong" },
  { id: "crossfade", label: "Crossfade" },
  { id: "hitam", label: "Hitam" },
  { id: "putih", label: "Putih" },
];
const LAYOUTS: { id: Overlay["layout"]; label: string }[] = [
  { id: "full", label: "Penuh" },
  { id: "kiri_atas", label: "Kiri atas" },
  { id: "kanan_atas", label: "Kanan atas" },
  { id: "kiri_bawah", label: "Kiri bawah" },
  { id: "kanan_bawah", label: "Kanan bawah" },
];
const LETTERBOX: { value: number | null; label: string }[] = [
  { value: null, label: "Tanpa" },
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
          className={`rounded-md border px-2 py-1 text-[11px] transition active:scale-[0.97] ${
            o.value === props.value ? "border-accent text-text" : "border-line text-muted hover:border-line-strong hover:text-text"
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
  const kind = clip.transition?.kind ?? "potong";
  return (
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-50">
      <legend className="mb-2 text-xs font-medium text-muted">Gerak dan transisi</legend>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Kecepatan</p>
        <Segmented
          options={SPEEDS.map((v) => ({ value: v, label: `${v}x` }))}
          value={clip.speed}
          onChange={(v) => applyOps(`Kecepatan ${v}x`, [{ op: "set_speed", clip_id: clip.id, speed: v }])}
        />
        {clip.speed !== 1 && <p className="text-[11px] text-faint">Suara klip dimatikan saat kecepatannya diubah.</p>}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Transisi masuk</p>
        <Segmented
          options={TRANSITIONS.filter((t) => !(isFirst && t.id === "crossfade")).map((t) => ({ value: t.id, label: t.label }))}
          value={kind}
          onChange={(v) =>
            applyOps(`Transisi ${v}`, [
              {
                op: "set_transition",
                clip_id: clip.id,
                transition: v === "potong" ? null : { kind: v as Transition["kind"], duration: clip.transition?.duration ?? 0.5 },
              },
            ])
          }
        />
        {clip.transition && (
          <Slider
            id="transition-duration"
            label="Durasi transisi"
            value={clip.transition.duration}
            min={0.1}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onCommit={(v) =>
              applyOps("Durasi transisi", [{ op: "set_transition", clip_id: clip.id, transition: { ...clip.transition!, duration: v } }])
            }
          />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Zoom pelan</p>
        <Segmented
          options={[
            { value: "none", label: "Tanpa" },
            { value: "in", label: "Masuk" },
            { value: "out", label: "Keluar" },
          ]}
          value={!clip.zoom ? "none" : clip.zoom.end >= clip.zoom.start ? "in" : "out"}
          onChange={(v) =>
            applyOps("Zoom pelan", [
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
        label="Volume klip"
        value={clip.volume}
        min={0}
        max={2}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(v) => applyOps("Volume klip", [{ op: "set_volume", clip_id: clip.id, volume: v }])}
      />
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
          {item.start.toFixed(2)}s, {(item.src_out - item.src_in).toFixed(2)} detik, tanpa suara
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Posisi</p>
        <Segmented
          options={LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
          value={item.layout}
          onChange={(v) => applyOps("Posisi B-roll", [{ op: "update_overlay", overlay_id: item.id, layout: v }])}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          applyOps("Hapus B-roll", [{ op: "delete_overlay", overlay_id: item.id }]);
          select({});
        }}
        className="flex items-center gap-1.5 text-xs text-muted transition hover:text-danger"
      >
        <Trash size={13} /> Hapus B-roll
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
        <p className="mt-0.5 font-mono text-[11px] text-faint">{bpm ? `${bpm} BPM` : "tempo tidak terdeteksi"}</p>
      </div>
      <Slider id="music-volume" label="Volume" value={item.volume} min={0} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => update({ volume: v }, "Volume musik")} />
      <Slider id="music-in" label="Mulai dari detik lagu" value={item.src_in} min={0} max={Math.max(0, (media?.duration ?? 0) - 1)} step={0.5} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ src_in: v, src_out: Math.min(media?.duration ?? v + 1, v + (item.src_out - item.src_in)) }, "Geser lagu")} />
      <Slider id="music-fade-in" label="Fade in" value={item.fade_in} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ fade_in: v }, "Fade in musik")} />
      <Slider id="music-fade-out" label="Fade out" value={item.fade_out} min={0} max={8} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => update({ fade_out: v }, "Fade out musik")} />
      <label className="flex items-center gap-2 text-xs text-text">
        <input type="checkbox" checked={item.duck} onChange={(e) => update({ duck: e.target.checked }, "Ducking musik")} />
        Kecilkan musik saat ada yang bicara
      </label>
      <button
        type="button"
        onClick={() => {
          applyOps("Hapus musik", [{ op: "delete_audio", audio_id: item.id }]);
          select({});
        }}
        className="flex items-center gap-1.5 text-xs text-muted transition hover:text-danger"
      >
        <Trash size={13} /> Hapus musik
      </button>
    </fieldset>
  );
}

/** Whole-video finishing, shown when nothing is selected. */
export function FinishPanel({ locked }: { locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const finish = useEditor((s) => s.project?.timeline.finish);
  if (!finish) return null;
  return (
    <fieldset disabled={locked} className="space-y-4 border-t border-line pt-5 disabled:opacity-50">
      <legend className="mb-2 text-xs font-medium text-muted">Finishing video</legend>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Letterbox sinematik</p>
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
export function FramePosition({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === clip.media_id));
  const aspect = useEditor((s) => s.project?.timeline.aspect ?? "16:9");
  if (!media || !media.width) return null;
  const [ow, oh] = aspect === "16:9" ? [16, 9] : aspect === "9:16" ? [9, 16] : [1, 1];
  const srcRatio = media.width / media.height;
  const outRatio = ow / oh;
  if (Math.abs(srcRatio - outRatio) < 0.01) return null;
  const horizontal = srcRatio > outRatio;
  const key = clip.crop[0] ?? { t: 0, cx: 0.5, cy: 0.5 };
  const set = (v: number) =>
    applyOps("Posisi bingkai", [
      { op: "set_crop", clip_id: clip.id, keys: [{ t: 0, cx: horizontal ? v : key.cx, cy: horizontal ? key.cy : v }], follow: null },
    ]);
  return (
    <fieldset disabled={locked} className="space-y-2 disabled:opacity-50">
      <legend className="mb-2 text-xs font-medium text-muted">Bingkai {aspect}</legend>
      {clip.follow ? (
        <p className="text-[11px] leading-relaxed text-faint">
          Bingkai mengikuti subjek otomatis. Menggeser slider di bawah menggantinya dengan posisi tetap.
        </p>
      ) : null}
      <Slider
        id="frame-pos"
        label={horizontal ? "Posisi kiri-kanan" : "Posisi atas-bawah"}
        value={horizontal ? key.cx : key.cy}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={set}
      />
    </fieldset>
  );
}
