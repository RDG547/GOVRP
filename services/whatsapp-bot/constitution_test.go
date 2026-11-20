package main

import (
 "bytes"
 "context"
 "io"
 "net/http"
 "strings"
 "testing"

 "go.mau.fi/whatsmeow"
)

type constitutionTransport func(*http.Request)(*http.Response,error)
func (f constitutionTransport) RoundTrip(req *http.Request)(*http.Response,error){return f(req)}

func TestOfficialConstitutionPDFDelivery(t *testing.T) {
 bytesPDF:=[]byte("%PDF-1.4\n"+strings.Repeat("A",200)+"\n%%EOF\n")
 client:=&http.Client{Transport:constitutionTransport(func(r *http.Request)(*http.Response,error){
  if r.Method!=http.MethodGet || r.URL.String()!=siteURL+officialConstitutionPath {
   t.Errorf("wrong PDF source: %s %s",r.Method,r.URL.String())
  }
  return &http.Response{
   StatusCode:200,ContentLength:int64(len(bytesPDF)),
   Body:io.NopCloser(bytes.NewReader(bytesPDF)),
   Header:make(http.Header),
  },nil
 })}
 data,err:=downloadConstitutionPDF(context.Background(),client)
 if err!=nil || !bytes.Equal(data,bytesPDF) {t.Fatalf("valid PDF was rejected: %v",err)}
 upload:=whatsmeow.UploadResponse{
  URL:"https://media.whatsapp.invalid/file",
  DirectPath:"/mms/document/document.enc",
  FileEncSHA256:[]byte{1,2,3},
  FileSHA256:[]byte{4,5,6},
  MediaKey:[]byte{7,8,9},
  FileLength:uint64(len(data)),
 }
 doc:=constitutionDocument(upload,"2.0").GetDocumentMessage()
 if doc==nil || doc.GetMimetype()!="application/pdf" ||
    doc.GetFileName()!="Constituicao_GOVRP.pdf" ||
    doc.GetFileLength()!=uint64(len(data)) ||
    doc.GetDirectPath()!=upload.DirectPath ||
    !bytes.Equal(doc.GetFileSHA256(),upload.FileSHA256) ||
    !strings.Contains(doc.GetCaption(),"Versão 2.0") {
   t.Fatalf("real WhatsApp DocumentMessage has incorrect metadata: %#v",doc)
 }
}

func TestConstitutionPDFRejectsInvalidFiles(t *testing.T) {
 for _,test:=range []struct{name string;status int;body string;length int64}{
  {"not found",404,"",0},
  {"html SPA fallback",200,strings.Repeat("<html>",24),0},
  {"truncated PDF",200,"%PDF-1.4"+strings.Repeat("X",150),0},
  {"too large",200,"%PDF-1.4"+strings.Repeat("X",150)+"%%EOF",maxConstitutionPDFSize+1},
 } {
  t.Run(test.name,func(t *testing.T) {
   client:=&http.Client{Transport:constitutionTransport(func(*http.Request)(*http.Response,error){
    return &http.Response{
     StatusCode:test.status,
     ContentLength:test.length,
     Body:io.NopCloser(strings.NewReader(test.body)),
     Header:make(http.Header),
    },nil
   })}
   if _,err:=downloadConstitutionPDF(context.Background(),client);err==nil {
    t.Fatal("should not send an invalid or missing PDF as Constitution")
   }
  })
 }
}
