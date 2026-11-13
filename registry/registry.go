// Package registry is the workflow registry. A workflow package calls
// Register from init. The daemon loads those packages and lists them.
package registry

import (
	"fmt"
	"sort"
)

// Step is one visible agent step. The window runs these in order.
type Step struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
}

// Workflow is one registered Go package.
type Workflow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Steps       []Step `json:"steps"`
}

var byID = map[string]Workflow{}

// Register adds a workflow. init calls this. A duplicate id panics so a bad
// package fails the load instead of silently replacing another workflow.
func Register(workflow Workflow) {
	if workflow.ID == "" || workflow.Name == "" {
		panic("registry: workflow id and name are required")
	}
	if len(workflow.Steps) == 0 {
		panic("registry: workflow " + workflow.ID + " needs at least one step")
	}
	for i, step := range workflow.Steps {
		if step.Title == "" || step.Prompt == "" {
			panic(fmt.Sprintf("registry: workflow %s step %d needs a title and prompt", workflow.ID, i+1))
		}
	}
	if _, exists := byID[workflow.ID]; exists {
		panic("registry: duplicate workflow " + workflow.ID)
	}
	byID[workflow.ID] = workflow
}

// List returns the registered workflows, sorted by name.
func List() []Workflow {
	out := make([]Workflow, 0, len(byID))
	for _, workflow := range byID {
		out = append(out, workflow)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == out[j].Name {
			return out[i].ID < out[j].ID
		}
		return out[i].Name < out[j].Name
	})
	return out
}
