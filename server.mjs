import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/index.mjs';
process.env.APP_MODE??='demo';
http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api'))return handler(req,res);const files={'/':'public/index.html','/app.mjs':'public/app.mjs','/style.css':'public/style.css','/referencia.html':'public/referencia.html','/model.mjs':'lib/model.mjs'};if(!files[path]){res.writeHead(404);return res.end('No encontrado');}try{const data=await readFile(files[path]);res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(data);}catch{res.writeHead(500);res.end('Error');}}).listen(3000,'127.0.0.1',()=>console.log('CONTROLPANEL http://localhost:3000'));
