// GOVRP WhatsApp Bot 1.0 - standalone Oracle ARM64-compatible service.
// WARNING: whatsmeow is an unofficial WhatsApp client. Use an authorized dedicated number.
package main

import (
 "context"
 "encoding/base64"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "log"
 "net/http"
 "net/url"
 "os"
 "os/signal"
 "sort"
 "strconv"
 "strings"
 "sync"
 "syscall"
 "time"

 qrcode "github.com/skip2/go-qrcode"
 _ "github.com/mattn/go-sqlite3"
 "go.mau.fi/whatsmeow"
 "go.mau.fi/whatsmeow/proto/waE2E"
 "go.mau.fi/whatsmeow/store/sqlstore"
 "go.mau.fi/whatsmeow/types"
 "go.mau.fi/whatsmeow/types/events"
 "google.golang.org/protobuf/proto"
)

const siteURL="https://govrp.vercel.app"

type API struct { base,key string; http *http.Client }
func (a *API) request(ctx context.Context,method,path string,qs url.Values,payload any,out any) error {
 var body io.Reader
 if payload!=nil {
  bytes,err:=json.Marshal(payload);if err!=nil{return err};body=strings.NewReader(string(bytes))
 }
 u:=a.base+"/rest/v1/"+strings.TrimPrefix(path,"/")
 if len(qs)>0 {u+="?"+qs.Encode()}
 req,err:=http.NewRequestWithContext(ctx,method,u,body);if err!=nil{return err}
 req.Header.Set("apikey",a.key);req.Header.Set("Authorization","Bearer "+a.key)
 if payload!=nil {req.Header.Set("Content-Type","application/json")}
 if method=="POST" {req.Header.Set("Prefer","return=representation")}
 resp,err:=a.http.Do(req);if err!=nil{return err};defer resp.Body.Close()
 if resp.StatusCode>=300 {buf,_:=io.ReadAll(io.LimitReader(resp.Body,350));return fmt.Errorf("Supabase HTTP %d: %s",resp.StatusCode,string(buf))}
 if out!=nil {return json.NewDecoder(resp.Body).Decode(out)}
 _,_ =io.Copy(io.Discard,resp.Body)
 return nil
}
func (a *API) rpc(ctx context.Context,name string,data any,out any) error {
 return a.request(ctx,"POST","rpc/"+name,nil,data,out)
}
func (a *API) selectRows(ctx context.Context,table string,qs url.Values) ([]map[string]any,error) {
 result:=[]map[string]any{}
 err:=a.request(ctx,"GET",table,qs,nil,&result)
 return result,err
}
func val(v any) string {if v==nil{return ""};return fmt.Sprint(v)}
func truth(v any) bool {return v==true}
func ctxTimeout() (context.Context,context.CancelFunc) {return context.WithTimeout(context.Background(),15*time.Second)}

type Settings struct { Enabled,Commands bool; Prefix string }
type Bot struct {
 api *API
 wa *whatsmeow.Client
 mu sync.RWMutex
 sendMu sync.Mutex
 settings Settings
 groups map[string]bool
 officialGroups map[string]bool
 welcomeMu sync.Mutex
 welcomeSent map[string]time.Time
 last map[string]time.Time
 lastMu sync.Mutex
 groupNames map[string]bool
 groupsMu sync.Mutex
}

