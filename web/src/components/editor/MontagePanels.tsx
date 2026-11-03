"use client";

import { Trash } from "@phosphor-icons/react";
import { useRef } from "react";
import { useEditor } from "@/lib/store";
import { cropAt, upsertKey, volumeAt } from "@/lib/keys";
import { clipDuration, clipStarts } from "@/lib/time";
import type { AudioItem, Clip, CropKey, Overlay, Transform, Transition, VolumeKey } from "@/lib/timeline";
import { cropWindow } from "@/lib/crop";
import { poseAt } from "@/lib/animate";
import { IDENTITY } from "@/lib/transform";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const TRANSITIONS: { id: Transition["kind"] | "cut"; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "crossfade", label: "Crossfade" },
  { id: "dip_black", label: "Black" },
  { id: "dip_white", label: "White" },
  { id: "slide_left", label: "Slide ←" },
  { id: "slide_right", label: "Slide →" },
  { id: "slide_up", label: "Slide ↑" },
  { id: "slide_down", label: "Slide ↓" },
  { id: "wipe_left", label: "Wipe ←" },
  { id: "wipe_right", label: "Wipe →" },
  { id: "circle", label: "Circle" },
  { id: "zoom", label: "Zoom" },
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

/** Position, size, rotation and flip in the frame; the same values the canvas handles change. */
export function ClipTransform({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const t = clip.transform ?? IDENTITY;
  const set = (label: string, patch: Partial<Transform>) =>
    applyOps(label, [{ op: "set_transform", clip_id: clip.id, transform: { ...t, ...patch } }]);
  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Position and size</legend>
      <p className="text-[11px] text-faint">Drag the clip on the preview: the box moves it, the corner scales, the round handle rotates (Shift snaps to 15°).</p>
      <Slider id="tf-x" label="Left / right" value={t.x} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set("Move clip", { x: v })} />
      <Slider id="tf-y" label="Up / down" value={t.y} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set("Move clip", { y: v })} />
      <Slider id="tf-scale" label="Scale" value={t.scale} min={0.1} max={4} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set("Scale clip", { scale: v })} />
      <Slider id="tf-rotation" label="Rotation" value={t.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onCommit={(v) => set("Rotate clip", { rotation: v })} />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={t.flip_h} onClick={() => set("Flip horizontally", { flip_h: !t.flip_h })} className={TOGGLE(t.flip_h)}>
          Flip ↔
        </button>
        <button type="button" aria-pressed={t.flip_v} onClick={() => set("Flip vertically", { flip_v: !t.flip_v })} className={TOGGLE(t.flip_v)}>
          Flip ↕
        </button>
        {clip.transform && (
          <button
            type="button"
            onClick={() => applyOps("Reset position", [{ op: "set_transform", clip_id: clip.id, transform: null }])}
            className="ml-auto rounded-full px-2.5 py-0.5 font-mono text-[11px] text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Reset
          </button>
        )}
      </div>
    </fieldset>
  );
}

const TOGGLE = (on: boolean) =>
  `rounded-full border-2 px-2.5 py-0.5 font-mono text-[11px] transition active:scale-[0.97] ${on ? "border-edge bg-text text-bg" : "border-line text-muted hover:border-line-strong hover:text-text"}`;

const ANIMS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "zoom_in", label: "Zoom in" },
  { value: "zoom_out", label: "Zoom out" },
  { value: "slide_left", label: "Slide ←" },
  { value: "slide_right", label: "Slide →" },
  { value: "slide_up", label: "Slide ↑" },
  { value: "slide_down", label: "Slide ↓" },
  { value: "spin", label: "Spin" },
];

/** Keyframes for position, size, rotation and opacity (set at the playhead; drag on the canvas to pose),
 * and entrance/exit animations. Both run through lib/animate, as the export does through animate.py. */
