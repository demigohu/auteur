"use client";

import { DeviceMobile, LinkSimple, Microphone, Sparkle, X } from "@phosphor-icons/react";
import { VOICE_LANGUAGES, VOICES } from "@/lib/media";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";

/** Under the media bin's upload button: import from a direct link, or upload from a phone via QR. */
export function MoreSources({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [open, setOpen] = useState<"link" | "phone" | "generate" | "voice" | null>(null);
  return (
    <div className="space-y-2">
      <SourceButton label="Generate a picture with Muse Image" active={open === "generate"} disabled={disabled} onClick={() => setOpen(open === "generate" ? null : "generate")}>
        <Sparkle size={13} weight="bold" /> Generate a picture
      </SourceButton>
      <SourceButton label="Speak a text with Meta MMS-TTS" active={open === "voice"} disabled={disabled} onClick={() => setOpen(open === "voice" ? null : "voice")}>
        <Microphone size={13} weight="bold" /> Voice-over from text
      </SourceButton>
      <div className="grid grid-cols-2 gap-2">
        <SourceButton label="Import from a link" active={open === "link"} disabled={disabled} onClick={() => setOpen(open === "link" ? null : "link")}>
          <LinkSimple size={13} weight="bold" /> Link
        </SourceButton>
        <SourceButton label="Upload from your phone" active={open === "phone"} onClick={() => setOpen(open === "phone" ? null : "phone")}>
          <DeviceMobile size={13} weight="bold" /> Phone
        </SourceButton>
      </div>
      <AnimatePresence initial={false}>
        {open === "link" && <LinkForm key="link" onDone={() => setOpen(null)} />}
        {open === "generate" && <GenerateForm key="generate" onDone={() => setOpen(null)} />}
        {open === "voice" && <VoiceForm key="voice" onDone={() => setOpen(null)} />}
        {open === "phone" && <PhoneCode key="phone" projectId={projectId} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  );
}

function SourceButton(props: { label: string; active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.active}
      className={`flex items-center justify-center gap-1.5 rounded-full border-2 px-2 py-1.5 text-[11px] font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
        props.active ? "border-edge bg-text text-bg" : "border-line text-muted hover:border-line-strong hover:text-text"
      }`}
    >
      {props.children}
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      // The bin is short; bring the opened panel into view.
      onAnimationComplete={() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
      className="overflow-hidden"
    >
      <div className="rounded-[12px] border-2 border-edge bg-card p-2.5 text-card-text">{children}</div>
    </motion.div>
  );
}

function LinkForm({ onDone }: { onDone: () => void }) {
  const importLink = useEditor((s) => s.importLink);
  const pending = useEditor((s) => s.pending);
  const [url, setUrl] = useState("");
  const busy = pending === "Importing from link";
  return (
    <Panel>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (url.trim() && (await importLink(url.trim()))) {
            setUrl("");
            onDone();
          }
        }}
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          required
          placeholder="https://.../clip.mp4"
          aria-label="Link to a video, song or picture"
          className="w-full rounded-[8px] border-2 border-line bg-transparent px-2 py-1.5 font-mono text-[11px] placeholder:text-faint focus:border-text focus:outline-none"
        />
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
          A direct file link, like the download link on Pexels or Pixabay. Pages such as YouTube don&apos;t work.
        </p>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="mt-2 w-full rounded-full border-2 border-ink bg-lime py-1 text-[12px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? "Importing..." : "Import"}
        </button>
      </form>
    </Panel>
  );
}

function GenerateForm({ onDone }: { onDone: () => void }) {
  const generateImage = useEditor((s) => s.generateImage);
  const pending = useEditor((s) => s.pending);
  const aspect = useEditor((s) => s.project?.timeline.aspect);
  const [prompt, setPrompt] = useState("");
  const busy = pending === "Generating with Muse Image";
  return (
    <Panel>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (prompt.trim() && (await generateImage(prompt.trim()))) {
            setPrompt("");
            onDone();
          }
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
          rows={3}
          maxLength={2000}
          placeholder="A misty pine forest at dawn, cinematic, wide shot"
          aria-label="Describe the picture"
          className="w-full resize-none rounded-[8px] border-2 border-line bg-transparent px-2 py-1.5 text-[12px] placeholder:text-faint focus:border-text focus:outline-none"
        />
        <p className="mt-1 text-[10.5px] text-faint">Muse Image, {aspect} like the project, $0.01. It lands in the bin as a picture.</p>
        <button
          type="submit"
          disabled={busy || prompt.trim().length < 3}
          className="mt-2 w-full rounded-full border-2 border-ink bg-lime py-1 text-[12px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? "Generating (about 10 s)..." : "Generate"}
        </button>
      </form>
    </Panel>
  );
}

function VoiceForm({ onDone }: { onDone: () => void }) {
  const voiceover = useEditor((s) => s.voiceover);
  const pending = useEditor((s) => s.pending);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("English");
  const [voice, setVoice] = useState<string>("natural");
  const [speed, setSpeed] = useState(1);
  const [atPlayhead, setAtPlayhead] = useState(true);
  const busy = pending === "Speaking with MMS-TTS";
  const select = "min-w-0 rounded-[8px] border-2 border-line bg-transparent px-1.5 py-1 text-[11px] focus:border-text focus:outline-none";
  return (
    <Panel>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await voiceover({ text: text.trim(), language, voice, speed, atPlayhead }))) {
            setText("");
            onDone();
          }
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={3} maxLength={2000}
          placeholder="Welcome back. Today we're heading to the coast." aria-label="Text to speak"
          className="w-full resize-none rounded-[8px] border-2 border-line bg-transparent px-2 py-1.5 text-[12px] placeholder:text-faint focus:border-text focus:outline-none" />
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" className={select}>
            {VOICE_LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice" className={select}>
            {VOICES.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" className={select}>
            {[0.8, 0.9, 1, 1.1, 1.25].map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={atPlayhead} onChange={(e) => setAtPlayhead(e.target.checked)} /> Put it on the timeline at the playhead
        </label>
        <p className="mt-1 text-[10.5px] text-faint">Meta MMS-TTS on this server. The first use of a language downloads its voice (~30 s).</p>
        <button type="submit" disabled={busy || !text.trim()}
          className="mt-2 w-full rounded-full border-2 border-ink bg-lime py-1 text-[12px] font-semibold text-ink disabled:opacity-40">
          {busy ? "Speaking..." : "Make voice-over"}
        </button>
      </form>
    </Panel>
  );
}

function PhoneCode({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/p/${projectId}/upload`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#141414", light: "#ffffff" } }).then(setQr, () => setQr(null));
  }, [url]);
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(typeof window === "undefined" ? "" : window.location.hostname);
  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px] leading-snug">Scan with your phone, sign in, and pick videos or photos. They appear here as they finish.</p>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-raised">
          <X size={11} weight="bold" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
      {qr && <img src={qr} alt="QR code to upload from your phone" width={160} height={160} className="mx-auto mt-2 rounded-[8px]" />}
      <p className="mt-1.5 truncate text-center font-mono text-[10px] text-faint">{url}</p>
      {local && (
        <p className="mt-1.5 rounded-[8px] bg-sun/30 px-2 py-1 text-[10.5px] leading-snug">
          This address only works on this computer. Open the editor through your network address (or the deployed site) so the
          phone can reach it.
        </p>
      )}
    </Panel>
  );
}