func (b *Bot) report(connected,paired bool,qr,problem string) {
 ctx,cancel:=ctxTimeout();defer cancel()
 var jid any
 if paired && b.wa.Store.ID!=nil {jid=b.wa.Store.ID.String()}
 var q any
 if qr!="" {q=qr}
 var problemValue any
 if problem!="" {problemValue=problem}
 err:=b.api.rpc(ctx,"bot_whatsapp_report_status",map[string]any{"p_connected":connected,"p_paired":paired,"p_phone_jid":jid,"p_qr_image":q,"p_error":problemValue},nil)
 if err!=nil {log.Printf("status: %v",err)}
}
func (b *Bot) readConfig() {
 ctx,cancel:=ctxTimeout();defer cancel()
 config,err:=b.api.selectRows(ctx,"whatsapp_bot_settings",url.Values{"select":{"enabled,commands_enabled,command_prefix"},"id":{"eq.true"},"limit":{"1"}})
 if err!=nil || len(config)==0 {log.Printf("config: %v",err);return}
 gr,err:=b.api.selectRows(ctx,"whatsapp_bot_groups",url.Values{"select":{"jid,enabled,is_official"},"enabled":{"eq.true"},"bot_joined":{"eq.true"},"or":{"(is_official.eq.true,authorized_at.not.is.null)"},"limit":{"300"}})
 if err!=nil {log.Printf("groups: %v",err);return}
 allowed:=make(map[string]bool,len(gr))
 official:=make(map[string]bool)
 for _,g:=range gr {
  jid:=val(g["jid"])
  allowed[jid]=true
  if truth(g["is_official"]){official[jid]=true}
 }
 prefix:=val(config[0]["command_prefix"]);if prefix=="" {prefix="!"}
 b.mu.Lock()
 b.settings=Settings{Enabled:truth(config[0]["enabled"]),Commands:truth(config[0]["commands_enabled"]),Prefix:prefix}
 b.groups=allowed
 b.officialGroups=official
 b.mu.Unlock()
}
func (b *Bot) current() (Settings,map[string]bool) {
 b.mu.RLock();defer b.mu.RUnlock()
 return b.settings,b.groups
}
func (b *Bot) discovered(jid,name string) {
 if jid=="" || !strings.HasSuffix(jid,"@g.us"){return}
 b.groupsMu.Lock()
 if b.groupNames[jid] {b.groupsMu.Unlock();return}
 b.groupNames[jid]=true
 b.groupsMu.Unlock()
 go func(){
  ctx,cancel:=ctxTimeout();defer cancel()
  if err:=b.api.rpc(ctx,"bot_whatsapp_discover_group",map[string]any{"p_jid":jid,"p_name":name},nil);err!=nil{
   log.Printf("group discovery: %v",err)
   b.groupsMu.Lock();delete(b.groupNames,jid);b.groupsMu.Unlock()
  }
 }()
}
func (b *Bot) syncJoinedGroups() error {
 ctx,cancel:=ctxTimeout();defer cancel()
 gr,err:=b.wa.GetJoinedGroups(ctx);if err!=nil{return err}
 ids:=make([]string,0,len(gr))
 for _,g:=range gr {ids=append(ids,g.JID.String());b.discovered(g.JID.String(),g.Name)}
 return b.api.rpc(ctx,"bot_sync_whatsapp_group_membership",map[string]any{"p_jids":ids},nil)
}
func (b *Bot) rateOK(key string) bool {
 b.lastMu.Lock();defer b.lastMu.Unlock()
 now:=time.Now()
 if prev,ok:=b.last[key];ok && now.Sub(prev)<5*time.Second {return false}
 b.last[key]=now
 if len(b.last)>1000 {for k,t:=range b.last{if now.Sub(t)>2*time.Minute{delete(b.last,k)}}}
 return true
}
// Each election notice explicitly mentions every member who can be resolved in the
// authorized WhatsApp group. Merely writing "@todos" would not be a real mention.
func electionMentionMessage(text string, members []types.JID) (*waE2E.Message,error) {
 seen:=map[string]bool{}
 jids:=make([]string,0,len(members))
 names:=make([]string,0,len(members))
 for _,person:=range members {
  if person.User=="" || (person.Server!=types.DefaultUserServer && person.Server!=types.HiddenUserServer) {continue}
  id:=person.ToNonAD().String()
  if seen[id] {continue}
  seen[id]=true
  jids=append(jids,id)
  names=append(names,"@"+person.User)
 }
 if len(jids)==0{return nil,errors.New("nenhum participante foi identificado para menção")}
 body:=text+"\n\n🔔 "+strings.Join(names," ")
 if len(body)>60000 {return nil,fmt.Errorf("lista de menções excede tamanho de mensagem: %d",len(body))}
 return &waE2E.Message{ExtendedTextMessage:&waE2E.ExtendedTextMessage{
  Text:proto.String(body),
  ContextInfo:&waE2E.ContextInfo{MentionedJID:jids},
 }},nil
}

