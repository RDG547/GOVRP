// Local-only TLS bridge to exercise real uploads with production's HTTPS URL rules.
import https from 'node:https';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function localSupabaseHttps(apiUrl, port) {
  const target=new URL(apiUrl);
  if(target.hostname!=='127.0.0.1')throw new Error('A ponte TLS só pode usar o Supabase local.');
  const dir=mkdtempSync(join(tmpdir(),'govrp-https-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  const options=req=>({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:{...req.headers,host:target.host}});
  const server=https.createServer({key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},(req,res)=>{
    const proxy=http.request(options(req),upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502);res.end();});req.pipe(proxy);
  });
  server.on('upgrade',(req,socket,head)=>{
    const proxy=http.request(options(req));proxy.on('upgrade',(res,upstream,upstreamHead)=>{
      socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`+Object.entries(res.headers).map(([key,value])=>`${key}: ${value}\r\n`).join('')+'\r\n');
      if(head.length)upstream.write(head);if(upstreamHead.length)socket.write(upstreamHead);
      upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());upstream.pipe(socket).pipe(upstream);
    });proxy.on('error',()=>socket.destroy());proxy.end();
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {url:`https://127.0.0.1:${port}`,certPath:join(dir,'cert.pem'),close:()=>{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});}};
}
