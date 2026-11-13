const listEl = document.querySelector("#list");
const noneEl = document.querySelector("#none");
const problemsEl = document.querySelector("#problems");
const emptyEl = document.querySelector("#empty");
const emptyTitleEl = document.querySelector("#empty-title");
const emptyCopyEl = document.querySelector("#empty-copy");
const detailEl = document.querySelector("#detail");
const titleEl = document.querySelector("#title");
const descriptionEl = document.querySelector("#description");
const metaEl = document.querySelector("#meta");
const stepsEl = document.querySelector("#steps");
const runButton = document.querySelector("#run");
const transcriptEl = document.querySelector("#transcript");
const promptEl = document.querySelector("#prompt");
const resetButton = document.querySelector("#reset");
const cancelButton = document.querySelector("#cancel");
const composer = document.querySelector("#composer");
const sendButton = composer.querySelector("button");
const statusEl = document.querySelector("#status");

const api = window.workflows;
const transcripts = new Map();
let selectedId = null;
let current = null;
let busy = false;
let hasApiKey = false;
let agentText = null;

function setBusy(next) {
  busy = next;
  runButton.disabled = next || !hasApiKey;
  resetButton.disabled = next;
  promptEl.disabled = next || !hasApiKey;
  sendButton.disabled = next || !hasApiKey;
  cancelButton.hidden = !next;
}

function addBubble(className, text) {
  const node = document.createElement("div");
  node.className = `bubble ${className}`;
  node.textContent = text;
  transcriptEl.append(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return node;
}

function remember(node) {
  const items = transcripts.get(selectedId) ?? [];
  items.push({ className: node.className.replace("bubble ", ""), text: node.textContent });
  transcripts.set(selectedId, items);
}

function showTranscript(id) {
  transcriptEl.replaceChildren();
  agentText = null;
  for (const item of transcripts.get(id) ?? []) {
    const node = addBubble(item.className, item.text);
    if (item.className === "agent") agentText = node;
  }
}

async function refreshStatus() {
  const status = await api.status();
  hasApiKey = status.hasApiKey;
  statusEl.textContent = [
    status.daemon ? "Registry on 127.0.0.1:47321" : "Registry offline",
    status.hasApiKey ? "CURSOR_API_KEY is set" : "CURSOR_API_KEY is missing",
  ].join(" · ");
  if (current) setBusy(busy);
}

async function refreshList() {
  const catalog = await api.list();
  const workflows = catalog.workflows ?? [];
  listEl.replaceChildren();
  noneEl.hidden = workflows.length > 0;
  if (!selectedId) {
    if (workflows.length === 0) {
      emptyTitleEl.textContent = "Nothing registered";
      emptyCopyEl.textContent = "Workflows are Go packages. Each one calls registry.Register from init. This list stays empty until a package is registered.";
    } else {
      emptyTitleEl.textContent = "Select a workflow";
      emptyCopyEl.textContent = "Open a workflow to see its steps. Run walks those steps with the Cursor SDK.";
    }
  }
  for (const workflow of workflows) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = workflow.id;
    if (workflow.id === selectedId) button.classList.add("active");
    const name = document.createElement("strong");
    name.textContent = workflow.name;
    const count = (workflow.steps ?? []).length;
    const meta = document.createElement("span");
    meta.textContent = `${count} step${count === 1 ? "" : "s"}`;
    button.append(name, meta);
    button.addEventListener("click", () => select(workflow.id));
    item.append(button);
    listEl.append(item);
  }
  const problems = catalog.problems ?? [];
  if (problems.length > 0) {
    problemsEl.hidden = false;
    problemsEl.textContent = problems.map((problem) => `${problem.id}: ${problem.message}`).join(" ");
  } else {
    problemsEl.hidden = true;
    problemsEl.textContent = "";
  }
  if (selectedId && !workflows.some((workflow) => workflow.id === selectedId)) {
    selectedId = null;
    current = null;
    emptyEl.hidden = false;
    detailEl.hidden = true;
  }
}

