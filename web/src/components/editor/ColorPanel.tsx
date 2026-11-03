"use client";

import { CaretRight, MagicWand, Plus, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { fileUrl } from "@/lib/api";
import { NEUTRAL_GRADE } from "@/lib/grade";
import { useEditor } from "@/lib/store";
import type { Clip, Grade } from "@/lib/timeline";

// Mirrors colorist.LOOK_LABELS on the API; the grade itself is always computed server-side.
const LOOKS = [
  { id: "hangat", label: "Warm", swatch: "linear-gradient(135deg,#f2b36b,#c8784a)" },
  { id: "cinematic", label: "Cinematic", swatch: "linear-gradient(135deg,#1f6f7a,#e39a55)" },
  { id: "film", label: "Film", swatch: "linear-gradient(135deg,#8c8a74,#d9c8a0)" },
  { id: "moody", label: "Moody", swatch: "linear-gradient(135deg,#1c2533,#4a5566)" },
  { id: "vintage", label: "Vintage", swatch: "linear-gradient(135deg,#b59a6d,#e2cfa2)" },
  { id: "hitam_putih", label: "Black & white", swatch: "linear-gradient(135deg,#111,#ddd)" },
  { id: "cerah", label: "Bright", swatch: "linear-gradient(135deg,#ffd166,#4cc9f0)" },
  { id: "dingin", label: "Cool", swatch: "linear-gradient(135deg,#4a7fbf,#a9cbe8)" },
] as const;

type Field = { key: keyof Grade; label: string; min: number; max: number; step?: number };

const BASIC: Field[] = [
  { key: "exposure", label: "Exposure", min: -2, max: 2 },
  { key: "contrast", label: "Contrast", min: -1, max: 1 },
  { key: "highlights", label: "Highlights", min: -1, max: 1 },
  { key: "shadows", label: "Shadows", min: -1, max: 1 },
  { key: "saturation", label: "Saturation", min: -1, max: 1 },
  { key: "temperature", label: "Temperature", min: -1, max: 1 },
  { key: "tint", label: "Tint", min: -1, max: 1 },
];

const ADVANCED: Field[] = [
  { key: "fade", label: "Fade", min: 0, max: 1 },
  { key: "vignette", label: "Vignette", min: 0, max: 1 },
  { key: "shadow_tone", label: "Shadow color", min: 0, max: 1 },
  { key: "shadow_hue", label: "Shadow hue", min: 0, max: 360, step: 1 },
  { key: "highlight_tone", label: "Highlight color", min: 0, max: 1 },
  { key: "highlight_hue", label: "Highlight hue", min: 0, max: 360, step: 1 },
];

const HUE_TRACK = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

export function ColorPanel({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const applyLook = useEditor((s) => s.applyLook);
  const previewGrade = useEditor((s) => s.previewGrade);
  const clipCount = useEditor((s) => s.project?.timeline.clips.length ?? 1);
  const references = useEditor((s) => s.project?.references ?? []);
  const uploadReference = useEditor((s) => s.uploadReference);
  const deleteReference = useEditor((s) => s.deleteReference);
  const picker = useRef<HTMLInputElement>(null);
  const [grade, setGradeState] = useState<Grade>(clip.grade);
  const [intensity, setIntensity] = useState(0.7);
  const [auto, setAuto] = useState(true);
  const [allClips, setAllClips] = useState(clipCount > 1);
  const [advanced, setAdvanced] = useState(false);

  const setGrade = (g: Grade) => {
    setGradeState(g);
    previewGrade(clip.id, g);
  };
  const commit = (g: Grade) => applyOps("Adjust clip color", [{ op: "set_grade", clip_ids: [clip.id], grade: { ...g, look: null } }]);
  const look = (id: string | null, k = intensity) =>
    applyLook({ clipIds: allClips ? null : [clip.id], look: id, intensity: k, auto, match: allClips });
  const matchReference = (refId: string) =>
    applyLook({ clipIds: allClips ? null : [clip.id], look: null, intensity: Math.max(intensity, 0.8), auto, match: allClips, referenceId: refId });

  const slider = (f: Field) => {
    const value = grade[f.key] as number;
    const hue = f.key.endsWith("_hue");
    return (
      <div key={f.key} className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor={`grade-${f.key}`} className="text-xs text-text">
            {f.label}
          </label>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {hue ? `${Math.round(value)}°` : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}
          </span>
        </div>
        <input
          id={`grade-${f.key}`}
          type="range"
          min={f.min}
          max={f.max}
          step={f.step ?? 0.01}
          value={value}
          onChange={(e) => setGrade({ ...grade, [f.key]: Number(e.target.value) })}
          onPointerUp={() => commit(grade)}
          onKeyUp={() => commit(grade)}
          onDoubleClick={() => {
            const g = { ...grade, [f.key]: NEUTRAL_GRADE[f.key] };
            setGrade(g);
            commit(g);
          }}
          className={`w-full ${hue ? "h-1.5 appearance-none rounded-full" : ""}`}
          style={hue ? { background: HUE_TRACK } : undefined}
        />
      </div>
    );
  };

  return (
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-50">
      <legend className="display mb-2.5 flex w-full items-center justify-between text-[19px] text-text">
        Color
        {grade.look && <span className="font-normal text-faint">Look: {LOOKS.find((l) => l.id === grade.look)?.label}</span>}
      </legend>

      <div className="grid grid-cols-4 gap-1.5">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => look(l.id)}
            className={`group overflow-hidden rounded-[10px] border text-left transition active:scale-[0.97] ${
              grade.look === l.id ? "border-edge ring-2 ring-text" : "border-line hover:border-line-strong"
            }`}
          >
            <span className="block h-7" style={{ background: l.swatch }} />
            <span className="block truncate px-1.5 py-1 text-[10px] text-text">{l.label}</span>
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs text-text">Match a reference image</p>
        <p className="mt-0.5 text-[11px] leading-snug text-faint">Copies the palette and contrast of a still, not its lighting.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {references.map((r) => (
            <div key={r.id} className="group relative">
              <button
                type="button"
                onClick={() => matchReference(r.id)}
                title={`Match ${r.name}`}
                className="block overflow-hidden rounded-[8px] border-2 border-line transition hover:border-text active:scale-[0.97]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
                <img src={fileUrl(r.url)} alt={r.name} className="h-12 w-[72px] object-cover" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${r.name}`}
                onClick={() => deleteReference(r.id)}
                className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full border-2 border-edge bg-card text-card-text group-hover:grid"
              >
                <X size={9} weight="bold" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="grid h-12 w-[72px] place-items-center rounded-[8px] border-2 border-dashed border-line-strong text-muted transition hover:border-text hover:text-text"
            aria-label="Add a reference image"
            title="Add a reference image"
          >
            <Plus size={14} weight="bold" />
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const id = await uploadReference(f);
              if (id) matchReference(id);
            }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="look-intensity" className="text-xs text-text">
            Strength
          </label>
          <span className="font-mono text-[11px] tabular-nums text-muted">{Math.round(intensity * 100)}%</span>
        </div>
        <input
          id="look-intensity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          onPointerUp={() => grade.look && look(grade.look, intensity)}
          className="w-full"
        />
      </div>

      <div className="space-y-1.5 text-xs text-text">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-correct exposure and white balance
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allClips} onChange={(e) => setAllClips(e.target.checked)} />
          All clips, matched to each other
        </label>
      </div>

      <button
        type="button"
        onClick={() => look(null)}
        className="flex items-center gap-1.5 rounded-full border-2 border-edge px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-raised active:scale-[0.98]"
      >
        <MagicWand size={13} /> Correct only
      </button>

      <div className="space-y-3 border-t border-line pt-4">{BASIC.map(slider)}</div>

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="flex items-center gap-1.5 text-xs text-muted transition hover:text-text"
        >
          <CaretRight size={11} className={`transition-transform ${advanced ? "rotate-90" : ""}`} /> Advanced
        </button>
        <AnimatePresence initial={false}>
          {advanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-3 overflow-hidden pt-3"
            >
              {ADVANCED.map(slider)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={() => {
          setGrade(NEUTRAL_GRADE);
          commit(NEUTRAL_GRADE);
        }}
        className="text-xs text-muted transition hover:text-text"
      >
        Reset this clip&apos;s color
      </button>
    </fieldset>
  );
}