export function ClipKeyframes({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const seek = useEditor((s) => s.seek);
  const start = useEditor((s) => {
    const clips = s.project?.timeline.clips ?? [];
    return clipStarts(clips)[clips.findIndex((c) => c.id === clip.id)] ?? 0;
  });
  const time = useEditor((s) => s.time);
  const local = time - start;
  const inside = local >= 0 && local <= clipDuration(clip);
  const keys = clip.transform_keys;
  const here = keys.find((k) => Math.abs(k.t - local) < 1 / 60);
  const pose = poseAt(clip, Math.min(Math.max(local, 0), clipDuration(clip)));
  const setKeys = (next: Clip["transform_keys"], label: string) => applyOps(label, [{ op: "set_transform_keys", clip_id: clip.id, keys: next }]);
  const keyHere = (patch: Partial<Clip["transform_keys"][number]> = {}) =>
    upsertKey(keys, { t: Number(local.toFixed(3)), x: pose.x, y: pose.y, scale: pose.scale, rotation: pose.rotation, opacity: pose.opacity, ...patch });
  const anim = (which: "anim_in" | "anim_out", kind: string, duration?: number) => {
    const current = clip[which];
    const next = kind === "none" ? null : { kind: kind as NonNullable<Clip["anim_in"]>["kind"], duration: duration ?? current?.duration ?? 0.5 };
    applyOps(which === "anim_in" ? "Entrance" : "Exit", [{
      op: "set_clip_anim", clip_id: clip.id, anim_in: which === "anim_in" ? next : clip.anim_in, anim_out: which === "anim_out" ? next : clip.anim_out,
    }]);
  };
  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Animation</legend>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Keyframes {keys.length ? `(${keys.length})` : ""}</p>
        {keys.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {keys.map((k) => (
              <button key={k.t} type="button" onClick={() => seek(start + k.t)} title="Go to this keyframe"
                className={`rounded-full border-2 px-2 py-0.5 font-mono text-[10px] ${here?.t === k.t ? "border-accent text-accent" : "border-line text-muted hover:text-text"}`}>
                ◆ {k.t.toFixed(2)}s
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={!inside} onClick={() => setKeys(keyHere(), "Add keyframe")}
            className="rounded-full border-2 border-line px-2.5 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-text disabled:opacity-40">
            ◆ {here ? "Update" : "Add"} keyframe at playhead
          </button>
          {here && (
            <button type="button" onClick={() => setKeys(keys.filter((k) => k !== here), "Remove keyframe")}
              className="rounded-full border-2 border-line px-2.5 py-0.5 text-[11px] text-muted hover:text-danger">
              Remove this one
            </button>
          )}
          {keys.length > 0 && (
            <button type="button" onClick={() => setKeys([], "Clear keyframes")}
              className="rounded-full px-2 py-0.5 text-[11px] text-faint underline-offset-2 hover:text-text hover:underline">
              Clear all
            </button>
          )}
        </div>
        <p className="text-[11px] text-faint">
          {inside
            ? keys.length
              ? "Move the playhead, then drag the clip on the preview: that pose becomes a keyframe."
              : "Add a keyframe, move the playhead, drag the clip on the preview: it animates between them."
            : "Put the playhead inside this clip."}
        </p>
      </div>
      <Slider
        key={`opacity-${pose.opacity}-${here?.t}`}
        id="clip-opacity"
        label={keys.length ? "Opacity (keyframe at playhead)" : "Opacity"}
        value={pose.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(v) =>
          keys.length
            ? inside && setKeys(keyHere({ opacity: v }), "Opacity keyframe")
            : applyOps("Clip opacity", [{ op: "set_transform", clip_id: clip.id, transform: { ...(clip.transform ?? IDENTITY), opacity: v } }])
        }
      />
      {(["anim_in", "anim_out"] as const).map((which) => (
        <div key={which} className="space-y-1.5">
          <p className="text-xs text-text">{which === "anim_in" ? "Entrance" : "Exit"}</p>
          <Segmented options={ANIMS} value={clip[which]?.kind ?? "none"} onChange={(v) => anim(which, v)} />
          {clip[which] && (
            <Slider id={`${which}-len`} label="Length" value={clip[which]!.duration} min={0.1} max={3} step={0.1}
              format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => anim(which, clip[which]!.kind, v)} />
          )}
        </div>
      ))}
    </fieldset>
  );
}

/** A 3D LUT (.cube) uploaded to the project, before the grade, at an intensity. */
export function ClipLutPanel({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const luts = useEditor((s) => s.project?.luts ?? EMPTY_LUTS);
  const uploadLut = useEditor((s) => s.uploadLut);
  const deleteLut = useEditor((s) => s.deleteLut);
  const preparing = useEditor((s) => s.project?.clip_previews[clip.id] === null);
  const input = useRef<HTMLInputElement>(null);
  const set = (lut: Clip["lut"], label: string) => applyOps(label, [{ op: "set_lut", clip_id: clip.id, lut }]);
  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">LUT</legend>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!clip.lut} onClick={() => clip.lut && set(null, "Remove LUT")}
          className={`rounded-full border-2 px-2.5 py-0.5 font-mono text-[11px] ${!clip.lut ? "border-edge bg-text text-bg" : "border-line text-muted hover:text-text"}`}>
          None
        </button>
        {luts.map((l) => (
          <span key={l.id} className="flex items-center">
            <button type="button" aria-pressed={clip.lut?.lut_id === l.id}
              onClick={() => set({ lut_id: l.id, intensity: clip.lut?.intensity ?? 1 }, `LUT ${l.name}`)}
              className={`rounded-l-full border-2 px-2.5 py-0.5 font-mono text-[11px] ${clip.lut?.lut_id === l.id ? "border-edge bg-text text-bg" : "border-line text-muted hover:text-text"}`}>
              {l.name}
            </button>
            <button type="button" aria-label={`Delete LUT ${l.name}`} title="Delete from the project" onClick={() => deleteLut(l.id)}
              className="rounded-r-full border-2 border-l-0 border-line px-1.5 py-0.5 text-[11px] text-faint hover:text-danger">
              ×
            </button>
          </span>
        ))}
        <button type="button" onClick={() => input.current?.click()}
          className="rounded-full border-2 border-dashed border-line-strong px-2.5 py-0.5 text-[11px] text-muted hover:text-text">
          + Upload .cube
        </button>
        <input ref={input} type="file" accept=".cube" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && (await uploadLut(f))) {
              const added = useEditor.getState().project?.luts.at(-1);
              if (added) set({ lut_id: added.id, intensity: 1 }, `LUT ${added.name}`);
            }
          }} />
      </div>
      {clip.lut && (
        <Slider id="lut-intensity" label="Intensity" value={clip.lut.intensity} min={0} max={1} step={0.05}
          format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set({ ...clip.lut!, intensity: v }, "LUT intensity")} />
      )}
      {preparing && <p className="text-[11px] text-faint">Preparing the preview with this look...</p>}
    </fieldset>
  );
}

