// Command daemon serves the workflow registry on localhost.
// Workflow packages under workflows/ register themselves from init.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	host = "127.0.0.1"
	port = "47321"
)

var packageName = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

type step struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
}

type summary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ImportPath  string `json:"importPath"`
	Steps       []step `json:"steps"`
}

type detail struct {
	summary
	Cwd string `json:"cwd"`
}

type problem struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

type catalog struct {
	Workflows []summary `json:"workflows"`
	Problems  []problem `json:"problems"`
}

type registeredWorkflow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Steps       []step `json:"steps"`
}

type inspectPayload struct {
	Workflows []registeredWorkflow `json:"workflows"`
}

type cache struct {
	mu          sync.Mutex
	fingerprint string
	value       catalog
}

func main() {
	root, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	state := &cache{}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /workflows", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, state.current(root))
	})
	mux.HandleFunc("GET /workflows/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		for _, workflow := range state.current(root).Workflows {
			if workflow.ID == id {
				writeJSON(w, http.StatusOK, detail{
					summary: workflow,
					Cwd:     filepath.Join(root, "workflows", id),
				})
				return
			}
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Unknown workflow."})
	})

	addr := host + ":" + port
	fmt.Println("workflow daemon listening on http://" + addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func (c *cache) current(root string) catalog {
	c.mu.Lock()
	defer c.mu.Unlock()

	fingerprint, ids, problems := scan(root)
	if fingerprint == c.fingerprint && c.value.Workflows != nil {
		return c.value
	}

	if problems == nil {
		problems = []problem{}
	}
	next := catalog{Workflows: []summary{}, Problems: problems}
	if err := writeImports(root, ids); err != nil {
		next.Problems = append(next.Problems, problem{ID: "registry", Message: err.Error()})
		c.fingerprint = fingerprint
		c.value = next
		return next
	}

	registered, err := runInspect(root)
	if err != nil {
		next.Problems = append(next.Problems, problem{ID: "registry", Message: err.Error()})
		c.fingerprint = fingerprint
		c.value = next
		return next
	}

	seen := map[string]bool{}
	for _, workflow := range registered.Workflows {
		seen[workflow.ID] = true
		if !contains(ids, workflow.ID) {
			next.Problems = append(next.Problems, problem{
				ID:      workflow.ID,
				Message: "Registered id does not match a workflow package folder.",
			})
			continue
		}
		steps := workflow.Steps
		if steps == nil {
			steps = []step{}
		}
		next.Workflows = append(next.Workflows, summary{
			ID:          workflow.ID,
			Name:        workflow.Name,
			Description: workflow.Description,
			ImportPath:  "cursor-workflows/workflows/" + workflow.ID,
			Steps:       steps,
		})
	}
	for _, id := range ids {
		if !seen[id] {
			next.Problems = append(next.Problems, problem{
				ID:      id,
				Message: "Package did not call registry.Register.",
			})
		}
	}
	sort.Slice(next.Workflows, func(i, j int) bool {
		return next.Workflows[i].Name < next.Workflows[j].Name
	})
	c.fingerprint = fingerprint
	c.value = next
	return next
}

func scan(root string) (string, []string, []problem) {
	dir := filepath.Join(root, "workflows")
	entries, err := os.ReadDir(dir)
	hash := sha256.New()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil, nil
		}
		return "", nil, []problem{{ID: "workflows", Message: err.Error()}}
	}

	var ids []string
	var problems []problem
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		_, _ = io.WriteString(hash, name)
		if !packageName.MatchString(name) {
			problems = append(problems, problem{
				ID:      name,
				Message: "Folder name must be a Go package name: a lowercase letter, then lowercase letters, digits, or underscores.",
			})
			continue
		}
		goFiles := 0
		_ = filepath.WalkDir(filepath.Join(dir, name), func(path string, info os.DirEntry, walkErr error) error {
			if walkErr != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			goFiles++
			file, openErr := os.Open(path)
			if openErr != nil {
				return nil
			}
			defer file.Close()
			_, _ = io.WriteString(hash, path)
			_, _ = io.Copy(hash, file)
			return nil
		})
		if goFiles == 0 {
			problems = append(problems, problem{ID: name, Message: "Package has no Go files."})
			continue
		}
		ids = append(ids, name)
	}
	sort.Strings(ids)
	return fmt.Sprintf("%x", hash.Sum(nil)), ids, problems
}

func writeImports(root string, ids []string) error {
	var builder strings.Builder
	builder.WriteString("// Code generated by the workflow daemon. DO NOT EDIT.\npackage main\n")
	if len(ids) > 0 {
		builder.WriteString("\nimport (\n")
		for _, id := range ids {
			fmt.Fprintf(&builder, "\t_ \"cursor-workflows/workflows/%s\"\n", id)
		}
		builder.WriteString(")\n")
	}
	path := filepath.Join(root, "cmd", "inspect", "imports_gen.go")
	return os.WriteFile(path, []byte(builder.String()), 0o644)
}

func runInspect(root string) (inspectPayload, error) {
	cmd := exec.Command("go", "run", "./cmd/inspect")
	cmd.Dir = root
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		message := err.Error()
		var exit *exec.ExitError
		if errors.As(err, &exit) && len(exit.Stderr) > 0 {
			message = trim(string(exit.Stderr))
		}
		return inspectPayload{}, errors.New(message)
	}
	var payload inspectPayload
	if err := json.Unmarshal(out, &payload); err != nil {
		return inspectPayload{}, fmt.Errorf("inspect returned %s", trim(string(out)))
	}
	if payload.Workflows == nil {
		payload.Workflows = []registeredWorkflow{}
	}
	return payload, nil
}

func contains(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

func trim(message string) string {
	message = strings.TrimSpace(message)
	if len(message) > 800 {
		return message[:800]
	}
	return message
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}
