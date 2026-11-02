"use client";

import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import { fileUrl, type MediaView } from "@/lib/api";
import { toFrames } from "@/lib/time";
import type { Clip, CropKey, Grade, TextItem, Timeline } from "@/lib/timeline";
import { boxAt, type NormBox, type TrackData } from "@/lib/tracks";

export type CompositionProps = {
  timeline: Timeline;
  media: Record<string, MediaView>;
  tracks: Record<string, TrackData>;
  showTracks: boolean;
};

const ACCENT = "#eea53f";

// Same fractions of output height as the ffmpeg renderer (api/src/auteur/render.py), so the
// preview and the export place text alike.
const TEXT_SIZE = { subtitle: 0.045, title: 0.08, caption: 0.035 } as const;

/** CSS approximation of the renderer's ffmpeg grade; the export is the source of truth. */
export function gradeFilter(g: Grade): string {
  const parts = [
    `brightness(${(1 + g.exposure * 0.25).toFixed(3)})`,
    `contrast(${(1 + g.contrast * 0.5).toFixed(3)})`,
    `saturate(${(1 + g.saturation).toFixed(3)})`,
  ];
  if (g.temperature > 0) parts.push(`sepia(${(g.temperature * 0.35).toFixed(3)})`);
  if (g.temperature < 0) parts.push(`hue-rotate(${(g.temperature * 18).toFixed(1)}deg)`);
  if (g.tint) parts.push(`hue-rotate(${(g.tint * 12).toFixed(1)}deg)`);
  return parts.join(" ");
}

function interpolateKeys(keys: CropKey[], t: number): { cx: number; cy: number } {
  if (!keys.length) return { cx: 0.5, cy: 0.5 };
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t < b.t) {
      const k = (t - a.t) / Math.max(b.t - a.t, 1e-3);
      return { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
    }
  }
  return keys[keys.length - 1];
}

type Place = (b: NormBox) => { left: number; top: number; width: number; height: number };

function ClipLayer({ clip, media, tracks, showTracks }: { clip: Clip; media: MediaView; tracks: Record<string, TrackData>; showTracks: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();

  // Cover-fit the source into the output frame, then pan to the crop center (mirrors crop_filter()).
  const scale = Math.max(W / media.width, H / media.height);
  const vw = media.width * scale;
  const vh = media.height * scale;
  const { cx, cy } = interpolateKeys(clip.crop, frame / fps);
  const left = Math.min(0, Math.max(W - vw, W / 2 - cx * vw));
  const top = Math.min(0, Math.max(H - vh, H / 2 - cy * vh));
  const t = clip.src_in + frame / fps;
  // Source-normalized box -> output pixels, through the same cover + pan as the video itself.
  const place: Place = (b) => ({ left: left + b[0] * vw, top: top + b[1] * vh, width: (b[2] - b[0]) * vw, height: (b[3] - b[1]) * vh });
  // Overlay only the tracks this clip uses; with none in use yet, the newest track for its media.
  const used = new Set([clip.follow?.track_id, ...clip.effects.map((e) => e.track_id)].filter(Boolean));
  const forMedia = Object.values(tracks).filter((tr) => tr.media_id === clip.media_id);
  const mediaTracks = used.size ? forMedia.filter((tr) => used.has(tr.id)) : forMedia.slice(-1);
  const kept = new Set(clip.effects.flatMap((e) => (e.kind === "blur" ? e.exclude_ids.map((o) => `${e.track_id}:${o}`) : [])));

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#09090b" }}>
      <Video
        src={fileUrl(media.preview_url)}
        trimBefore={Math.round(clip.src_in * fps)}
        muted={clip.muted}
        objectFit="fill"
        style={{ position: "absolute", left, top, width: vw, height: vh, filter: gradeFilter(clip.grade) }}
      />
      {clip.effects.map((e, i) => {
        const track = tracks[e.track_id];
        if (!track) return null;
        const ids = (e.object_ids ?? Object.keys(track.objects)).filter(
          (oid) => e.kind !== "blur" || !e.exclude_ids.includes(oid),
        );
        const boxes = ids
          .map((oid) => boxAt(track, oid, t, e.kind === "blur" ? e.hold : undefined))
          .filter((b): b is NormBox => b !== null);
        return e.kind === "blur" ? (
          boxes.map((b, k) => <BlurPatch key={`${i}-${k}`} rect={place(b)} strength={e.strength} />)
        ) : (
          <Spotlight key={i} rects={boxes.map(place)} dim={e.dim_background} />
        );
      })}
      {showTracks &&
        mediaTracks.map((track) =>
          Object.keys(track.objects).map((oid) => {
            const b = boxAt(track, oid, t);
            const subject = (clip.follow?.track_id === track.id && clip.follow.object_id === oid) || kept.has(`${track.id}:${oid}`);
            return b ? <TrackBox key={`${track.id}-${oid}`} rect={place(b)} label={`${track.prompt} ${oid}`} strong={subject} /> : null;
          }),
        )}
    </AbsoluteFill>
  );
}