func isElectionNotice(text string) bool {
 return strings.HasPrefix(text,"📢 *🗳️ ")
}
// An opt-in administrative changelog uses real group mentions, not literal "@todos".
// All other manual announcements keep their previous quiet delivery behavior.
func isChangelogEveryoneNotice(text string) bool {
 return strings.HasPrefix(text,"📢 *🆕 GOVRP — Changelog ")
}

// Serialize all outgoing messages, including personalized welcome messages.
func (b *Bot) sendPrepared(to types.JID,payload *waE2E.Message) (string,error) {
 if !b.wa.IsLoggedIn(){return "",errors.New("WhatsApp desconectado")}
 b.sendMu.Lock();defer b.sendMu.Unlock()
 ctx,cancel:=context.WithTimeout(context.Background(),30*time.Second);defer cancel()
 resp,err:=b.wa.SendMessage(ctx,to,payload)
 time.Sleep(2*time.Second)
 if err!=nil{return "",err}
 return string(resp.ID),nil
}
func (b *Bot) send(to types.JID,message string) (string,error) {
 if !b.wa.IsLoggedIn(){return "",errors.New("WhatsApp desconectado")}
 payload:=&waE2E.Message{Conversation:proto.String(message)}
 if to.Server==types.GroupServer && (isElectionNotice(message) || isChangelogEveryoneNotice(message)) {
  ctx,cancel:=context.WithTimeout(context.Background(),30*time.Second)
  group,err:=b.wa.GetGroupInfo(ctx,to)
  cancel()
  if err!=nil{return "",fmt.Errorf("não foi possível obter os membros do grupo para marcar a todos: %w",err)}
  members:=make([]types.JID,0,len(group.Participants))
  for _,part:=range group.Participants{members=append(members,part.JID)}
  payload,err=electionMentionMessage(message,members)
  if err!=nil{return "",err}
 }
 return b.sendPrepared(to,payload)
}
func (b *Bot) reply(to types.JID,text string) {
 if text=="" {return}
 go func(){_,err:=b.send(to,text);if err!=nil{log.Printf("reply failed (%s): %v",to.String(),err)}}()
}
// commandAllowed enforces group-only operation. Account linking is the sole private-chat exception.
// No message is sent to unauthorized groups, and private messages other than !vincular are ignored.
func commandAllowed(settings Settings, groups map[string]bool, isGroup bool, chatJID string, command string) bool {
 if !settings.Enabled {return false}
 if !isGroup {return command=="vincular"}
 if !settings.Commands || !groups[chatJID] {return false}
 switch command {
 case "ajuda","noticias","economia","governo","partidos","eleicao","eleicoes","votacoes","perfil","deputados","senadores","deputado","senador","stf","presos","constituicao","projetos","projeto":
  return true
 default:
  return false
 }
}

// A single source for the group help text avoids duplicating !eleicoes or
// appending sections after the footer. Categories and commands stay alphabetized.
type helpCommand struct {
 name, args, description string
}
type helpCategory struct {
 label, icon string
 commands []helpCommand
}

