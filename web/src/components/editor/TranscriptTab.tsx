"use client";

import { CircleNotch, Scissors, Waveform } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type TranscriptView } from "@/lib/api";
import { useEditor } from "@/lib/store";

type Key = `${number}:${number}`; // clip index : word index
const EMPTY = new Set<Key>();

/** Each run of consecutive selected words in a clip is one cut: from the run's first word to the start of
 * the next kept word, so the word's sound and the pause after it go (word times from streaming
 * recognition are only the moment a word was heard). A run at the end of a clip goes to the clip's end. */
export function wordCuts(view: TranscriptView, keys: Set<string>) {
  const cuts: { clip_id: string; src_start: number; src_end: number }[] = [];
  view.clips.forEach((c, ci) => {
    let from: number | null = null;
    c.words.forEach((w, wi) => {
      const on = keys.has(`${ci}:${wi}`);
      if (on && from === null) from = w.src_start;
      if (!on && from !== null) {
        cuts.push({ clip_id: c.clip_id, src_start: from, src_end: w.src_start });
        from = null;
      }
    });
    if (from !== null) cuts.push({ clip_id: c.clip_id, src_start: from, src_end: 1e6 }); // the API clamps to the clip
  });
  return cuts;
}

/** Edit by transcript: the words spoken on the timeline. Click a word to jump there; drag across words
 * (or shift-click) to select, then Delete cuts them out of the video. */
export function TranscriptTab() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const seek = useEditor((s) => s.seek);
  const cutWords = useEditor((s) => s.cutWords);
  const pending = useEditor((s) => s.pending);
  const [view, setView] = useState<TranscriptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // A selection belongs to the timeline it was made on; any edit makes it stale (and empty).
  const [selection, setSelection] = useState<{ version: number; keys: Set<Key> }>({ version: -1, keys: new Set() });
  const anchor = useRef<Key | null>(null);
  const dragging = useRef(false);
  const version = project?.history.length ?? 0;
  const locked = Boolean(project?.busy || pending);
  const selected = selection.version === version ? selection.keys : EMPTY;
  const setSelected = useCallback((keys: Set<Key>) => setSelection({ version, keys }), [version]);

  const reload = useCallback(() => {
    if (!project) return;
    api.getTranscript(project.id).then(setView, (e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload whenever the timeline changes (cuts, trims, the agent's edits).
  useEffect(() => {
    reload();
  }, [reload, version]);

  const order = (view?.clips ?? []).flatMap((c, ci) => c.words.map((_, wi) => `${ci}:${wi}` as Key));
  const range = (a: Key, b: Key) => {
    const [i, j] = [order.indexOf(a), order.indexOf(b)].sort((x, y) => x - y);
    return new Set(order.slice(i, j + 1));
  };

  const cut = useCallback(
    async (keys: Set<Key>, label: string) => {
      if (!view || !keys.size) return;
      const cuts = wordCuts(view, keys);
      if (await cutWords(cuts, label)) setSelected(new Set());
    },
    [view, cutWords, setSelected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size && !locked) {
        e.preventDefault();
        e.stopImmediatePropagation(); // not the timeline's delete
        cut(selected, `Cut ${selected.size} ${selected.size === 1 ? "word" : "words"}`);
      }
    };
    window.addEventListener("keydown", onKey, true);
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerup", up);
    };
  }, [selected, locked, cut]);

  if (!project) return null;
  const fillers = new Set<Key>(
    (view?.clips ?? []).flatMap((c, ci) => c.words.flatMap((w, wi) => (w.filler ? [`${ci}:${wi}` as Key] : []))),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="label text-faint">⁞ Voice Transcribe</p>
        <p className="display mt-1 text-[30px] leading-none text-text">Edit by words</p>
        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        {view && view.missing.length > 0 && (
          <div className="mt-3 rounded-[12px] border-2 border-edge bg-card p-3 text-card-text">
            <p className="text-[13px]">
              {view.missing.length} {view.missing.length === 1 ? "file on the timeline hasn't" : "files on the timeline haven't"} been transcribed.
            </p>
            <button
              type="button"
              disabled={running || locked}
              onClick={async () => {
                setRunning(true);
                setError(null);
                try {
                  setView(await api.runTranscription(project.id));
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : String(e));
                } finally {
                  setRunning(false);
                }
              }}
              className="mt-2 flex items-center gap-1.5 rounded-full border-2 border-ink bg-lime px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-40"
            >
              {running ? <CircleNotch size={13} className="animate-spin" /> : <Waveform size={13} weight="bold" />}
              {running ? "Transcribing..." : `Transcribe ${Math.round(view.missing_seconds)}s · about $${((view.missing_seconds / 60) * 0.003).toFixed(3)}`}
            </button>
          </div>
        )}
        {view && view.clips.length === 0 && view.missing.length === 0 && (
          <p className="mt-3 text-[13px] text-muted">No speech on the timeline. Clips with sound show their words here.</p>
        )}
        <div className="mt-4 space-y-3 select-none" onPointerLeave={() => (dragging.current = false)}>
          {view?.clips.map((c, ci) => (
            <p key={c.clip_id} className="text-[15px] leading-[1.9] text-text">
              {c.words.map((w, wi) => {
                const key = `${ci}:${wi}` as Key;
                const on = selected.has(key);
                const now = time >= w.start && time < w.end;
                return (
                  <span key={wi}>
                    <span
                      role="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        if (locked) return;
                        dragging.current = true;
                        if (e.shiftKey && anchor.current) setSelected(range(anchor.current, key));
                        else {
                          anchor.current = key;
                          setSelected(new Set([key]));
                          seek(w.start);
                        }
                      }}
                      onPointerEnter={() => dragging.current && anchor.current && setSelected(range(anchor.current, key))}
                      className={`cursor-text rounded-[4px] px-0.5 ${on ? "bg-tomato/40 line-through decoration-2" : now ? "bg-accent-soft text-accent" : w.filler ? "text-faint italic" : "hover:bg-raised"}`}
                    >
                      {w.text}
                    </span>{" "}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </div>
      {view && view.clips.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-edge p-3">
          <button
            type="button"
            disabled={!selected.size || locked}
            onClick={() => cut(selected, `Cut ${selected.size} ${selected.size === 1 ? "word" : "words"}`)}
            className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-pink px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40"
          >
            <Scissors size={13} weight="bold" /> Cut {selected.size || ""} {selected.size === 1 ? "word" : "words"}
          </button>
          <button
            type="button"
            disabled={!fillers.size || locked}
            onClick={() => setSelected(fillers)}
            className="rounded-full border-2 border-line px-3 py-1 text-[12px] text-muted hover:text-text disabled:opacity-40"
          >
            Select fillers ({fillers.size})
          </button>
          <span className="ml-auto text-[11px] text-faint">Drag or shift-click to select · Delete cuts</span>
        </div>
      )}
    </div>
  );
}
