"use client";

import { DeviceMobile, LinkSimple, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";

/** Under the media bin's upload button: import from a direct link, or upload from a phone via QR. */
export function MoreSources({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [open, setOpen] = useState<"link" | "phone" | null>(null);
  return (
    <div className="space-y-2">
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
