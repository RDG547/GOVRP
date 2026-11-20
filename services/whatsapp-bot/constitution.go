package main

import (
 "bytes"
 "context"
 "errors"
 "fmt"
 "io"
 "log"
 "net/http"
 "net/url"
 "time"

 "go.mau.fi/whatsmeow"
 "go.mau.fi/whatsmeow/proto/waE2E"
 "go.mau.fi/whatsmeow/types"
 "google.golang.org/protobuf/proto"
)

const officialConstitutionPath="/constituicao-govrp.pdf"
const maxConstitutionPDFSize=12*1024*1024

// The configured official text points to this known, versioned static GOVRP PDF.
// Never fetch an arbitrary URL from the database or a WhatsApp user.
func downloadConstitutionPDF(ctx context.Context,client *http.Client) ([]byte,error) {
 req,err:=http.NewRequestWithContext(ctx,http.MethodGet,siteURL+officialConstitutionPath,nil)
 if err!=nil {return nil,err}
 res,err:=client.Do(req)
 if err!=nil {return nil,err}
 defer res.Body.Close()
 if res.StatusCode!=http.StatusOK {
  return nil,fmt.Errorf("o documento oficial respondeu HTTP %d",res.StatusCode)
 }
 if res.ContentLength>maxConstitutionPDFSize {
  return nil,errors.New("o PDF oficial ultrapassa o limite permitido")
 }
 content,err:=io.ReadAll(io.LimitReader(res.Body,maxConstitutionPDFSize+1))
 if err!=nil {return nil,err}
 if len(content)>maxConstitutionPDFSize||len(content)<100||
  !bytes.HasPrefix(content,[]byte("%PDF-"))||
  !bytes.Contains(content[len(content)-min(len(content),1024):],[]byte("%%EOF")) {
  return nil,errors.New("o arquivo recebido não é um PDF oficial válido")
 }
 return content,nil
}

func constitutionDocument(upload whatsmeow.UploadResponse,version string) *waE2E.Message {
 if len(version)>15 {version=""}
 caption:="📜 *Constituição vigente do GOVRP*"
 if version!="" {caption+=" — Versão "+version}
 caption+="\nDocumento oficial em PDF."
 return &waE2E.Message{DocumentMessage:&waE2E.DocumentMessage{
  URL:proto.String(upload.URL),
  DirectPath:proto.String(upload.DirectPath),
  FileSHA256:upload.FileSHA256,
  FileEncSHA256:upload.FileEncSHA256,
  MediaKey:upload.MediaKey,
  FileLength:proto.Uint64(upload.FileLength),
  FileName:proto.String("Constituicao_GOVRP.pdf"),
  Mimetype:proto.String("application/pdf"),
  Caption:proto.String(caption),
 }}
}

func (b *Bot) sendConstitution(group types.JID) {
 if group.Server!=types.GroupServer {return}
 ctx,cancel:=context.WithTimeout(context.Background(),60*time.Second)
 defer cancel()
 settings,groups:=b.current()
 if !settings.Enabled||!settings.Commands||!groups[group.String()]||!b.wa.IsLoggedIn() {return}
 rows,err:=b.api.selectRows(ctx,"country_constitutions",url.Values{
  "select":{"version,title,source_url"},
  "status":{"eq.active"},
  "country_code":{"eq.BR"},
  "order":{"effective_at.desc"},
  "limit":{"1"},
 })
 if err!=nil||len(rows)!=1 {
  log.Printf("constitution lookup failed: %v",err)
  b.reply(group,"Não foi possível localizar a Constituição vigente do GOVRP. Tente novamente mais tarde.")
  return
 }
 // Only the official website asset is accepted; avoid SSRF and accidental old PDFs.
 if val(rows[0]["source_url"])!=officialConstitutionPath {
  log.Printf("constitution PDF source was changed or is unavailable")
  b.reply(group,"O PDF oficial da Constituição precisa ser atualizado. Consulte o documento na plataforma.")
  return
 }
 data,err:=downloadConstitutionPDF(ctx,&http.Client{Timeout:20*time.Second})
 if err!=nil {
  log.Printf("constitution download failed: %v",err)
  b.reply(group,"Não consegui obter o PDF oficial da Constituição agora. Tente novamente.")
  return
 }
 uploaded,err:=b.wa.Upload(ctx,data,whatsmeow.MediaDocument)
 if err!=nil {
  log.Printf("constitution upload failed: %v",err)
  b.reply(group,"Não foi possível enviar o PDF ao WhatsApp neste momento. Tente novamente.")
  return
 }
 if _,err=b.sendPrepared(group,constitutionDocument(uploaded,val(rows[0]["version"])));err!=nil {
  log.Printf("constitution document delivery failed: %v",err)
  b.reply(group,"Falha ao enviar o documento. Tente novamente.")
 }
}
