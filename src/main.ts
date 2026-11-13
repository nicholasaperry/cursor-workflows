import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { DAEMON_URL, projectRoot } from "./paths.js";
import type { WorkflowDetail } from "./types.js";
import { WorkflowRunner, type UiEvent } from "./runner.js";

let mainWindow: BrowserWindow | null = null;
let daemonChild: ChildProcess | null = null;
let runner: WorkflowRunner | null = null;

function apiKey(): string | undefined {
  const value = process.env.CURSOR_API_KEY?.trim();
  return value ? value : undefined;
}

function emit(event: UiEvent): void {
  mainWindow?.webContents.send("workflow:event", event);
}

function runnerFor(): WorkflowRunner {
  const key = apiKey();
  if (!key) {
    throw new Error("CURSOR_API_KEY is not set.");
  }
  if (!runner) {
    runner = new WorkflowRunner(key, emit);
  }
  return runner;
}

async function daemonHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDaemon(): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await daemonHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureDaemon(): Promise<boolean> {
  if (await daemonHealthy()) return true;
  const child = spawn("go", ["run", "./cmd/daemon"], {
    cwd: projectRoot(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  daemonChild = child;
  child.on("exit", () => {
    if (daemonChild === child) daemonChild = null;
  });
  return waitForDaemon();
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${DAEMON_URL}${pathname}`);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Daemon returned ${response.status}.`);
  }
  return body;
}

async function loadWorkflow(id: string): Promise<WorkflowDetail> {
  if (!(await daemonHealthy())) {
    throw new Error("The workflow daemon is not running.");
  }
  return fetchJson<WorkflowDetail>(`/workflows/${encodeURIComponent(id)}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    x: 80,
    y: 80,
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: "Cursor workflows",
    autoHideMenuBar: true,
    backgroundColor: "#161411",
    webPreferences: {
      preload: path.join(projectRoot(), "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadFile(path.join(projectRoot(), "renderer", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("app:status", async () => ({
    daemon: await daemonHealthy(),
    hasApiKey: Boolean(apiKey()),
  }));

  ipcMain.handle("workflows:list", async () => {
    if (!(await ensureDaemon())) {
      throw new Error("Could not start the workflow daemon.");
    }
    return fetchJson("/workflows");
  });

  ipcMain.handle("workflows:get", async (_event, id: string) => loadWorkflow(id));

  ipcMain.handle("workflows:run", async (_event, id: string) => {
    const workflow = await loadWorkflow(id);
    await runnerFor().runSteps(workflow);
  });

  ipcMain.handle("workflows:send", async (_event, id: string, prompt: string) => {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("Write a message first.");
    }
    const workflow = await loadWorkflow(id);
    await runnerFor().send(workflow, prompt);
  });

  ipcMain.handle("workflows:cancel", async (_event, id: string) => {
    await runner?.cancel(id);
  });

  ipcMain.handle("workflows:reset", async (_event, id: string) => {
    await runner?.reset(id);
  });

  void ensureDaemon().finally(createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    await Promise.race([
      runner?.dispose() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    daemonChild?.kill();
    app.quit();
  })();
});
