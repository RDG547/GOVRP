package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
 "strings"
 "go.mau.fi/whatsmeow/types"
 "go.mau.fi/whatsmeow/types/events"
 "go.mau.fi/whatsmeow/proto/waE2E"
 "google.golang.org/protobuf/proto"
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
 publicCommands := []string{"ajuda","noticias","economia","governo","partidos","eleicao","eleicoes","votacoes","leis","perfil","deputados","senadores","deputado","senador","stf","presos","constituicao"}
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
  "🏛️ *Política*",
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
  "!constituicao","!deputado","!deputados","!eleicao","!eleicoes","!governo","!leis","!partidos","!presos","!senador","!senadores","!stf","!votacoes",
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
 if strings.Count(help,"*Política*")!=1 || strings.Contains(help,"*Eleições*") || strings.Contains(help,"Governo e legislação") {
  t.Error("all political commands must share a single Política category")
 }
 if !strings.Contains(help,"!deputados —") || !strings.Contains(help,"!senadores —") {
  t.Error("both legislative house commands must appear in help")
 }
 for _,category:=range categories{
  if !strings.Contains(help,category+"\n\n!") {
   t.Errorf("category %q must have a blank line before its commands",category)
  }
 }
 if !strings.Contains(help,"!constituicao —") || !strings.Contains(help,"!deputado NOME OU NÚMERO —") ||
  !strings.Contains(help,"!senador NOME OU NÚMERO —") ||
  !strings.Contains(help,"!stf —") || !strings.Contains(help,"!presos —") {
  t.Error("new GOVRP commands must be documented")
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


func TestOwnNumberCommandsAndGroupAllowlist(t *testing.T) {
 group:=types.NewJID("120363111111111",types.GroupServer)
 other:=types.NewJID("120363222222222",types.GroupServer)
 sender:=types.NewJID("5511999888777",types.DefaultUserServer)
 settings:=Settings{Enabled:true,Commands:true,Prefix:"!"}
 groups:=map[string]bool{group.String():true}
 message:=&events.Message{Message:&waE2E.Message{Conversation:proto.String("!partidos")}}
 message.Info.Chat=group
 message.Info.Sender=sender
 message.Info.IsGroup=true
 message.Info.IsFromMe=true
 cmd,words,ok:=parseIncomingCommand(message,settings,groups)
 if !ok || cmd!="partidos" || len(words)!=1 {
  t.Fatalf("own-number message was ignored: cmd=%q words=%q ok=%t",cmd,words,ok)
 }
 message.Info.IsFromMe=false
 if _,_,ok:=parseIncomingCommand(message,settings,groups);!ok {
  t.Fatal("incoming group messages must still work")
 }
 message.Info.IsFromMe=true
 message.Info.Chat=other
 if _,_,ok:=parseIncomingCommand(message,settings,groups);ok {
  t.Error("own-number messages must never bypass the enabled-group allowlist")
 }
 message.Info.Chat=group
 settings.Commands=false
 if _,_,ok:=parseIncomingCommand(message,settings,groups);ok {
  t.Error("own-number commands must respect the commands_enabled setting")
 }
 settings.Commands=true
 settings.Enabled=false
 if _,_,ok:=parseIncomingCommand(message,settings,groups);ok {
  t.Error("own-number commands must respect the global bot pause")
 }
 settings.Enabled=true
 message.Info.IsGroup=false
 message.Info.Chat=sender
 if _,_,ok:=parseIncomingCommand(message,settings,groups);ok {
  t.Error("own-number private chat cannot use group-only party command")
 }
 message.Message=&waE2E.Message{Conversation:proto.String("!vincular ABC123")}
 if cmd,_,ok:=parseIncomingCommand(message,settings,groups);!ok||cmd!="vincular"{
  t.Fatal("private account-linking must keep working")
 }
 message.Info.Chat=group
 message.Info.IsGroup=true
 message.Message=&waE2E.Message{Conversation:proto.String("🚩 *Partidos políticos do GOVRP*\n!partidos")}
 if _,_,ok:=parseIncomingCommand(message,settings,groups);ok {
  t.Error("bot replies must not be interpreted as commands: no command loop")
 }
}

func TestLivePartyDirectoryRPC(t *testing.T) {
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.Method!=http.MethodPost||r.URL.Path!="/rest/v1/rpc/bot_whatsapp_parties"{
    t.Errorf("unexpected party directory RPC: %s %s",r.Method,r.URL.Path)
  }
  var payload map[string]any
  if err:=json.NewDecoder(r.Body).Decode(&payload);err!=nil{t.Fatal(err)}
  if len(payload)!=0{t.Errorf("party RPC should not receive user-controlled parameters: %v",payload)}
  _=json.NewEncoder(w).Encode("🚩 *Partidos políticos do GOVRP*\n👥 Membros: 5\n🟢 Ativo")
 }))
 defer server.Close()
 api:=&API{base:server.URL,key:"test-key",http:server.Client()}
 var message string
 if err:=api.rpc(context.Background(),"bot_whatsapp_parties",map[string]any{},&message);err!=nil{t.Fatal(err)}
 if !strings.Contains(message,"Membros: 5") || !strings.Contains(message,"Ativo"){
  t.Fatalf("unexpected live party directory: %q",message)
 }
}


