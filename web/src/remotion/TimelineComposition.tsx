"use client";

import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { fileUrl, type MediaView } from "@/lib/api";
import { clipDuration, clipStarts, timelineDuration, toFrames } from "@/lib/time";
import type { AudioItem, Clip, Grade, Overlay, Timeline, Transition } from "@/lib/timeline";
import { isIdentity, NEUTRAL_GRADE, saturationMatrix, tableValues, vignetteAt } from "@/lib/grade";
import { cropAt, volumeAt } from "@/lib/keys";
import { boxAt, type NormBox, type TrackData } from "@/lib/tracks";
import { TextLayer } from "./TextLayer";

export type CompositionProps = {
  timeline: Timeline;
  media: Record<string, MediaView>;
  tracks: Record<string, TrackData>;
  showTracks: boolean;
  /** Show the untouched footage: no grade, crop pan, effects or text. */
  raw: boolean;
  /** Timeline ranges with speech, for ducking music in the preview. */
  speech: [number, number][];
};

const ACCENT = "#eea53f";


/**
 * The clip's grade as an SVG filter: the same tone curves (feComponentTransfer, interpolated like
 * ffmpeg's lut1d) and saturation matrix the renderer uses, in sRGB like ffmpeg.
 */
function GradeFilter({ id, grade }: { id: string; grade: Grade }) {
  const [r, g, b] = tableValues(grade);
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="table" tableValues={r} />
          <feFuncG type="table" tableValues={g} />
          <feFuncB type="table" tableValues={b} />
        </feComponentTransfer>
        <feColorMatrix type="matrix" values={saturationMatrix(grade)} />
      </filter>
    </svg>
  );
}