func helpMessage(prefix string) string {
 if prefix!="!" && prefix!="/" {prefix="!"}
 categories:=[]helpCategory{
  {label:"Conta e perfil",icon:"👤",commands:[]helpCommand{
   {name:"perfil",description:"Consulte os dados do seu cidadão, como nome, usuário e cargo atual. Requer conta vinculada."},
   {name:"vincular",args:"CÓDIGO",description:"Vincule seu WhatsApp à conta GOVRP com o código gerado nas configurações. Envie somente no privado do bot."},
  }},
  {label:"Economia e notícias",icon:"📊",commands:[]helpCommand{
   {name:"economia",description:"Confira crescimento econômico, inflação, Selic, câmbio e outros indicadores atuais do RP."},
   {name:"noticias",description:"Veja as cinco notícias mais recentes publicadas no portal de notícias do GOVRP."},
  }},
  {label:"Política",icon:"🏛️",commands:[]helpCommand{
   {name:"constituicao",description:"Receba no grupo o PDF oficial da Constituição vigente do GOVRP."},
   {name:"deputado",args:"NOME OU NÚMERO",description:"Consulte a ficha de um deputado pela posição no !deputados ou nome completo, com PLs e PECs propostas, aprovadas e rejeitadas."},
   {name:"deputados",description:"Mostra informações dos deputados em exercício, seus partidos e o tempo restante dos mandatos."},
   {name:"eleicao",description:"Consulte a eleição em andamento ou descubra qual será a próxima."},
   {name:"eleicoes",description:"Veja o histórico numerado das eleições. Acrescente um número, como !eleicoes 2, para ver detalhes de uma eleição específica."},
   {name:"governo",description:"Confira a formação governamental: Presidente, Vice-Presidente, ministros de Estado e PGR."},
   {name:"partidos",description:"Veja os partidos ativos e em formação, incluindo a quantidade de integrantes de cada um."},
   {name:"presos",description:"Consulte os cidadãos atualmente presos no GOVRP, a unidade prisional e a previsão de saída, quando disponível."},
   {name:"projeto",args:"NÚMERO OU NOME",description:"Veja o projeto, sua situação e a apuração por Casa: aprovado ou rejeitado, votos favoráveis, contrários, abstenções e quórum."},
   {name:"projetos",description:"Liste os 12 projetos legislativos mais recentes, com autor, Casa e situação. Use !projeto N para detalhes."},
   {name:"senador",args:"NOME OU NÚMERO",description:"Consulte a ficha de um senador pela posição no !senadores ou nome completo, com PLs e PECs propostas, aprovadas e rejeitadas."},
   {name:"senadores",description:"Mostra informações dos senadores em exercício, seus partidos e o tempo restante dos mandatos."},
   {name:"stf",description:"Veja a composição atual do Supremo Tribunal Federal, os ministros empossados e as vagas disponíveis."},
   {name:"votacoes",description:"Acompanhe as votações parlamentares abertas e seus prazos de encerramento."},
  }},
  {label:"Suporte",icon:"🧭",commands:[]helpCommand{
   {name:"ajuda",description:"Veja todos os comandos disponíveis, como usá-los e o que cada um permite consultar."},
  }},
 }
 sort.Slice(categories,func(i,j int)bool{return strings.ToLower(categories[i].label)<strings.ToLower(categories[j].label)})
 var message strings.Builder
 message.WriteString("🤖 *Comandos do GOVRP Bot*")
 for _,category:=range categories {
  sort.Slice(category.commands,func(i,j int)bool{return category.commands[i].name<category.commands[j].name})
  message.WriteString("\n\n"+category.icon+" *"+category.label+"*")
  for _,command:=range category.commands {
   // The WhatsApp command name is bold, with a blank line separating entries.
   message.WriteString("\n\n*"+prefix+command.name+"*")
   if command.args!="" {message.WriteString(" "+command.args)}
   message.WriteString(" — "+strings.ReplaceAll(command.description,"!eleicoes 2",prefix+"eleicoes 2"))
  }
 }
 message.WriteString("\n\n🌐 Acesse a plataforma e participe do GOVRP:\n"+siteURL)
 return message.String()
}