func TestParliamentHouseCommandsRPC(t *testing.T) {
 for _,house:=range []string{"deputados","senadores"} {
  t.Run(house,func(t *testing.T){
   server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
    if r.Method!=http.MethodPost || r.URL.Path!="/rest/v1/rpc/bot_whatsapp_parliament_house" {
     t.Errorf("unexpected parliament RPC path: %s %s",r.Method,r.URL.Path)
    }
    var params map[string]string
    if err:=json.NewDecoder(r.Body).Decode(&params);err!=nil{t.Fatal(err)}
    if params["p_house"]!=house || len(params)!=1 {
     t.Errorf("unexpected parliament RPC parameters: %+v",params)
    }
    _=json.NewEncoder(w).Encode("🏛️ Mandato restante: 23d 12h")
   }))
   defer server.Close()
   api:=&API{base:server.URL,key:"test-key",http:server.Client()}
   var reply string
   if err:=api.rpc(context.Background(),"bot_whatsapp_parliament_house",map[string]any{
    "p_house":house,
   },&reply);err!=nil {t.Fatal(err)}
   if !strings.Contains(reply,"Mandato restante:") {
    t.Errorf("missing term details: %s",reply)
   }
  })
 }
}

func TestChangelogEveryoneMentionNotice(t *testing.T) {
 valid:="📢 *🆕 GOVRP — Changelog 17/11/2026*\n\nAtualizações publicadas"
 if !isChangelogEveryoneNotice(valid) { t.Fatal("explicit admin changelog must notify every participant") }
 for _,message:=range []string{
  "📢 *Atualização geral*\nNotícias", "📢 *Novo decreto*",
  "📢 *🗳️ Eleição", "🆕 GOVRP — Changelog 17/11/2026",
 } {
  if isChangelogEveryoneNotice(message) { t.Fatalf("other announcements must not mention everyone: %q",message) }
 }
 members:=[]types.JID{types.NewJID("5511999991111",types.DefaultUserServer),types.NewJID("12098765",types.HiddenUserServer)}
 msg,err:=electionMentionMessage(valid,members)
 if err!=nil { t.Fatal(err) }
 if got:=len(msg.GetExtendedTextMessage().GetContextInfo().GetMentionedJID());got!=2 {
  t.Fatalf("expected two actual mentions, got %d",got)
 }
}


func TestNewGovernanceCommandsScopedToAuthorizedGroups(t *testing.T) {
  settings:=Settings{Enabled:true,Commands:true,Prefix:"!"}
  group:=types.NewJID("120363111111111",types.GroupServer)
  other:=types.NewJID("120363999999999",types.GroupServer)
  allow:=map[string]bool{group.String():true}
  for _,sample:=range []struct{ input,name string }{
   {"!constituicao","constituicao"},
   {"!deputado 1","deputado"},
   {"!deputado Nome Completo","deputado"},
   {"!senador 2","senador"},
   {"!senador Fulano da Silva","senador"},
   {"!stf","stf"},
   {"!presos","presos"},
  } {
   msg:=&events.Message{Message:&waE2E.Message{Conversation:proto.String(sample.input)}}
   msg.Info.Chat=group
   msg.Info.IsGroup=true
   command,parts,ok:=parseIncomingCommand(msg,settings,allow)
   if !ok || command!=sample.name || len(parts)==0 {t.Fatalf("failed authorized command %q: %s %v %t",sample.input,command,parts,ok)}
   msg.Info.Chat=other
   if _,_,ok:=parseIncomingCommand(msg,settings,allow);ok {t.Errorf("unauthorized group accepted %q",sample.input)}
   msg.Info.IsGroup=false
   if _,_,ok:=parseIncomingCommand(msg,settings,allow);ok {t.Errorf("private chat accepted %q",sample.input)}
  }
}