/** Black overlay whose alpha is 1 - vignette factor: identical to the renderer's multiply mask. */
function Vignette({ grade }: { grade: Grade }) {
  const stops = Array.from({ length: 11 }, (_, i) => `rgba(0,0,0,${(1 - vignetteAt(grade, i / 10)).toFixed(3)}) ${i * 10}%`);
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse farthest-corner at center, ${stops.join(", ")})` }} />;
}

type Place = (b: NormBox) => { left: number; top: number; width: number; height: number };

type Joins = { crossIn: number; crossOut: number; dipIn: Transition | null; dipOut: Transition | null };

function ClipLayer(props: {
  clip: Clip;
  media: MediaView;
  tracks: Record<string, TrackData>;
  showTracks: boolean;
  raw: boolean;
  joins: Joins;
}) {
  const { media, tracks, showTracks, raw, joins } = props;
  const clip = raw ? { ...props.clip, crop: [], effects: [], grade: NEUTRAL_GRADE, zoom: null } : props.clip;
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const local = frame / fps;
  const duration = clipDuration(clip);
  const ramp = (x: number) => Math.min(1, Math.max(0, x));
  // Crossfades blend this clip in over the previous one (it is drawn on top); audio ramps both ways.
  const opacity = joins.crossIn ? ramp(local / joins.crossIn) : 1;
  const dipInAmount = joins.dipIn ? 1 - ramp(local / (joins.dipIn.duration / 2)) : 0;
  const dipOutAmount = joins.dipOut ? ramp((local - (duration - joins.dipOut.duration / 2)) / (joins.dipOut.duration / 2)) : 0;
  const audioIn = joins.crossIn ? ramp(local / joins.crossIn) : joins.dipIn ? 1 - dipInAmount : 1;
  const audioOut = joins.crossOut ? ramp((duration - local) / joins.crossOut) : joins.dipOut ? 1 - dipOutAmount : 1;
  const zoom = clip.zoom ? clip.zoom.start + (clip.zoom.end - clip.zoom.start) * Math.min(local / Math.max(duration, 1e-3), 1) : 1;

  // Cover-fit the source into the output frame, then pan to the crop center (mirrors crop_filter()).
  const scale = Math.max(W / media.width, H / media.height);
  const vw = media.width * scale;
  const vh = media.height * scale;
  const { cx, cy } = cropAt(clip.crop, frame / fps);
  const left = Math.min(0, Math.max(W - vw, W / 2 - cx * vw));
  const top = Math.min(0, Math.max(H - vh, H / 2 - cy * vh));
  const t = clip.src_in + local * clip.speed;
  const filterId = `grade-${clip.id}`;
  // Source-normalized box -> output pixels, through the same cover + pan as the video itself.
  const place: Place = (b) => ({ left: left + b[0] * vw, top: top + b[1] * vh, width: (b[2] - b[0]) * vw, height: (b[3] - b[1]) * vh });
  // Overlay only the tracks this clip uses; with none in use yet, the newest track for its media.
  const used = new Set([clip.follow?.track_id, ...clip.effects.map((e) => e.track_id)].filter(Boolean));
  const forMedia = Object.values(tracks).filter((tr) => tr.media_id === clip.media_id);
  const mediaTracks = used.size ? forMedia.filter((tr) => used.has(tr.id)) : forMedia.slice(-1);
  const kept = new Set(clip.effects.flatMap((e) => (e.kind === "blur" ? e.exclude_ids.map((o) => `${e.track_id}:${o}`) : [])));

  const audible = !clip.muted && clip.speed === 1 && clip.volume > 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#09090b", opacity }}>
     <AbsoluteFill style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}>
      <Video
        src={fileUrl(media.preview_url)}
        trimBefore={Math.round(clip.src_in * fps)}
        playbackRate={clip.speed}
        muted={!audible}
        volume={audible ? clip.volume * volumeAt(clip.volume_keys, local) * audioIn * audioOut : 0}
        objectFit="fill"
        style={{
          position: "absolute", left, top, width: vw, height: vh,
          filter: isIdentity(clip.grade) ? undefined : `url(#${filterId})`,
        }}
      />
      {!isIdentity(clip.grade) && <GradeFilter id={filterId} grade={clip.grade} />}
      {clip.grade.vignette > 0 && <Vignette grade={clip.grade} />}
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
      {joins.dipIn && dipInAmount > 0 && (
        <AbsoluteFill style={{ background: joins.dipIn.kind === "dip_black" ? "#000" : "#fff", opacity: dipInAmount }} />
      )}
      {joins.dipOut && dipOutAmount > 0 && (
        <AbsoluteFill style={{ background: joins.dipOut.kind === "dip_black" ? "#000" : "#fff", opacity: dipOutAmount }} />
      )}
    </AbsoluteFill>
  );
}

// Mirrors render.overlay_rect: picture-in-picture is 34% of the frame, in a corner.
const LAYOUT_BOX: Record<string, [number, number]> = {
  kanan_atas: [0.63, 0.04], kiri_atas: [0.03, 0.04], kanan_bawah: [0.63, 0.62], kiri_bawah: [0.03, 0.62],
};
const PIP_SCALE = 0.34;

function OverlayLayer({ item, media }: { item: Overlay; media: MediaView }) {
  const { fps, width: W, height: H } = useVideoConfig();
  const full = item.layout === "full";
  const w = full ? W : Math.round((W * PIP_SCALE) / 2) * 2;
  const h = full ? H : Math.round((H * PIP_SCALE) / 2) * 2;
  const [fx, fy] = full ? [0, 0] : LAYOUT_BOX[item.layout];
  // Cover-fit, centered: the same window crop_filter takes without crop keys.
  const scale = Math.max(w / media.width, h / media.height);
  const vw = media.width * scale;
  const vh = media.height * scale;
  const filterId = `grade-${item.id}`;
  return (
    <div style={{ position: "absolute", left: Math.round(W * fx), top: Math.round(H * fy), width: w, height: h, overflow: "hidden" }}>
      <Video
        src={fileUrl(media.preview_url)}
        trimBefore={Math.round(item.src_in * fps)}
        muted
        objectFit="fill"
        style={{
          position: "absolute", left: (w - vw) / 2, top: (h - vh) / 2, width: vw, height: vh,
          filter: isIdentity(item.grade) ? undefined : `url(#${filterId})`,
        }}
      />
      {!isIdentity(item.grade) && <GradeFilter id={filterId} grade={item.grade} />}
    </div>
  );
}

