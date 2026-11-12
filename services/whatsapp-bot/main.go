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
 gr,err:=b.api.selectRows(ctx,"whatsapp_bot_groups",url.Values{"select":{"jid,enabled"},"enabled":{"eq.true"},"limit":{"300"}})
 if err!=nil {log.Printf("groups: %v",err);return}
 allowed:=make(map[string]bool,len(gr))
 for _,g:=range gr {allowed[val(g["jid"])]=true}
 prefix:=val(config[0]["command_prefix"]);if prefix=="" {prefix="!"}
 b.mu.Lock()
 b.settings=Settings{Enabled:truth(config[0]["enabled"]),Commands:truth(config[0]["commands_enabled"]),Prefix:prefix}
 b.groups=allowed
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
 for _,g:=range gr {b.discovered(g.JID.String(),g.Name)}
 return nil
}
func (b *Bot) rateOK(key string) bool {
 b.lastMu.Lock();defer b.lastMu.Unlock()
 now:=time.Now()
 if prev,ok:=b.last[key];ok && now.Sub(prev)<5*time.Second {return false}
 b.last[key]=now
 if len(b.last)>1000 {for k,t:=range b.last{if now.Sub(t)>2*time.Minute{delete(b.last,k)}}}
 return true
}
func (b *Bot) send(to types.JID,message string) (string,error) {
 if !b.wa.IsLoggedIn() {return "",errors.New("WhatsApp desconectado")}
 b.sendMu.Lock();defer b.sendMu.Unlock()
 // A single sender and a two-second spacing avoid bursts from multiple event sources.
 ctx,cancel:=context.WithTimeout(context.Background(),25*time.Second);defer cancel()
 resp,err:=b.wa.SendMessage(ctx,to,&waE2E.Message{Conversation:proto.String(message)})
 time.Sleep(2*time.Second)
 if err!=nil{return "",err}
 return string(resp.ID),nil
}
func (b *Bot) reply(to types.JID,text string) {
 if text=="" {return}
 go func(){_,err:=b.send(to,text);if err!=nil{log.Printf("reply failed (%s): %v",to.String(),err)}}()
}
func (b *Bot) onMessage(evt *events.Message) {
 if evt.Info.IsFromMe || evt.Message==nil{return}
 text:=strings.TrimSpace(evt.Message.GetConversation())
 if text=="" {text=strings.TrimSpace(evt.Message.GetExtendedTextMessage().GetText())}
 if text=="" {return}
 if evt.Info.IsGroup {b.discovered(evt.Info.Chat.String(),"")}
 settings,groups:=b.current()
 if !settings.Enabled || !settings.Commands{return}
 if evt.Info.IsGroup && !groups[evt.Info.Chat.String()] {return}
 if !strings.HasPrefix(text,settings.Prefix){return}
 words:=strings.Fields(strings.TrimSpace(strings.TrimPrefix(text,settings.Prefix)))
 if len(words)==0{return}
 command:=strings.ToLower(words[0])
 if !b.rateOK(evt.Info.Sender.String()){return}
 // Pairing and unlinking are strictly private to avoid leaking one-time codes into groups.
 if command=="vincular" || command=="desvincular" {
  if evt.Info.IsGroup {
   b.reply(evt.Info.Chat,"🔒 Para vincular sua conta, fale com o bot no privado.")
   return
  }
  go b.handlePrivate(evt.Info.Sender,command,words)
  return
 }
 permitted:=map[string]bool{"ajuda":true,"noticias":true,"economia":true,"governo":true,"partidos":true,"eleicoes":true,"votacoes":true,"leis":true,"perfil":true}
 if !permitted[command] {return}
 go func(){
  ctx,cancel:=ctxTimeout();defer cancel()
  var reply string
  err:=b.api.rpc(ctx,"bot_whatsapp_command",map[string]any{"p_command":command,"p_sender_jid":evt.Info.Sender.String()},&reply)
  if err!=nil {log.Printf("command %s: %v",command,err);b.reply(evt.Info.Chat,"Não consegui consultar o GOVRP agora. Tente novamente.");return}
  b.reply(evt.Info.Chat,reply)
 }()
}
func (b *Bot) handlePrivate(sender types.JID,command string,args []string) {
 ctx,cancel:=ctxTimeout();defer cancel()
 var text string
 var err error
 switch command {
 case "vincular":
  if len(args)!=2 {text="Use !vincular CÓDIGO. Gere seu código em "+siteURL+"/settings";break}
  err=b.api.rpc(ctx,"bot_whatsapp_complete_link",map[string]any{"p_sender_jid":sender.String(),"p_code":strings.ToUpper(args[1])},&text)
 case "desvincular":
  var unlinked bool
  err=b.api.rpc(ctx,"bot_whatsapp_unlink_sender",map[string]any{"p_sender_jid":sender.String()},&unlinked)
  if unlinked {text="✅ WhatsApp desvinculado do GOVRP."} else {text="Este número não estava vinculado."}
 }
 if err!=nil {log.Printf("link operation: %v",err);text="Não consegui concluir a operação. Tente novamente."}
 b.reply(sender,text)
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
 defer statusTicker.Stop();defer configTicker.Stop();defer deliveryTicker.Stop()
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
   bot.readConfig()
  case <-deliveryTicker.C:
   bot.deliver()
  }
 }
}
func main() {if err:=run();err!=nil{log.Fatalf("bot: %v",err)}}
