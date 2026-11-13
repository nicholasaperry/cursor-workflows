package hello

import "cursor-workflows/registry"

func init() {
	registry.Register(registry.Workflow{
		ID:          "hello",
		Name:        "Hello",
		Description: "A two-step workflow that proves the Cursor SDK runs.",
		Steps: []registry.Step{
			{
				Title:  "Read the package",
				Prompt: "Read the Go files in this folder. Do not edit files. Say which workflow this package registers, including its id and the title of each step.",
			},
			{
				Title:  "Confirm the SDK",
				Prompt: "Reply with one sentence: the Cursor SDK finished the Hello workflow. Do not edit files.",
			},
		},
	})
}
