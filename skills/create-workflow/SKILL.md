---
name: create-workflow
description: Create a Cursor SDK workflow as a Go package with visible steps. Use when the user asks to add, scaffold, or create a workflow for the workflows window.
---

# Create a workflow

A workflow is a Go package under `workflows/<id>/`. The agents window lists packages that call `registry.Register` from `init`. It shows the steps and runs them in order. Do not add a button, form, or other graphical way to create a workflow.

## Shape

`<id>` is a Go package name: a lowercase letter, then lowercase letters, digits, or underscores. The folder name, the package clause, and `Workflow.ID` are the same value.

Write `workflows/<id>/workflow.go`:

```go
package <id>

import "cursor-workflows/registry"

func init() {
    registry.Register(registry.Workflow{
        ID:          "<id>",
        Name:        "<Name>",
        Description: "<one sentence>",
        Steps: []registry.Step{
            {Title: "<step title>", Prompt: "<what the agent should do>"},
        },
    })
}
```

## Steps

Add at least one step. Each step needs a title and a prompt. The title is what the window shows. The prompt is what the Cursor SDK agent receives for that step. Keep the prompts specific. Say when the agent must not edit files.

## Check

Run `go test ./registry/ ./workflows/<id>/`. The package must compile. The running daemon picks up the new folder on its next read. Do not edit `cmd/inspect/imports_gen.go` by hand. The daemon rewrites that file.