/** Preview stand-in for the OpenCV blur: a frosted ellipse over the tracked box (grown like the renderer). */
function BlurPatch({ rect, strength }: { rect: ReturnType<Place>; strength: number }) {
  const gx = rect.width * 0.15;
  const gy = rect.height * 0.15;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.left - gx,
        top: rect.top - gy,
        width: rect.width + 2 * gx,
        height: rect.height + 2 * gy,
        borderRadius: "50%",
        backdropFilter: `blur(${Math.round(12 + strength * 28)}px)`,
        WebkitBackdropFilter: `blur(${Math.round(12 + strength * 28)}px)`,
      }}
    />
  );
}

function Spotlight({ rects, dim }: { rects: ReturnType<Place>[]; dim: number }) {
  const { width: W, height: H } = useVideoConfig();
  if (!rects.length) return <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />;
  // Darken everything except the tracked boxes with an even-odd SVG path.
  const holes = rects.map((r) => `M${r.left},${r.top}h${r.width}v${r.height}h${-r.width}z`).join("");
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <path d={`M0,0H${W}V${H}H0Z${holes}`} fill={`rgba(0,0,0,${dim})`} fillRule="evenodd" />
    </svg>
  );
}

function TrackBox({ rect, label, strong }: { rect: ReturnType<Place>; label: string; strong: boolean }) {
  const { height: H } = useVideoConfig();
  const stroke = Math.max(2, H / 360);
  return (
    <div
      style={{
        position: "absolute",
        ...rect,
        border: `${stroke}px solid ${strong ? ACCENT : "rgba(255,255,255,0.55)"}`,
        borderRadius: stroke * 2,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: -stroke,
          top: -H * 0.028,
          padding: `0 ${H * 0.006}px`,
          fontFamily: "monospace",
          fontSize: H * 0.018,
          lineHeight: `${H * 0.026}px`,
          color: strong ? "#1c1306" : "#0b0b0d",
          background: strong ? ACCENT : "rgba(255,255,255,0.8)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function TextLayer({ item }: { item: TextItem }) {
  const { width: W, height: H } = useVideoConfig();
  const size = Math.round(H * TEXT_SIZE[item.style]);
  const caption = item.style === "caption";
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: item.x * W,
          top: item.y * H,
          transform: "translate(-50%, -50%)",
          maxWidth: W * 0.85,
          width: "max-content",
          textAlign: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.15,
          color: "white",
          whiteSpace: "pre-wrap",
          padding: caption ? size / 3 : 0,
          borderRadius: caption ? size / 3 : 0,
          background: caption ? "rgba(0,0,0,0.63)" : undefined,
          WebkitTextStroke: caption ? undefined : `${Math.max(2, size / 12)}px black`,
          paintOrder: "stroke fill",
        }}
      >
        {item.text}
      </div>
    </AbsoluteFill>
  );
}

export function TimelineComposition({ timeline, media, tracks, showTracks }: CompositionProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#09090b" }}>
      <Series>
        {timeline.clips.map((clip) => {
          const m = media[clip.media_id];
          return (
            <Series.Sequence
              key={clip.id}
              name={clip.id}
              durationInFrames={toFrames(clip.src_out - clip.src_in, fps)}
              premountFor={fps}
            >
              {m ? <ClipLayer clip={clip} media={m} tracks={tracks} showTracks={showTracks} /> : null}
            </Series.Sequence>
          );
        })}
      </Series>
      {timeline.texts.map((t) => (
        <Sequence
          key={t.id}
          name={t.id}
          from={Math.round(t.start * fps)}
          durationInFrames={toFrames(t.end - t.start, fps)}
          premountFor={fps}
        >
          <TextLayer item={t} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
