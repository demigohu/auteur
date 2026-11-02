"use client";

import { motion } from "motion/react";
import { type SideTab, useEditor } from "@/lib/store";
import { AgentTab } from "./AgentTab";
import { HistoryTab } from "./HistoryTab";
import { InspectorTab } from "./InspectorTab";

const TABS = [
  { id: "agent", label: "Agen" },
  { id: "inspector", label: "Inspector" },
  { id: "history", label: "Riwayat" },
] as const satisfies readonly { id: SideTab; label: string }[];

export function SidePanel() {
  const tab = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const runStatus = useEditor((s) => s.run?.status);

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
      <div role="tablist" className="flex h-10 shrink-0 items-end gap-4 border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`relative pb-2.5 text-[13px] transition-colors ${tab === t.id ? "text-text" : "text-muted hover:text-text"}`}
          >
            {t.label}
            {t.id === "agent" && runStatus === "running" && (
              <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent align-middle" aria-label="Agen sedang bekerja" />
            )}
            {tab === t.id && (
              <motion.span layoutId="tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>
      {tab === "agent" && <AgentTab />}
      {tab === "inspector" && <InspectorTab />}
      {tab === "history" && <HistoryTab />}
    </aside>
  );
}
