import http from 'http'; import fs from 'fs'; import path from 'path';
const root=path.dirname(new URL(import.meta.url).pathname); const port=+process.argv[2]||4173;
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.mp3':'audio/mpeg','.wav':'audio/wav'};
http.createServer((q,s)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 fs.readFile(f,(e,b)=>{if(e){s.writeHead(404);s.end();return;} s.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); s.end(b);});
}).listen(port,()=>console.log('serving',port));
