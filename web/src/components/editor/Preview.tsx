"use client";

import { BoundingBox, ImageSquare, Pause, Play, SkipBack } from "@phosphor-icons/react";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { timecode, timelineDuration, toFrames } from "@/lib/time";
import { TimelineComposition } from "@/remotion/TimelineComposition";

const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] } as const;

export function Preview() {
  const project = useEditor((s) => s.project);
  const seekRequest = useEditor((s) => s.seekRequest);
  const setTime = useEditor((s) => s.setTime);
  const time = useEditor((s) => s.time);
  const tracks = useEditor((s) => s.tracks);
  const showTracks = useEditor((s) => s.showTracks);
  const setShowTracks = useEditor((s) => s.setShowTracks);
  const before = useEditor((s) => s.before);
  const setBefore = useEditor((s) => s.setBefore);
  const player = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);

  const timeline = project?.timeline;
  const fps = timeline?.fps ?? 30;
  const duration = timeline ? timelineDuration(timeline.clips) : 0;
  const [w, h] = SIZES[timeline?.aspect ?? "16:9"];
  const hasPlayer = duration > 0;

  const inputProps = useMemo(
    () => ({
      timeline: timeline!,
      media: Object.fromEntries((project?.media ?? []).map((m) => [m.id, m])),
      tracks,
      showTracks,
      raw: before,
      speech: project?.speech ?? [],
    }),
    [timeline, project?.media, project?.speech, tracks, showTracks, before],
  );

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [fps, setTime, hasPlayer]);

  useEffect(() => {
    if (seekRequest && player.current) player.current.seekTo(Math.round(seekRequest.time * fps));
  }, [seekRequest, fps]);

  // Space toggles playback unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || el.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      player.current?.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg">
      <div className="stage relative flex min-h-0 flex-1 items-center justify-center p-5">
        {before && (
          <span className="label pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2 -rotate-2 rounded-full border-2 border-ink bg-sun px-3 py-1 text-ink">
            Before edits
          </span>
        )}
        {timeline && hasPlayer ? (
          <Player
            ref={player}
            component={TimelineComposition}
            inputProps={inputProps}
            durationInFrames={toFrames(duration, fps)}
            compositionWidth={w}
            compositionHeight={h}
            fps={fps}
            acknowledgeRemotionLicense
            clickToPlay
            style={{ width: "100%", height: "100%" }}
            className="[&>div]:rounded-[10px]"
          />
        ) : (
          <EmptyPreview hasMedia={(project?.media.length ?? 0) > 0} />
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 border-t-2 border-edge px-4">
        <button
          type="button"
          aria-label="To start"
          onClick={() => player.current?.seekTo(0)}
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <SkipBack size={16} weight="fill" />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={duration === 0}
          onClick={() => player.current?.toggle()}
          className="grid size-9 place-items-center rounded-full bg-accent text-accent-ink transition hover:brightness-105 active:scale-[0.94] disabled:opacity-40"
        >
          {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
        </button>
        <span className="font-mono text-xs tabular-nums text-text">{timecode(time, fps)}</span>
        <span className="font-mono text-xs tabular-nums text-faint">/ {timecode(duration, fps)}</span>
        <button
          type="button"
          disabled={!hasPlayer}
          onPointerDown={() => setBefore(true)}
          onPointerUp={() => setBefore(false)}
          onPointerLeave={() => setBefore(false)}
          onKeyDown={(e) => e.key === "Enter" && setBefore(true)}
          onKeyUp={() => setBefore(false)}
          title="Hold to see the footage before edits"
          className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors select-none disabled:opacity-40 ${
            before ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-text"
          }`}
        >
          <ImageSquare size={14} /> Before
        </button>
        {Object.keys(tracks).length > 0 && (
          <button
            type="button"
            aria-pressed={showTracks}
            onClick={() => setShowTracks(!showTracks)}
            title="Show SAM tracking boxes"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              showTracks ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-text"
            }`}
          >
            <BoundingBox size={14} /> Tracking boxes
          </button>
        )}
        <span className="font-mono text-[11px] text-faint">
          {w}×{h} · {fps} fps
        </span>
      </div>
    </section>
  );
}

function EmptyPreview({ hasMedia }: { hasMedia: boolean }) {
  return (
    <div className="max-w-sm text-center">
      <p className="text-sm text-text">The timeline is empty</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        {hasMedia
          ? "Ask the agent to build the video in the right panel, or add clips from the media bin."
          : "Upload footage to the media bin, then direct the agent like a human editor."}
      </p>
    </div>
  );
}
