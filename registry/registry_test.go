package registry

import "testing"

func TestRegisterAndList(t *testing.T) {
	Register(Workflow{
		ID:          "alpha",
		Name:        "Alpha",
		Description: "first",
		Steps:       []Step{{Title: "Look", Prompt: "Look around."}},
	})
	got := List()
	if len(got) != 1 {
		t.Fatalf("len = %d", len(got))
	}
	if got[0].ID != "alpha" || got[0].Name != "Alpha" || len(got[0].Steps) != 1 {
		t.Fatalf("%#v", got[0])
	}
}
