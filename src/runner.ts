import { Agent, CursorAgentError, type Run, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import type { WorkflowDetail } from "./types.js";

export type UiEvent =
  | { type: "step"; workflowId: string; index: number; title: string }
  | { type: "run"; workflowId: string; runId: string; agentId: string }
  | { type: "text"; workflowId: string; text: string }
  | { type: "tool"; workflowId: string; callId: string; name: string; status: string }
  | { type: "done"; workflowId: string; status: string; text?: string }
  | { type: "error"; workflowId: string; phase: "startup" | "run"; message: string };

type Sink = (event: UiEvent) => void;

interface Session {
  agent: SDKAgent;
  run: Run | null;
  busy: boolean;
}

export class WorkflowRunner {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly apiKey: string,
    private readonly sink: Sink,
  ) {}

  async runSteps(workflow: WorkflowDetail): Promise<void> {
    for (let index = 0; index < workflow.steps.length; index += 1) {
      const step = workflow.steps[index];
      this.sink({ type: "step", workflowId: workflow.id, index, title: step.title });
      const status = await this.send(workflow, step.prompt);
      if (status !== "finished") return;
    }
  }

  async send(workflow: WorkflowDetail, prompt: string): Promise<"finished" | "error" | "cancelled" | "startup"> {
    let session: Session;
    try {
      session = await this.sessionFor(workflow);
    } catch (err) {
      if (err instanceof CursorAgentError) {
        this.sink({
          type: "error",
          workflowId: workflow.id,
          phase: "startup",
          message: `${err.message} (retryable=${err.isRetryable})`,
        });
        return "startup";
      }
      throw err;
    }
    if (session.busy) {
      throw new Error("This workflow already has a run in progress.");
    }

    session.busy = true;
    let streamedText = false;
    try {
      const run = await session.agent.send(prompt);
      session.run = run;
      this.sink({
        type: "run",
        workflowId: workflow.id,
        runId: run.id,
        agentId: session.agent.agentId,
      });

      if (run.supports("stream")) {
        for await (const event of run.stream()) {
          if (this.emitMessage(workflow.id, event)) streamedText = true;
        }
      }

      const result = await run.wait();
      if (result.status === "error") {
        this.sink({
          type: "error",
          workflowId: workflow.id,
          phase: "run",
          message: result.error?.message ?? `Run ${result.id} failed.`,
        });
        return "error";
      }

      this.sink({
        type: "done",
        workflowId: workflow.id,
        status: result.status,
        text: streamedText ? undefined : result.result,
      });
      return result.status;
    } catch (err) {
      if (err instanceof CursorAgentError) {
        this.sink({
          type: "error",
          workflowId: workflow.id,
          phase: "startup",
          message: `${err.message} (retryable=${err.isRetryable})`,
        });
        return "startup";
      }
      throw err;
    } finally {
      session.busy = false;
      session.run = null;
    }
  }

  async cancel(workflowId: string): Promise<void> {
    const session = this.sessions.get(workflowId);
    if (session?.run?.supports("cancel")) {
      await session.run.cancel();
    }
  }

  async reset(workflowId: string): Promise<void> {
    const session = this.sessions.get(workflowId);
    if (!session) return;
    if (session.busy) {
      throw new Error("Wait for the current run to finish.");
    }
    await session.agent[Symbol.asyncDispose]();
    this.sessions.delete(workflowId);
  }

  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.run?.supports("cancel")) {
        await session.run.cancel().catch(() => undefined);
      }
      await session.agent[Symbol.asyncDispose]().catch(() => undefined);
    }
    this.sessions.clear();
  }

  private async sessionFor(workflow: WorkflowDetail): Promise<Session> {
    const existing = this.sessions.get(workflow.id);
    if (existing) return existing;

    const agent = await Agent.create({
      apiKey: this.apiKey,
      model: { id: "composer-2.5" },
      local: { cwd: workflow.cwd },
    });
    const session: Session = { agent, run: null, busy: false };
    this.sessions.set(workflow.id, session);
    return session;
  }

  private emitMessage(workflowId: string, event: SDKMessage): boolean {
    if (event.type === "assistant") {
      let wrote = false;
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          this.sink({ type: "text", workflowId, text: block.text });
          wrote = true;
        }
      }
      return wrote;
    }
    if (event.type === "tool_call") {
      this.sink({
        type: "tool",
        workflowId,
        callId: event.call_id,
        name: event.name,
        status: event.status,
      });
    }
    return false;
  }
}
