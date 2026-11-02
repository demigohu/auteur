"use client";

import { Crosshair, SpeakerSimpleHigh, SpeakerSimpleSlash, X } from "@phosphor-icons/react";
import { useState } from "react";
import { useEditor } from "@/lib/store";
import { clipDuration } from "@/lib/time";
import type { Clip, TextItem } from "@/lib/timeline";
import { ColorPanel } from "./ColorPanel";
import { ClipMotion, FinishPanel, MusicInspector, OverlayInspector } from "./MontagePanels";


export function InspectorTab() {
  const project = useEditor((s) => s.project);
  const clipId = useEditor((s) => s.selectedClipId);
  const textId = useEditor((s) => s.selectedTextId);
  const overlayId = useEditor((s) => s.selectedOverlayId);
  const audioId = useEditor((s) => s.selectedAudioId);
  const clip = project?.timeline.clips.find((c) => c.id === clipId);
  const text = project?.timeline.texts.find((t) => t.id === textId);
  const overlay = project?.timeline.overlays.find((o) => o.id === overlayId);
  const music = project?.timeline.audio.find((a) => a.id === audioId);
  const locked = project?.busy ?? false;
  // Remount the form whenever a committed edit lands (user, agent, or undo) but not while a
  // slider only previews locally, so sliders keep their drag state.
  const version = project?.history.length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {clip ? (
        <ClipInspector key={`${clip.id}:${version}`} clip={clip} locked={locked} />
      ) : text ? (
        <TextInspector key={`${text.id}:${version}`} item={text} locked={locked} />
      ) : overlay ? (
        <OverlayInspector key={`${overlay.id}:${version}`} item={overlay} locked={locked} />
      ) : music ? (
        <MusicInspector key={`${music.id}:${version}`} item={music} locked={locked} />
      ) : (
        <div className="space-y-5 pt-2">
          <div>
            <p className="text-sm text-text">Belum ada yang dipilih</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Klik klip, teks, B-roll, atau musik di timeline untuk mengaturnya.
            </p>
          </div>
          <FinishPanel key={version} locked={locked} />
        </div>
      )}
    </div>
  );
}