// parseIncomingCommand accepts the owner's own WhatsApp messages too. Do not
// discard IsFromMe: the phone paired with the bot also needs to issue commands.
// The group allowlist, global toggle and command scope still apply to everyone.
func parseIncomingCommand(evt *events.Message, settings Settings, groups map[string]bool) (string,[]string,bool) {
 if evt==nil || evt.Message==nil || !settings.Enabled {return "",nil,false}
 if evt.Info.IsGroup && !groups[evt.Info.Chat.String()] {return "",nil,false}
 text:=strings.TrimSpace(evt.Message.GetConversation())
 if text=="" {text=strings.TrimSpace(evt.Message.GetExtendedTextMessage().GetText())}
 if text=="" || !strings.HasPrefix(text,settings.Prefix) {return "",nil,false}
 words:=strings.Fields(strings.TrimSpace(strings.TrimPrefix(text,settings.Prefix)))
 if len(words)==0 {return "",nil,false}
 command:=strings.ToLower(words[0])
 if !commandAllowed(settings,groups,evt.Info.IsGroup,evt.Info.Chat.String(),command) {return "",nil,false}
 return command,words,true
}

func (b *Bot) onMessage(evt *events.Message) {
 if evt==nil || evt.Message==nil{return}
 if evt.Info.IsGroup {b.discovered(evt.Info.Chat.String(),"")}
 settings,groups:=b.current()
 command,words,ok:=parseIncomingCommand(evt,settings,groups)
 if !ok {return}
 sender:=evt.Info.Sender
 // Whatsmeow may use a device-specific sender on own outgoing messages.
 // Use the bot's paired account JID for rate limits and linked-profile queries.
 if evt.Info.IsFromMe && b.wa!=nil && b.wa.Store!=nil && b.wa.Store.ID!=nil {
  sender=b.wa.Store.ID.ToNonAD()
 }
 if !b.rateOK(sender.String()){return}

 if !evt.Info.IsGroup {
  // Linking uses a one-time code and is permitted only in the sender's private chat.
  go b.handlePrivate(sender,words)
  return
 }
 // All other supported commands work exclusively within an enabled group.
 if command=="constituicao" {
  go b.sendConstitution(evt.Info.Chat)
  return
 }
 if command=="ajuda" {
  b.reply(evt.Info.Chat,helpMessage(settings.Prefix))
  return
 }
 go func(){
  ctx,cancel:=ctxTimeout();defer cancel()
  var reply string
  var err error
  if command=="eleicao" || command=="eleicoes" {
   var number any
   if len(words)>1 {
    parsed,parseErr:=strconv.Atoi(words[1])
    if parseErr!=nil || parsed<1 || parsed>1000000 || len(words)!=2 {
     b.reply(evt.Info.Chat,"Número de eleição inválido. Consulte a lista com "+settings.Prefix+"eleicoes e escolha um número.")
     return
    }
    if command=="eleicao" {
     b.reply(evt.Info.Chat,"Para consultar uma eleição específica, use "+settings.Prefix+"eleicoes N.")
     return
    }
    number=parsed
   }
   err=b.api.rpc(ctx,"bot_whatsapp_election_command",map[string]any{
    "p_command":command,"p_number":number,
   },&reply)
  } else if command=="partidos" {
   err=b.api.rpc(ctx,"bot_whatsapp_parties",map[string]any{},&reply)
  } else if command=="deputados" || command=="senadores" {
   err=b.api.rpc(ctx,"bot_whatsapp_parliament_house",map[string]any{"p_house":command},&reply)
  } else if command=="deputado" || command=="senador" {
   if len(words)<2 || len(strings.Join(words[1:]," "))>120 {
    b.reply(evt.Info.Chat,"Informe o nome completo ou o número da lista. Exemplo: "+settings.Prefix+command+" 1.")
    return
   }
   selector:=strings.TrimSpace(strings.Trim(strings.Join(words[1:]," "),"\"'"))
   if selector=="" {
    b.reply(evt.Info.Chat,"Informe o nome completo ou o número da lista. Exemplo: "+settings.Prefix+command+" 1.")
    return
   }
   err=b.api.rpc(ctx,"bot_whatsapp_parliament_member",map[string]any{"p_house":command,"p_selector":selector},&reply)
  } else if command=="projetos" {
   if len(words)!=1 {
    b.reply(evt.Info.Chat,"Use "+settings.Prefix+"projetos para consultar a lista. Depois escolha "+settings.Prefix+"projeto N ou informe o nome.")
    return
   }
   err=b.api.rpc(ctx,"bot_whatsapp_projects",map[string]any{},&reply)
  } else if command=="projeto" {
   if len(words)<2 || len(strings.Join(words[1:]," "))>140 {
    b.reply(evt.Info.Chat,"Informe o número ou nome do projeto. Exemplo: "+settings.Prefix+"projeto 1. Consulte a lista com "+settings.Prefix+"projetos.")
    return
   }
   selector:=strings.TrimSpace(strings.Trim(strings.Join(words[1:]," "),"\"'"))
   if selector=="" {
    b.reply(evt.Info.Chat,"Informe o número ou nome do projeto. Exemplo: "+settings.Prefix+"projeto 1.")
    return
   }
   err=b.api.rpc(ctx,"bot_whatsapp_project",map[string]any{"p_selector":selector},&reply)
  } else if command=="stf" || command=="presos" {
   err=b.api.rpc(ctx,"bot_whatsapp_"+command,map[string]any{},&reply)
  } else {
   err=b.api.rpc(ctx,"bot_whatsapp_command",map[string]any{
    "p_command":command,"p_sender_jid":sender.String(),
   },&reply)
  }
  if err!=nil {log.Printf("command %s: %v",command,err);b.reply(evt.Info.Chat,"Não consegui consultar o GOVRP agora. Tente novamente.");return}
  b.reply(evt.Info.Chat,reply)
 }()
}
func (b *Bot) handlePrivate(sender types.JID,args []string) {
 ctx,cancel:=ctxTimeout();defer cancel()
 var reply string
 if len(args)!=2 {
  reply="Use !vincular CÓDIGO. Gere seu código em "+siteURL+"/settings"
 } else {
  err:=b.api.rpc(ctx,"bot_whatsapp_complete_link",map[string]any{"p_sender_jid":sender.String(),"p_code":strings.ToUpper(args[1])},&reply)
  if err!=nil {
   log.Printf("account linking failed: %v",err)
   reply="Não consegui concluir a vinculação. Tente novamente."
  }
 }
 b.reply(sender,reply)
}
// Polling with a database-side idempotency key handles time-based transitions even
// when no one opens the GOVRP site. The DB uses America/Sao_Paulo for displayed dates.
func (b *Bot) enqueueElectionMilestones() {
 settings,groups:=b.current()
 if !settings.Enabled || len(groups)==0 || !b.wa.IsLoggedIn(){return}
 ctx,cancel:=ctxTimeout();defer cancel()
 var created int
 err:=b.api.rpc(ctx,"bot_whatsapp_enqueue_election_lifecycle",map[string]any{},&created)
 if err!=nil {log.Printf("election schedule poll: %v",err);return}
 if created>0 {log.Printf("election events queued: %d",created)}
}

