"use client";

import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { fileUrl, type MediaView } from "@/lib/api";
import { clipDuration, clipStarts, timelineDuration, toFrames } from "@/lib/time";
import type { AudioItem, Clip, Grade, Overlay, Timeline, Transition } from "@/lib/timeline";
import { isIdentity, NEUTRAL_GRADE, saturationMatrix, tableValues, vignetteAt } from "@/lib/grade";
import { cropAt, volumeAt } from "@/lib/keys";
import { boxAt, type NormBox, type TrackData } from "@/lib/tracks";
import { cropWindow, fitSize } from "@/lib/crop";
import { poseAt } from "@/lib/animate";
import { overlayRect } from "@/lib/overlay";
import { incoming, outgoing, overlaps } from "@/lib/transitions";
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
  /** ProjectView.clip_previews: prepared variants for reversed and LUT clips. */
  clipPreviews?: Record<string, string | null>;
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

/** How a clip meets its neighbours: overlapping transitions in and out (xfade kinds), or dips. */
type Joins = {
  crossIn: number;
  crossOut: number;
  inKind: Transition["kind"] | null;
  outKind: Transition["kind"] | null;
  dipIn: Transition | null;
  dipOut: Transition | null;
};

function ClipLayer(props: {
  clip: Clip;
  media: MediaView;
  tracks: Record<string, TrackData>;
  showTracks: boolean;
  raw: boolean;
  joins: Joins;
  /** A prepared variant to play (reversed and/or with the LUT baked in); null while it is made. */
  variant?: string | null;
}) {
  const { media, tracks, showTracks, raw, joins } = props;
  // Reversed and LUT clips play from a prepared file; until it exists, the plain preview stands in.
  const playsVariant = !raw && Boolean(props.variant);
  const preparing = !raw && props.variant === null;
  const backwards = playsVariant && props.clip.reverse;
  const src = playsVariant ? props.variant! : media.preview_url;
  // The reversed file holds the whole media backwards: this clip's range sits at mirrored times.
  const startAt = backwards ? media.duration - props.clip.src_out : props.clip.src_in;
  const clip = raw ? { ...props.clip, crop: [], effects: [], grade: NEUTRAL_GRADE, zoom: null } : props.clip;
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const local = frame / fps;
  const duration = clipDuration(clip);
  const ramp = (x: number) => Math.min(1, Math.max(0, x));
  // Overlapping transitions draw this clip in over the previous one (it is drawn on top) and may move the
  // outgoing one (slides, zoom); audio crossfades both ways. lib/transitions mirrors ffmpeg's xfade.
  const qIn = joins.crossIn ? ramp(local / joins.crossIn) : 1;
  const qOut = joins.crossOut ? ramp((local - (duration - joins.crossOut)) / joins.crossOut) : 0;
  const inStyle = joins.inKind && qIn < 1 ? incoming(joins.inKind, qIn, W, H) : {};
  const outStyle = joins.outKind && qOut > 0 ? outgoing(joins.outKind, qOut) : {};
  const layer = { ...outStyle, ...inStyle, transform: [inStyle.transform, outStyle.transform].filter(Boolean).join(" ") || undefined };
  const dipInAmount = joins.dipIn ? 1 - ramp(local / (joins.dipIn.duration / 2)) : 0;
  const dipOutAmount = joins.dipOut ? ramp((local - (duration - joins.dipOut.duration / 2)) / (joins.dipOut.duration / 2)) : 0;
  const audioIn = joins.crossIn ? ramp(local / joins.crossIn) : joins.dipIn ? 1 - dipInAmount : 1;
  const audioOut = joins.crossOut ? ramp((duration - local) / joins.crossOut) : joins.dipOut ? 1 - dipOutAmount : 1;
  // The pose at this moment: transform, keyframes and in/out animations (lib/animate = render.pose_filters).
  // Same order as the export: flip and scale, rotate, then move (CSS applies right to left).
  const pose = raw ? null : poseAt(clip, local);
  const flipX = clip.transform?.flip_h ? -1 : 1;
  const flipY = clip.transform?.flip_v ? -1 : 1;
  const placed =
    pose && (pose.x || pose.y || pose.rotation || pose.scale !== 1 || flipX < 0 || flipY < 0)
      ? `translate(${pose.x * 100}%, ${pose.y * 100}%) rotate(${pose.rotation}deg) scale(${pose.scale * flipX}, ${pose.scale * flipY})`
      : undefined;
  const zoom = clip.zoom ? clip.zoom.start + (clip.zoom.end - clip.zoom.start) * Math.min(local / Math.max(duration, 1e-3), 1) : 1;

  // Cut the edges (crop_rect), cover-fit what is left into the output frame, then pan to the crop center
  // inside it (mirrors render.cut_edges + crop_filter()).
  const [ex, ey, ew, eh] = cropWindow(raw ? null : clip.crop_rect, media.width, media.height);
  const fitted = clip.fit === "fit" && !raw;
  // Fill: cover the frame and pan. Fit: the whole picture, centered (render.fit_size), over a backdrop.
  const [fw, fh] = fitSize(ew, eh, W, H);
  const scale = fitted ? fw / ew : Math.max(W / ew, H / eh);
  const vw = media.width * scale;
  const vh = media.height * scale;
  const { cx, cy } = cropAt(clip.crop, frame / fps);
  const left = fitted
    ? Math.floor((W - fw) / 2) - ex * scale
    : Math.min(-ex * scale, Math.max(W - (ex + ew) * scale, W / 2 - cx * vw));
  const top = fitted
    ? Math.floor((H - fh) / 2) - ey * scale
    : Math.min(-ey * scale, Math.max(H - (ey + eh) * scale, H / 2 - cy * vh));
  // The backdrop of a fitted clip: the same picture covering the frame, centered, then blurred.
  const cover = Math.max(W / ew, H / eh);
  // The source moment on screen (for tracked boxes); a reversed clip runs from its out point back.
  const t = clip.reverse && !raw ? clip.src_out - local * clip.speed : clip.src_in + local * clip.speed;
  const filterId = `grade-${clip.id}`;
  // Source-normalized box -> output pixels, through the same cover + pan as the video itself.
  const place: Place = (b) => ({ left: left + b[0] * vw, top: top + b[1] * vh, width: (b[2] - b[0]) * vw, height: (b[3] - b[1]) * vh });
  // Overlay only the tracks this clip uses; with none in use yet, the newest track for its media.
  const used = new Set([clip.follow?.track_id, ...clip.effects.map((e) => e.track_id)].filter(Boolean));
  const forMedia = Object.values(tracks).filter((tr) => tr.media_id === clip.media_id);
  const mediaTracks = used.size ? forMedia.filter((tr) => used.has(tr.id)) : forMedia.slice(-1);
  const kept = new Set(clip.effects.flatMap((e) => (e.kind === "blur" ? e.exclude_ids.map((o) => `${e.track_id}:${o}`) : [])));

  const audible = !clip.muted && clip.speed === 1 && clip.volume > 0;
  // The clip's own sound fades (render: afade with the longest of these, a dip, or 20 ms).
  const soundFade =
    (clip.audio_fade_in ? ramp(local / clip.audio_fade_in) : 1) * (clip.audio_fade_out ? ramp((duration - local) / clip.audio_fade_out) : 1);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000", ...layer, WebkitMaskImage: layer.maskImage }}>
     <AbsoluteFill style={{ transform: placed, opacity: pose && pose.opacity < 1 ? pose.opacity : undefined }}>
     <AbsoluteFill style={{ overflow: "hidden", transform: zoom !== 1 ? `scale(${zoom})` : undefined }}>
      {fitted && clip.backdrop.kind === "color" && <AbsoluteFill style={{ background: clip.backdrop.color }} />}
      {fitted && clip.backdrop.kind === "blur" && (
        <Video
          src={fileUrl(src)}
          trimBefore={Math.round(startAt * fps)}
          playbackRate={clip.speed}
          muted
          objectFit="fill"
          style={{
            position: "absolute",
            left: (W - ew * cover) / 2 - ex * cover,
            top: (H - eh * cover) / 2 - ey * cover,
            width: media.width * cover,
            height: media.height * cover,
            // Like ffmpeg's gblur, CSS blur darkens toward the frame's edges (both blur in black from outside).
            filter: `${isIdentity(clip.grade) ? "" : `url(#${filterId}) `}blur(${clip.backdrop.blur * H}px)`,
          }}
        />
      )}
      <Video
        src={fileUrl(src)}
        trimBefore={Math.round(startAt * fps)}
        playbackRate={clip.speed}
        muted={!audible}
        volume={audible ? clip.volume * volumeAt(clip.volume_keys, local) * audioIn * audioOut * soundFade : 0}
        objectFit="fill"
        style={{
          position: "absolute", left, top, width: vw, height: vh,
          filter: isIdentity(clip.grade) ? undefined : `url(#${filterId})`,
          // A fitted clip shows only its window (crop_rect); a filled one is clipped by the frame itself.
          clipPath: fitted ? `inset(${ey * scale}px ${(media.width - ex - ew) * scale}px ${(media.height - ey - eh) * scale}px ${ex * scale}px)` : undefined,
        }}
      />
      {!isIdentity(clip.grade) && <GradeFilter id={filterId} grade={clip.grade} />}
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
     </AbsoluteFill>
      {preparing && (
        <span style={{ position: "absolute", top: H * 0.03, left: W * 0.03, padding: `${H * 0.006}px ${H * 0.012}px`, borderRadius: H * 0.01,
          background: "rgba(0,0,0,0.6)", color: "#fff", font: `600 ${Math.round(H * 0.022)}px Montserrat, sans-serif` }}>
          Preparing {clip.reverse ? "reverse" : "LUT"} preview...
        </span>
      )}
      {/* After zoom and transform, over the whole frame, as the export multiplies it in. */}
      {clip.grade.vignette > 0 && <Vignette grade={clip.grade} />}
      {joins.dipIn && dipInAmount > 0 && (
        <AbsoluteFill style={{ background: joins.dipIn.kind === "dip_black" ? "#000" : "#fff", opacity: dipInAmount }} />
      )}
      {joins.dipOut && dipOutAmount > 0 && (
        <AbsoluteFill style={{ background: joins.dipOut.kind === "dip_black" ? "#000" : "#fff", opacity: dipOutAmount }} />
      )}
    </AbsoluteFill>
  );
}