function ClipInspector({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const media = useEditor((s) => s.project?.media.find((m) => m.id === clip.media_id));
  const isFirst = useEditor((s) => s.project?.timeline.clips[0]?.id === clip.id);

  return (
    <div className="space-y-6">
      <div>
        <p className="truncate text-sm font-medium text-text">{media?.name ?? clip.media_id}</p>
        <p className="mt-0.5 font-mono text-[11px] text-faint">{clipDuration(clip).toFixed(2)} detik di timeline</p>
      </div>

      <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
        <legend className="mb-2 text-xs font-medium text-muted">Potongan sumber</legend>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            key={`in-${clip.src_in}`}
            label="Masuk (dtk)"
            value={clip.src_in}
            onCommit={(v) => applyOps("Trim klip", [{ op: "trim", clip_id: clip.id, src_in: v }])}
          />
          <NumberField
            key={`out-${clip.src_out}`}
            label="Keluar (dtk)"
            value={clip.src_out}
            onCommit={(v) => applyOps("Trim klip", [{ op: "trim", clip_id: clip.id, src_out: v }])}
          />
        </div>
        <button
          type="button"
          onClick={() => applyOps(clip.muted ? "Nyalakan suara klip" : "Bisukan klip", [{ op: "set_muted", clip_id: clip.id, muted: !clip.muted }])}
          className="flex items-center gap-2 rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-text transition hover:bg-raised active:scale-[0.98]"
        >
          {clip.muted ? <SpeakerSimpleSlash size={14} /> : <SpeakerSimpleHigh size={14} />}
          {clip.muted ? "Suara dibisukan" : "Suara aktif"}
        </button>
      </fieldset>

      <ClipMotion clip={clip} isFirst={isFirst} locked={locked} />

      {(clip.follow || clip.effects.length > 0) && (
        <TrackingInfo clip={clip} locked={locked} />
      )}

      <ColorPanel clip={clip} locked={locked} />
    </div>
  );
}

function TrackingInfo({ clip, locked }: { clip: Clip; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  const tracks = useEditor((s) => s.project?.tracks ?? []);
  const prompt = (id: string) => tracks.find((t) => t.id === id)?.prompt ?? id;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Pelacakan</p>
      {clip.follow && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-xs text-text">
          <Crosshair size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            Crop mengikuti {prompt(clip.follow.track_id)} {clip.follow.object_id}
          </span>
          <button
            type="button"
            disabled={locked}
            aria-label="Kembalikan ke crop tengah"
            onClick={() => applyOps("Hapus reframe", [{ op: "set_crop", clip_id: clip.id, keys: [], follow: null }])}
            className="shrink-0 text-muted hover:text-text disabled:opacity-40"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {clip.effects.map((e, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-xs text-text">
          <span className="min-w-0 flex-1 truncate">
            {e.kind === "blur" ? "Blur" : "Sorot"} {prompt(e.track_id)}
            {e.object_ids ? ` (${e.object_ids.length} objek)` : " (semua)"}
            {e.kind === "blur" && e.exclude_ids.length > 0 ? `, kecuali ${e.exclude_ids.join(", ")}` : ""}
          </span>
          <button
            type="button"
            disabled={locked}
            aria-label="Hapus efek"
            onClick={() =>
              applyOps("Hapus efek", [{ op: "set_effects", clip_id: clip.id, effects: clip.effects.filter((_, k) => k !== i) }])
            }
            className="shrink-0 text-muted hover:text-text disabled:opacity-40"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const TEXT_LOOKS: { id: TextItem["look"]; label: string }[] = [
  { id: "karaoke", label: "Karaoke" },
  { id: "kotak", label: "Kotak" },
  { id: "tebal", label: "Tebal" },
  { id: "pop", label: "Pop" },
  { id: "bersih", label: "Bersih" },
];
const ACCENTS = ["#FFD43B", "#7CFC6A", "#FF5FA2", "#3DD6FF", "#FF8A3D", "#FFFFFF"];

function TextInspector({ item, locked }: { item: TextItem; locked: boolean }) {
  const applyOps = useEditor((s) => s.applyOps);
  // Select the stable array and filter outside the selector: a filtered array is new on every call,
  // which makes the store subscription loop forever.
  const texts = useEditor((s) => s.project?.timeline.texts);
  const subtitles = (texts ?? []).filter((t) => t.style === "subtitle");
  const [text, setText] = useState(item.text);
  const [everywhere, setEverywhere] = useState(item.style === "subtitle");
  const update = (patch: Partial<TextItem>, label = "Ubah teks") =>
    applyOps(label, [{ op: "update_text", text_id: item.id, ...patch }]);
  // Style changes apply to every subtitle by default, like a caption preset in CapCut.
  const restyle = (patch: { look?: TextItem["look"]; color?: string }, label: string) =>
    applyOps(
      label,
      (everywhere ? subtitles : [item]).map((t) => ({ op: "update_text" as const, text_id: t.id, ...patch })),
    );

  return (
    <fieldset disabled={locked} className="space-y-5 disabled:opacity-50">
      <div className="space-y-1.5">
        <label htmlFor="text-body" className="text-xs font-medium text-muted">
          Teks ({item.style})
        </label>
        <textarea
          id="text-body"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && text !== item.text && update({ text: text.trim() })}
          className="block w-full resize-none rounded-md border border-line-strong bg-panel-2 px-3 py-2 text-sm text-text focus:border-accent/60 focus:outline-none"
        />
      </div>
      {item.style === "subtitle" && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted">Gaya subtitle</p>
          <div className="grid grid-cols-5 gap-1.5">
            {TEXT_LOOKS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => restyle({ look: l.id }, `Gaya subtitle ${l.label}`)}
                className={`rounded-md border px-1 py-1.5 text-[11px] transition active:scale-[0.97] ${
                  item.look === l.id ? "border-accent text-text" : "border-line text-muted hover:border-line-strong hover:text-text"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text">Warna sorot</span>
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Warna ${c}`}
                onClick={() => restyle({ color: c }, "Warna subtitle")}
                className={`size-5 rounded-full border-2 transition active:scale-90 ${
                  item.color.toUpperCase() === c ? "border-text" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            Terapkan ke semua subtitle ({subtitles.length})
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField key={`s-${item.start}`} label="Mulai (dtk)" value={item.start} onCommit={(v) => update({ start: v }, "Geser teks")} />
        <NumberField key={`e-${item.end}`} label="Selesai (dtk)" value={item.end} onCommit={(v) => update({ end: v }, "Geser teks")} />
      </div>
      <div className="space-y-1">
        <label htmlFor="text-y" className="text-xs text-text">
          Posisi vertikal
        </label>
        <input
          id="text-y"
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          defaultValue={item.y}
          onPointerUp={(e) => update({ y: Number((e.target as HTMLInputElement).value) }, "Pindah posisi teks")}
          className="w-full"
        />
      </div>
    </fieldset>
  );
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v) && Math.abs(v - value) > 0.005) onCommit(Number(v.toFixed(3)));
    else setDraft(value.toFixed(2));
  };
  const id = `num-${label}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="block w-full rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 font-mono text-xs tabular-nums text-text focus:border-accent/60 focus:outline-none"
      />
    </div>
  );
}
