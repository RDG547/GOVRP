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


func TestHelpMessageCategoriesAndAlphabeticalOrder(t *testing.T) {
 help:=helpMessage("!")
 categories:=[]string{
  "👤 *Conta e perfil*",
  "📊 *Economia e notícias*",
  "🗳️ *Eleições*",
  "🏛️ *Governo e legislação*",
  "🧭 *Suporte*",
 }
 lastIndex:=-1
 for _,category:=range categories{
  index:=strings.Index(help,category)
  if index<=lastIndex {t.Errorf("category %q is missing or out of order",category)}
  lastIndex=index
 }
 var commandLines []string
 for _,line:=range strings.Split(help,"\n") {
  if strings.HasPrefix(line,"!") {
   name:=strings.Fields(line)[0]
   commandLines=append(commandLines,name)
  }
 }
 want:=[]string{
  "!perfil","!vincular",
  "!economia","!noticias",
  "!eleicao","!eleicoes",
  "!governo","!leis","!partidos","!votacoes",
  "!ajuda",
 }
 if len(commandLines)!=len(want) {
  t.Fatalf("expected exactly %d command entries; got %d: %v",len(want),len(commandLines),commandLines)
 }
 for i,command:=range want{
  if commandLines[i]!=command {
   t.Errorf("commands not in alphabetical category order at %d: got %q want %q",i,commandLines[i],command)
  }
 }
 if !strings.Contains(help,"!vincular CÓDIGO —") || !strings.Contains(help,"somente no privado") {
  t.Error("the private-only link command must be listed and clearly scoped")
 }
 if strings.Contains(help,"!eleicoes N —") {
  t.Error("election history and parameterized election detail are one command, not duplicated listings")
 }
 if !strings.HasSuffix(help,"🌐 Acesse a plataforma e participe do GOVRP:\n"+siteURL) {
  t.Error("the message must end with only the short platform invitation and official link")
 }
 if strings.Count(help,siteURL)!=1 {
  t.Error("platform URL should appear exactly once")
 }
 if strings.Count(help,"*Eleições*")!=1 {
  t.Error("election category should be present exactly once")
 }
}

func TestHelpMessageCustomPrefix(t *testing.T){
 help:=helpMessage("/")
 if !strings.Contains(help,"/vincular CÓDIGO") || !strings.Contains(help,"/eleicoes —") {
  t.Error("help commands should use the bot's configured prefix")
 }
 if strings.Contains(help,"\n!ajuda —") {
  t.Error("default prefix must not leak into slash-prefix help")
 }
}
