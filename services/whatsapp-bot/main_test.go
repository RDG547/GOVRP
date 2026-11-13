package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
 "strings"
 "go.mau.fi/whatsmeow/types"
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
 publicCommands := []string{"ajuda","noticias","economia","governo","partidos","eleicao","eleicoes","votacoes","leis","perfil"}
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


func TestElectionMentionMessage(t *testing.T) {
  a:=types.NewJID("5511999991111",types.DefaultUserServer)
  b:=types.NewJID("123456789",types.HiddenUserServer)
  group:=types.NewJID("120363555",types.GroupServer)
  msg,err:=electionMentionMessage("📢 *🗳️ Votação iniciada*",
    []types.JID{a,b,a,group})
  if err!=nil{t.Fatalf("unexpected mention error: %v",err)}
  if msg.GetConversation()!="" {t.Error("group mentions must use extendedTextMessage")}
  text:=msg.GetExtendedTextMessage().GetText()
  if !strings.Contains(text,"@5511999991111") || !strings.Contains(text,"@123456789") {
    t.Fatalf("missing visible mentions in %q",text)
  }
  ids:=msg.GetExtendedTextMessage().GetContextInfo().GetMentionedJID()
  if len(ids)!=2 || ids[0]!=a.String() || ids[1]!=b.String() {
    t.Errorf("unexpected distinct mentioned JIDs: %v",ids)
  }
  if _,err:=electionMentionMessage("election",[]types.JID{group});err==nil {
    t.Error("no valid members should be an error instead of silently failing to mention anyone")
  }
  if !isElectionNotice("📢 *🗳️ Votação iniciada*\nMensagem") ||
    isElectionNotice("📢 *Nova notícia*\nMensagem") ||
    isElectionNotice("🗳️ Votação iniciada") {
    t.Error("only dedicated election notification events should mention everyone")
  }
}

func TestSupabaseElectionDetailsCommand(t *testing.T) {
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.URL.Path!="/rest/v1/rpc/bot_whatsapp_election_command" {
    t.Errorf("unexpected RPC: %s",r.URL.Path)
  }
  var payload struct {
    Command string `json:"p_command"`
    Number *int `json:"p_number"`
  }
  if err:=json.NewDecoder(r.Body).Decode(&payload);err!=nil{t.Fatal(err)}
  if payload.Command!="eleicoes" || payload.Number==nil || *payload.Number!=3 {
    t.Errorf("unexpected election selection: %+v",payload)
  }
  _=json.NewEncoder(w).Encode("🗳️ Eleição 3")
 }))
 defer server.Close()
 api:=&API{base:server.URL,key:"test-key",http:server.Client()}
 var reply string
 if err:=api.rpc(context.Background(),"bot_whatsapp_election_command",map[string]any{
  "p_command":"eleicoes","p_number":3,
 },&reply);err!=nil{t.Fatal(err)}
 if !strings.Contains(reply,"Eleição 3"){t.Errorf("unexpected details reply %q",reply)}
}
