# Cursor workflows

An agents window for workflows you choose. Each workflow is a Go package with visible steps. The window runs those steps with the Cursor SDK, one agent per workflow.

## Run the window

```bash
npm install
npm start
```

The registry listens on `127.0.0.1:47321`. The app reads `CURSOR_API_KEY` from the environment.

Open **Hello** and press **Run**. The two steps are listed in the window. The same agent runs them in order.

## Example

`workflows/hello` registers the Hello workflow:

1. Read the package.
2. Confirm the SDK finished.

## Create a workflow

This repo is a Cursor plugin. The `create-workflow` skill tells Cursor how to add a package. Put the package at `workflows/<id>/workflow.go` and call `registry.Register` from `init`. The window does not create workflows for you.

A workflow needs a name and at least one step. The folder name, the Go package name, and the workflow id match.

## Plugin

`.cursor-plugin/plugin.json` points at `skills/`. Install this repository as a local Cursor plugin, then ask Cursor to create a workflow.