function MusicLayer({ item, media, speech }: { item: AudioItem; media: MediaView; speech: [number, number][] }) {
  const { fps } = useVideoConfig();
  const length = item.src_out - item.src_in;
  return (
    <Audio
      src={fileUrl(media.preview_url)}
      trimBefore={Math.round(item.src_in * fps)}
      volume={(f) => {
        const t = f / fps;
        const fadeIn = item.fade_in ? Math.min(1, t / item.fade_in) : 1;
        const fadeOut = item.fade_out ? Math.min(1, Math.max(0, (length - t) / item.fade_out)) : 1;
        // Approximates the export's sidechain compressor: about -9 dB while someone speaks.
        const at = item.start + t;
        const talking = item.duck && speech.some(([a, b]) => at >= a - 0.1 && at <= b + 0.3);
        return item.volume * fadeIn * fadeOut * (talking ? 0.35 : 1);
      }}
    />
  );
}

function Finish({ letterbox, grain }: { letterbox: number | null; grain: number }) {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const bar = letterbox ? Math.max(0, Math.round((H - W / letterbox) / 2)) : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {grain > 0 && (
        // Animated noise standing in for ffmpeg's temporal `noise` filter.
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.12 + grain * 0.3, mixBlendMode: "overlay" }}>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={frame % 97} />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      )}
      {bar > 0 && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: bar, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, bottom: 0, width: W, height: bar, background: "#000" }} />
        </>
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

export function TimelineComposition({ timeline, media, tracks, showTracks, raw, speech }: CompositionProps) {
  const { fps } = useVideoConfig();
  const starts = clipStarts(timeline.clips);
  const total = timelineDuration(timeline.clips);
  const kindOf = (i: number) => timeline.clips[i]?.transition?.kind;
  return (
    <AbsoluteFill style={{ backgroundColor: "#09090b" }}>
      {/* Absolute placement (not a Series) so crossfading clips can overlap; later clips draw on top. */}
      {timeline.clips.map((clip, i) => {
        const m = media[clip.media_id];
        const next = timeline.clips[i + 1];
        const joins: Joins = {
          crossIn: i > 0 && kindOf(i) === "crossfade" ? clip.transition!.duration : 0,
          crossOut: kindOf(i + 1) === "crossfade" ? next!.transition!.duration : 0,
          dipIn: clip.transition && clip.transition.kind !== "crossfade" ? clip.transition : null,
          dipOut: next?.transition && next.transition.kind !== "crossfade" ? next.transition : null,
        };
        return (
          <Sequence
            key={clip.id}
            name={clip.id}
            from={Math.round(starts[i] * fps)}
            durationInFrames={toFrames(clipDuration(clip), fps)}
            premountFor={fps}
          >
            {m ? <ClipLayer clip={clip} media={m} tracks={tracks} showTracks={showTracks && !raw} raw={raw} joins={joins} /> : null}
          </Sequence>
        );
      })}
      {!raw &&
        timeline.overlays.map((o) =>
          media[o.media_id] && o.start < total ? (
            <Sequence key={o.id} name={o.id} from={Math.round(o.start * fps)} durationInFrames={toFrames(o.src_out - o.src_in, fps)} premountFor={fps}>
              <OverlayLayer item={o} media={media[o.media_id]} />
            </Sequence>
          ) : null,
        )}
      {timeline.audio.map((a) =>
        media[a.media_id] && a.start < total ? (
          <Sequence key={a.id} name={a.id} from={Math.round(a.start * fps)} durationInFrames={toFrames(Math.min(a.src_out - a.src_in, total - a.start), fps)}>
            <MusicLayer item={a} media={media[a.media_id]} speech={speech} />
          </Sequence>
        ) : null,
      )}
      {!raw && <Finish letterbox={timeline.finish.letterbox} grain={timeline.finish.grain} />}
      {!raw && timeline.texts.map((t) => (
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