// Overlay.blend -> CSS; render.BLEND uses ffmpeg's modes of the same name ("addition" for add).
const BLEND_CSS: Record<Overlay["blend"], React.CSSProperties["mixBlendMode"]> = {
  normal: "normal", screen: "screen", multiply: "multiply", overlay: "overlay", lighten: "lighten", darken: "darken", add: "plus-lighter",
};

function OverlayLayer({ item, media }: { item: Overlay; media: MediaView }) {
  const { fps, width: W, height: H } = useVideoConfig();
  const [x, y, w, h] = overlayRect(item, W, H);
  // Cover-fit, centered: the same window crop_filter takes without crop keys.
  const scale = Math.max(w / media.width, h / media.height);
  const vw = media.width * scale;
  const vh = media.height * scale;
  const filterId = `grade-${item.id}`;
  return (
    <div
      data-overlay-id={item.id}
      style={{
        position: "absolute", left: x, top: y, width: w, height: h, overflow: "hidden",
        opacity: item.opacity, mixBlendMode: BLEND_CSS[item.blend],
      }}
    >
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

export function TimelineComposition({ timeline, media, tracks, showTracks, raw, speech, clipPreviews = {} }: CompositionProps) {
  const { fps } = useVideoConfig();
  const starts = clipStarts(timeline.clips);
  const total = timelineDuration(timeline.clips);
  return (
    <AbsoluteFill style={{ backgroundColor: "#09090b" }}>
      {/* Absolute placement (not a Series) so crossfading clips can overlap; later clips draw on top. */}
      {timeline.clips.map((clip, i) => {
        const m = media[clip.media_id];
        const next = timeline.clips[i + 1];
        const into = i > 0 && overlaps(clip.transition) ? clip.transition : null;
        const outOf = overlaps(next?.transition) ? next!.transition! : null;
        const joins: Joins = {
          crossIn: into?.duration ?? 0,
          crossOut: outOf?.duration ?? 0,
          inKind: into?.kind ?? null,
          outKind: outOf?.kind ?? null,
          dipIn: clip.transition && !overlaps(clip.transition) ? clip.transition : null,
          dipOut: next?.transition && !overlaps(next.transition) ? next.transition : null,
        };
        return (
          <Sequence
            key={clip.id}
            name={clip.id}
            from={Math.round(starts[i] * fps)}
            durationInFrames={toFrames(clipDuration(clip), fps)}
            premountFor={fps}
          >
            {m ? (
              <ClipLayer clip={clip} media={m} tracks={tracks} showTracks={showTracks && !raw} raw={raw} joins={joins} variant={clipPreviews[clip.id]} />
            ) : null}
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