const EMPTY_LUTS: { id: string; name: string; size: number }[] = [];

/** Fill (crop to the frame) or fit (the whole picture over a blurred or colored backdrop). */
export function ClipFit({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const bd = clip.backdrop;
  const set = (label: string, fit: Clip["fit"], backdrop?: Partial<Clip["backdrop"]>) =>
    applyOps(label, [{ op: "set_fit", clip_id: clip.id, fit, ...(backdrop ? { backdrop: { ...bd, ...backdrop } } : {}) }]);
  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Frame</legend>
      <Segmented
        options={[
          { value: "fill", label: "Fill (crop)" },
          { value: "fit", label: "Fit (whole picture)" },
        ]}
        value={clip.fit}
        onChange={(v) => set(v === "fit" ? "Fit the frame" : "Fill the frame", v as Clip["fit"])}
      />
      {clip.fit === "fit" && (
        <>
          <Segmented
            options={[
              { value: "blur", label: "Blurred backdrop" },
              { value: "color", label: "Color" },
            ]}
            value={bd.kind}
            onChange={(v) => set("Backdrop", "fit", { kind: v as "blur" | "color" })}
          />
          {bd.kind === "blur" ? (
            <Slider id="backdrop-blur" label="Blur" value={bd.blur} min={0.005} max={0.2} step={0.005}
              format={(v) => `${Math.round(v * 1000) / 10}%`} onCommit={(v) => set("Backdrop blur", "fit", { blur: v })} />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {["#000000", "#FFFFFF", "#111827", "#C6FF3E", "#FF5A28", "#FF8AD8", "#5AB0FF"].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Backdrop ${c}`}
                  onClick={() => set("Backdrop color", "fit", { color: c })}
                  className={`size-5 rounded-full border-2 ${bd.color.toUpperCase() === c ? "border-accent" : "border-line"}`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                aria-label="Backdrop: any color"
                defaultValue={bd.color}
                onBlur={(e) => e.target.value.toUpperCase() !== bd.color.toUpperCase() && set("Backdrop color", "fit", { color: e.target.value.toUpperCase() })}
                className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Cut the edges of the source; what is left fills the frame. */
export function ClipCrop({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const r = clip.crop_rect ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const set = (side: keyof typeof r, v: number) => {
    const next = { ...r, [side]: v };
    // Keep at least a tenth of the picture: shrink the opposite edge's share if needed.
    const other = { left: "right", right: "left", top: "bottom", bottom: "top" }[side] as keyof typeof r;
    next[other] = Math.min(next[other], Number((0.9 - v).toFixed(3)));
    applyOps("Crop", [{ op: "set_crop_rect", clip_id: clip.id, crop_rect: next }]);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      <legend className="display mb-2.5 text-[19px] text-text">Crop</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Slider id="crop-left" label="Left" value={r.left} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => set("left", v)} />
        <Slider id="crop-right" label="Right" value={r.right} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => set("right", v)} />
        <Slider id="crop-top" label="Top" value={r.top} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => set("top", v)} />
        <Slider id="crop-bottom" label="Bottom" value={r.bottom} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => set("bottom", v)} />
      </div>
      {clip.crop_rect && (
        <button
          type="button"
          onClick={() => applyOps("Reset crop", [{ op: "set_crop_rect", clip_id: clip.id, crop_rect: null }])}
          className="rounded-full px-2.5 py-0.5 font-mono text-[11px] text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Show the whole picture
        </button>
      )}
    </fieldset>
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
        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={clip.reverse}
            disabled={clip.effects.length > 0}
            onChange={(e) => applyOps(e.target.checked ? "Reverse" : "Play forward", [{ op: "set_reverse", clip_id: clip.id, reverse: e.target.checked }])}
          />
          Play backwards{clip.effects.length > 0 ? " (not with tracked effects)" : ""}
        </label>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-text">Transition in</p>
        <Segmented
          // The first clip has nothing to overlap with: only a dip (fade in from a color) fits there.
          options={TRANSITIONS.filter((t) => !isFirst || t.id === "cut" || t.id.startsWith("dip_")).map((t) => ({ value: t.id, label: t.label }))}
          value={kind}
          onChange={(v) =>
            applyOps(`Transition: ${v}`, [
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
      <ClipSound clip={clip} />
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
          value={item.box ? null : item.layout}
          onChange={(v) => v && applyOps("B-roll position", [{ op: "update_overlay", overlay_id: item.id, layout: v }])}
        />
        <p className="text-[11px] text-faint">
          {item.box
            ? `Placed by hand at ${Math.round(item.box.scale * 100)}% size. Pick a preset to snap it back.`
            : "Or drag it on the preview; the corner resizes it."}
        </p>
      </div>
      <Slider id="broll-opacity" label="Opacity" value={item.opacity} min={0} max={1} step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(v) => applyOps("B-roll opacity", [{ op: "update_overlay", overlay_id: item.id, opacity: v }])} />
      <div className="space-y-1.5">
        <p className="text-xs text-text">Blend</p>
        <Segmented
          options={(["normal", "screen", "multiply", "overlay", "lighten", "darken", "add"] as const).map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))}
          value={item.blend}
          onChange={(v) => applyOps(`Blend ${v}`, [{ op: "update_overlay", overlay_id: item.id, blend: v }])}
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
        <p className="truncate text-sm font-medium text-text">Music: {media?.name}</p>
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

/** Fades on the clip's own sound, and moving that sound to the music track to edit it apart. */
function ClipSound({ clip }: { clip: Clip }) {
  const applyOps = useEditor((s) => s.applyOps);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === clip.media_id));
  const max = Math.min(5, clipDuration(clip) / 2);
  const fade = (fade_in: number, fade_out: number, label: string) =>
    applyOps(label, [{ op: "set_audio_fade", clip_id: clip.id, fade_in, fade_out }]);
  if (!media?.has_audio) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Slider id="fade-in" label="Sound fade in" value={Math.min(clip.audio_fade_in, max)} min={0} max={max} step={0.1}
          format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => fade(v, clip.audio_fade_out, "Sound fade in")} />
        <Slider id="fade-out" label="Sound fade out" value={Math.min(clip.audio_fade_out, max)} min={0} max={max} step={0.1}
          format={(v) => `${v.toFixed(1)}s`} onCommit={(v) => fade(clip.audio_fade_in, v, "Sound fade out")} />
      </div>
      <button
        type="button"
        disabled={clip.muted || clip.speed !== 1}
        title={clip.speed !== 1 ? "Only at normal speed" : clip.muted ? "The clip is muted" : undefined}
        onClick={() => applyOps("Detach audio", [{ op: "detach_audio", clip_id: clip.id }])}
        className="rounded-full border-2 border-line px-2.5 py-1 text-[11px] text-muted transition hover:border-line-strong hover:text-text active:scale-[0.98] disabled:opacity-40"
      >
        Detach audio to the music track
      </button>
    </div>
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
  const [ow, oh] = aspect.split(":").map(Number);
  const [, , ew, eh] = cropWindow(clip.crop_rect, media.width, media.height);
  const srcRatio = ew / eh; // what is left after cutting the edges is what gets panned
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
