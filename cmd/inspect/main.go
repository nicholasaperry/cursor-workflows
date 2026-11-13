// Command inspect blank-imports every registered workflow package and prints
// the registry as JSON. The daemon regenerates imports_gen.go, then runs this.
package main

import (
	"encoding/json"
	"os"

	"cursor-workflows/registry"
)

func main() {
	payload := struct {
		Workflows []registry.Workflow `json:"workflows"`
	}{Workflows: registry.List()}
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(payload); err != nil {
		panic(err)
	}
}
