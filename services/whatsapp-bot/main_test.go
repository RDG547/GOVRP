package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSupabaseHelpCommand(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/rest/v1/rpc/bot_whatsapp_command" {
			t.Errorf("unexpected RPC request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("apikey") != "test-key" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("RPC is missing its server authentication headers")
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("invalid RPC payload: %v", err)
		}
		if payload["p_command"] != "ajuda" {
			t.Errorf("unexpected command: %q", payload["p_command"])
		}
		_ = json.NewEncoder(w).Encode("Comandos: !ajuda, !noticias")
	}))
	defer server.Close()

	api := &API{base: server.URL, key: "test-key", http: server.Client()}
	var reply string
	if err := api.rpc(context.Background(), "bot_whatsapp_command", map[string]string{"p_command": "ajuda"}, &reply); err != nil {
		t.Fatal(err)
	}
	if reply != "Comandos: !ajuda, !noticias" {
		t.Errorf("unexpected reply: %q", reply)
	}
}
