"use client";

import { motion } from "motion/react";
import { type SideTab, useEditor } from "@/lib/store";
import { AgentTab } from "./AgentTab";
import { HistoryTab } from "./HistoryTab";
import { InspectorTab } from "./InspectorTab";
import { StoryboardTab } from "./StoryboardTab";
import { TranscriptTab } from "./TranscriptTab";

const TABS = [
  { id: "agent", label: "Agent" },
  { id: "story", label: "Story" },
  { id: "words", label: "Words" },
  { id: "inspector", label: "Inspector" },
  { id: "history", label: "History" },
] as const satisfies readonly { id: SideTab; label: string }[];

export function SidePanel() {
  const tab = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const runStatus = useEditor((s) => s.run?.status);

  return (
    <aside className="flex min-h-0 flex-col border-l-2 border-edge bg-panel">
      <div role="tablist" className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b-2 border-edge px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`label relative shrink-0 rounded-full px-2.5 py-1.5 transition-colors ${tab === t.id ? "text-ink" : "text-muted hover:text-text"}`}
          >
            {tab === t.id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full border-2 border-ink bg-lime" />}
            <span className="relative">{t.label}</span>
            {t.id === (tab === "story" ? "story" : "agent") && runStatus === "running" && (
              <span className="relative ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-tomato align-middle" aria-label="The agent is working" />
            )}
          </button>
        ))}
      </div>
      {tab === "agent" && <AgentTab />}
      {tab === "story" && <StoryboardTab />}
      {tab === "words" && <TranscriptTab />}
      {tab === "inspector" && <InspectorTab />}
      {tab === "history" && <HistoryTab />}
    </aside>
  );
}
