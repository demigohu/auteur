import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, CommitView, ProjectView } from "./api";

vi.mock("@clerk/nextjs", () => ({ getToken: async () => null }));

/** Stands in for the browser's EventSource so tests can push agent events. */
class FakeSource {
  static last: FakeSource | null = null;
  listeners = new Map<string, (msg: { data: string }) => void>();
  constructor() {
    FakeSource.last = this;
  }
  addEventListener(type: string, fn: (msg: { data: string }) => void) {
    this.listeners.set(type, fn);
  }
  close() {}
  emit(event: { type: string; [key: string]: unknown }) {
    this.listeners.get(event.type)?.({ data: JSON.stringify(event) });
  }
}
vi.stubGlobal("EventSource", FakeSource);

const { useEditor, isCheckStale } = await import("./store");

const commit = (id: string): CommitView => ({ id, author: "agent", label: id, run_id: null, at: "2026-11-03T00:00:00Z" }) as CommitView;

function project(over: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "proj_1", name: "Test", media: [], timeline: { clips: [] } as unknown as ProjectView["timeline"],
    history: [], chat: [], tracks: [], references: [], last_check: null, storyboard: null, speech: [], spent: 0,
    last_render_url: null, can_undo: false, can_redo: false, busy: false, ...over,
  };
}

const check = (head: string | null): CheckResult => ({
  passed: false, issues: ["x"], marks: [{ start: 1, end: 2, label: "Off frame" }], render: "r.mp4", run_id: "run_a", head, at: "",
});

describe("isCheckStale", () => {
  it("is false without a check", () => {
    expect(isCheckStale(project())).toBe(false);
  });
  it("is false while the newest commit is the one the checker saw", () => {
    expect(isCheckStale(project({ history: [commit("c1"), commit("c2")], last_check: check("c2") }))).toBe(false);
    expect(isCheckStale(project({ history: [], last_check: check(null) }))).toBe(false);
  });
  it("is true after an undo followed by a new edit, even at the same history length", () => {
    expect(isCheckStale(project({ history: [commit("c1"), commit("c3")], last_check: check("c2") }))).toBe(true);
  });
  it("is true after undoing everything", () => {
    expect(isCheckStale(project({ history: [], last_check: check("c1") }))).toBe(true);
  });
});

describe("agent events", () => {
  let source: FakeSource;
  const run = () => useEditor.getState().run!;

  beforeEach(() => {
    useEditor.setState({ project: project({ history: [commit("c1")], last_check: check("c0") }), run: null, tab: "inspector" });
    useEditor.getState().connect("proj_1");
    source = FakeSource.last!;
    source.emit({ type: "run_started", run_id: "run_a", instruction: "Make it warm", images: ["ref_1"] });
  });

  it("starts a run, opens the agent tab and clears the previous verdict", () => {
    expect(run()).toMatchObject({ id: "run_a", instruction: "Make it warm", images: ["ref_1"], status: "running" });
    expect(useEditor.getState().tab).toBe("agent");
    expect(useEditor.getState().project!.last_check).toBeNull();
  });

  it("moves through the plan as tools are called", () => {
    source.emit({ type: "plan", run_id: "run_a", steps: ["Listen", "Grade", "Render"] });
    source.emit({ type: "tool_call", run_id: "run_a", tool: "listen", args: {}, step: 0 });
    source.emit({ type: "tool_call", run_id: "run_a", tool: "grade", args: {}, step: 1 });
    expect(run().plan.map((p) => p.status)).toEqual(["done", "running", "pending"]);
  });

  it("puts a tool result on the newest unanswered call of that tool", () => {
    source.emit({ type: "tool_call", run_id: "run_a", tool: "grade", args: { look: "warm" }, step: null });
    source.emit({ type: "tool_result", run_id: "run_a", tool: "grade", ok: true, output: "first" });
    source.emit({ type: "tool_call", run_id: "run_a", tool: "grade", args: { look: "cool" }, step: null });
    source.emit({ type: "tool_result", run_id: "run_a", tool: "grade", ok: false, output: "second" });
    const tools = run().log.filter((l) => l.kind === "tool");
    expect(tools.map((t) => [t.ok, t.output])).toEqual([[true, "first"], [false, "second"]]);
  });

  it("stores the check against the current commit, and it goes stale after a later edit", () => {
    source.emit({ type: "check", run_id: "run_a", passed: false, issues: ["Off frame"], marks: [{ start: 1, end: 2, label: "Off frame" }], render: "r.mp4" });
    const p = useEditor.getState().project!;
    expect(p.last_check).toMatchObject({ run_id: "run_a", head: "c1", marks: [{ start: 1, end: 2, label: "Off frame" }] });
    expect(isCheckStale(p)).toBe(false);
    expect(run().log.at(-1)).toMatchObject({ kind: "check", passed: false });

    source.emit({ type: "timeline", run_id: "run_a", project: { ...p, history: [commit("c1"), commit("c2")] } });
    expect(isCheckStale(useEditor.getState().project!)).toBe(true);
  });

  it("finishes pending steps when the run is done", () => {
    source.emit({ type: "plan", run_id: "run_a", steps: ["Grade", "Render"] });
    source.emit({ type: "tool_call", run_id: "run_a", tool: "grade", args: {}, step: 0 });
    source.emit({ type: "run_finished", run_id: "run_a", status: "done", project: project() });
    expect(run().plan.map((p) => p.status)).toEqual(["done", "done"]);
    expect(run().status).toBe("done");
  });

  it("fails only the running step when the run errors", () => {
    source.emit({ type: "plan", run_id: "run_a", steps: ["Grade", "Render"] });
    source.emit({ type: "tool_call", run_id: "run_a", tool: "grade", args: {}, step: 0 });
    source.emit({ type: "run_finished", run_id: "run_a", status: "error", project: project() });
    expect(run().plan.map((p) => p.status)).toEqual(["failed", "pending"]);
  });

  it("tracks the run's cost and the project's total spend", () => {
    source.emit({ type: "cost", run_id: "run_a", run: 0.04, total: 0.31 });
    expect(run().cost).toBe(0.04);
    expect(useEditor.getState().project!.spent).toBe(0.31);
  });

  it("ignores events from another run", () => {
    source.emit({ type: "thought", run_id: "run_b", text: "not mine" });
    expect(run().log).toEqual([]);
  });
});
