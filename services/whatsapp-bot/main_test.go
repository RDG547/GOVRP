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


func TestBotCommandScopes(t *testing.T) {
 activeGroup := "120363111111111@g.us"
 inactiveGroup := "120363222222222@g.us"
 settings := Settings{Enabled:true,Commands:true,Prefix:"!"}
 groups := map[string]bool{activeGroup:true, inactiveGroup:false}
 publicCommands := []string{"ajuda","noticias","economia","governo","partidos","eleicoes","votacoes","leis","perfil"}
 for _,cmd := range publicCommands {
  if !commandAllowed(settings,groups,true,activeGroup,cmd) {
   t.Errorf("!%s should work in an enabled group",cmd)
  }
  if commandAllowed(settings,groups,true,inactiveGroup,cmd) {
   t.Errorf("!%s unexpectedly works in a disabled group",cmd)
  }
  if commandAllowed(settings,groups,false,"5511999999999@s.whatsapp.net",cmd) {
   t.Errorf("!%s unexpectedly works in a private chat",cmd)
  }
 }
 if !commandAllowed(settings,groups,false,"5511999999999@s.whatsapp.net","vincular") {
  t.Fatal("!vincular must remain available in private chats")
 }
 for _,cmd:=range []string{"vincular","desvincular","ajuda","economia"} {
  if commandAllowed(settings,groups,true,activeGroup,cmd) && (cmd=="vincular" || cmd=="desvincular") {
   t.Errorf("!%s is a private-only/disabled administrative command and must not work in groups",cmd)
  }
 }
 if commandAllowed(settings,groups,false,"5511999999999@s.whatsapp.net","desvincular") {
  t.Error("!desvincular must not work in private chat; the GOVRP site handles unlinking")
 }
 if commandAllowed(settings,groups,false,"5511999999999@s.whatsapp.net","unknown") {
  t.Error("unknown private command should be ignored")
 }
 noCommands:=settings
 noCommands.Commands=false
 if commandAllowed(noCommands,groups,true,activeGroup,"noticias") {t.Error("disabled commands must block group actions")}
 if !commandAllowed(noCommands,groups,false,"5511999999999@s.whatsapp.net","vincular") {t.Error("account linking should remain available when public commands are disabled")}
 off:=settings
 off.Enabled=false
 if commandAllowed(off,groups,true,activeGroup,"noticias") || commandAllowed(off,groups,false,"5511999999999@s.whatsapp.net","vincular") {
  t.Error("global pause must block both groups and private linking")
 }
 if commandAllowed(settings,groups,true,"120363333333333@g.us","noticias") {t.Error("unknown groups must be ignored")}
}