func (b *Bot) deliver() {
 settings,groups:=b.current()
 if !settings.Enabled || len(groups)==0 || !b.wa.IsLoggedIn(){return}
 ctx,cancel:=ctxTimeout()
 var list []map[string]any
 err:=b.api.rpc(ctx,"bot_whatsapp_claim_deliveries",map[string]any{"p_limit":4},&list)
 cancel()
 if err!=nil{log.Printf("event claim: %v",err);return}
 for _,item:=range list {
  jid:=val(item["group_jid"]);text:=val(item["message"]);id:=item["event_id"]
  if !groups[jid] {continue}
  to,err:=types.ParseJID(jid)
  var msgID string
  if err==nil {msgID,err=b.send(to,text)}
  finCtx,finCancel:=ctxTimeout()
  var errText any
  if err!=nil{errText=err.Error()}
  finishErr:=b.api.rpc(finCtx,"bot_whatsapp_finish_delivery",map[string]any{"p_event_id":id,"p_group_jid":jid,"p_success":err==nil,"p_provider_id":msgID,"p_error":errText},nil)
  finCancel()
  if finishErr!=nil{log.Printf("delivery receipt: %v",finishErr)}
  if err!=nil{log.Printf("delivery failed event=%v: %v",id,err)}
 }
}
func run() error {
 endpoint:=strings.TrimRight(os.Getenv("SUPABASE_URL"),"/")
 key:=os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
 if endpoint=="" || key=="" || !strings.HasPrefix(endpoint,"https://") {
  return errors.New("configure SUPABASE_URL (https) and SUPABASE_SERVICE_ROLE_KEY in the VPS environment")
 }
 storePath:=os.Getenv("BOT_SESSION_DB")
 if storePath=="" {storePath="/var/lib/govrp-whatsapp/session.db"}
 ctx,cancel:=context.WithCancel(context.Background())
 defer cancel()
 db,err:=sqlstore.New(ctx,"sqlite3","file:"+storePath+"?_foreign_keys=on",nil);if err!=nil{return fmt.Errorf("session database: %w",err)}
 defer db.Close()
 device,err:=db.GetFirstDevice(ctx);if err!=nil{return err}
 wa:=whatsmeow.NewClient(device,nil)
 bot:=&Bot{api:&API{base:endpoint,key:key,http:&http.Client{Timeout:20*time.Second}},wa:wa,groups:map[string]bool{},last:map[string]time.Time{},groupNames:map[string]bool{}}
 wa.AddEventHandler(func(evt any){
  switch v:=evt.(type) {
  case *events.Message: bot.onMessage(v)
  case *events.GroupInfo: bot.onGroupInfo(v)
  }
 })
 bot.readConfig()
 if wa.Store.ID==nil {
  qrCtx,cancelQR:=context.WithCancel(ctx)
  defer cancelQR()
  qrChan,err:=wa.GetQRChannel(qrCtx);if err!=nil{return fmt.Errorf("QR channel: %w",err)}
  go func(){
   for q:=range qrChan {
    if q.Event!="code" {log.Printf("pairing event: %s",q.Event);continue}
    img,err:=qrcode.Encode(q.Code,qrcode.Medium,300)
    if err!=nil {log.Printf("QR generation: %v",err);continue}
    bot.report(false,false,"data:image/png;base64,"+base64.StdEncoding.EncodeToString(img),"")
   }
  }()
 }
 if err=wa.Connect();err!=nil {bot.report(false,false,"",err.Error());return err}
 defer func(){wa.Disconnect();bot.report(false,wa.Store.ID!=nil,"","Serviço parado")}()
 log.Printf("GOVRP Bot iniciado. Monitore e conecte o número pelo painel admin em %s/admin-dashboard/whatsapp",siteURL)
 statusTicker:=time.NewTicker(25*time.Second)
 configTicker:=time.NewTicker(20*time.Second)
 deliveryTicker:=time.NewTicker(8*time.Second)
 electionTicker:=time.NewTicker(30*time.Second)
 defer statusTicker.Stop();defer configTicker.Stop();defer deliveryTicker.Stop();defer electionTicker.Stop()
 signals:=make(chan os.Signal,1);signal.Notify(signals,syscall.SIGINT,syscall.SIGTERM);defer signal.Stop(signals)
 groupSynced:=false
 for {
  select {
  case <-signals:
   log.Print("Finalização solicitada");return nil
  case <-statusTicker.C:
   if wa.IsLoggedIn() && !groupSynced {
    if err:=bot.syncJoinedGroups();err!=nil{log.Printf("group sync: %v",err)}else{groupSynced=true}
   }
   bot.report(wa.IsConnected(),wa.IsLoggedIn(),"","")
  case <-configTicker.C:
   bot.processGroupInvites()
   if wa.IsLoggedIn(){if err:=bot.syncJoinedGroups();err!=nil{log.Print("group membership reconciliation unavailable")}}
   bot.readConfig()
  case <-deliveryTicker.C:
   bot.deliver()
  case <-electionTicker.C:
   bot.enqueueElectionMilestones()
  }
 }
}
func main() {if err:=run();err!=nil{log.Fatalf("bot: %v",err)}}