async function select(id) {
  selectedId = id;
  current = await api.get(id);
  emptyEl.hidden = true;
  detailEl.hidden = false;
  titleEl.textContent = current.name;
  descriptionEl.textContent = current.description || "No description.";
  metaEl.textContent = `${current.importPath} · ${current.cwd}`;
  renderSteps(current.steps);
  showTranscript(id);
  await refreshList();
  setBusy(busy);
}

function renderSteps(steps) {
  stepsEl.replaceChildren();
  for (const [index, step] of (steps ?? []).entries()) {
    const item = document.createElement("li");
    item.dataset.index = String(index);
    item.textContent = `${index + 1}. ${step.title}`;
    stepsEl.append(item);
  }
}

function markStep(index) {
  for (const item of stepsEl.querySelectorAll("li")) {
    const itemIndex = Number(item.dataset.index);
    item.classList.toggle("current", itemIndex === index);
    item.classList.toggle("done", itemIndex < index);
  }
}

function appendAgentText(text) {
  if (!agentText) {
    agentText = addBubble("agent", text);
  } else {
    agentText.textContent += text;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
  const items = transcripts.get(selectedId) ?? [];
  const last = items[items.length - 1];
  if (last?.className === "agent") last.text = agentText.textContent;
  else items.push({ className: "agent", text: agentText.textContent });
  transcripts.set(selectedId, items);
}

function note(className, text) {
  const node = addBubble(className, text);
  remember(node);
  agentText = null;
}

api.onEvent((event) => {
  if (!current || event.workflowId !== current.id) {
    if (event.type === "text") {
      const items = transcripts.get(event.workflowId) ?? [];
      const last = items[items.length - 1];
      if (last?.className === "agent") last.text += event.text;
      else items.push({ className: "agent", text: event.text });
      transcripts.set(event.workflowId, items);
    }
    return;
  }
  if (event.type === "step") {
    markStep(event.index);
    note("user", `${event.index + 1}. ${event.title}`);
  } else if (event.type === "run") {
    note("tool", `agent ${event.agentId} · run ${event.runId}`);
  } else if (event.type === "text") {
    appendAgentText(event.text);
  } else if (event.type === "tool") {
    note("tool", `${event.name} · ${event.status}`);
  } else if (event.type === "done") {
    if (event.status === "finished") {
      const currentStep = stepsEl.querySelector("li.current");
      if (currentStep) {
        currentStep.classList.remove("current");
        currentStep.classList.add("done");
      }
    }
    if (event.text) note("agent", event.text);
    note("tool", event.status);
  } else if (event.type === "error") {
    note("error", `${event.phase === "startup" ? "Did not start" : "Run failed"}: ${event.message}`);
  }
});

runButton.addEventListener("click", async () => {
  if (!current || busy) return;
  setBusy(true);
  try {
    await api.run(current.id);
  } catch (err) {
    note("error", err instanceof Error ? err.message : "Run failed.");
  } finally {
    setBusy(false);
  }
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current || busy) return;
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  promptEl.value = "";
  note("user", prompt);
  setBusy(true);
  try {
    await api.send(current.id, prompt);
  } catch (err) {
    note("error", err instanceof Error ? err.message : "Send failed.");
  } finally {
    setBusy(false);
  }
});

resetButton.addEventListener("click", async () => {
  if (!current || busy) return;
  await api.reset(current.id);
  transcripts.set(current.id, []);
  showTranscript(current.id);
  renderSteps(current.steps);
});

cancelButton.addEventListener("click", async () => {
  if (!current) return;
  await api.cancel(current.id);
});

async function boot() {
  await refreshStatus();
  await refreshList();
  setInterval(() => {
    refreshList().catch((err) => {
      statusEl.textContent = err instanceof Error ? err.message : "Could not reach the registry.";
    });
  }, 2000);
}

boot().catch((err) => {
  statusEl.textContent = err instanceof Error ? err.message : "Could not open workflows.";
});
