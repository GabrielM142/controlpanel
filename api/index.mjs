import {timingSafeEqual} from 'node:crypto';
import {demoRows} from '../lib/model.mjs';
function authorized(req){const secret=process.env.PANEL_PASSWORD;if(!secret)return false;const supplied=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Basic '+Buffer.from('juj:'+secret).toString('base64'));return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 const demo=process.env.APP_MODE==='demo';
 if(!demo&&!authorized(req)){res.setHeader('WWW-Authenticate','Basic realm="CONTROLPANEL JUJ", charset="UTF-8"');return send(401,{error:'Acceso restringido'});}
 const path=new URL(req.url,'http://localhost').pathname;
 if(demo){if(req.method!=='GET')return send(409,{error:'La actualización requiere conectar la base analítica y el worker de Odoo.'});return send(200,{mode:'demo',snapshots:[{id:'demo',created_at:'2026-06-30T23:00:00Z',source:'Demostración',rows:demoRows()}],jobs:[]});}
 if(!process.env.DATABASE_URL)return send(503,{error:'Base analítica pendiente de configuración'});
 try{const {db}=await import('../lib/db.mjs');
 if(req.method==='GET'){const [snapshots,jobs]=await Promise.all([db.query('SELECT id,created_at,source,rows FROM snapshots ORDER BY created_at DESC LIMIT 12'),db.query('SELECT id,status,created_at,finished_at,error FROM jobs ORDER BY created_at DESC LIMIT 20')]);return send(200,{mode:'live',snapshots:snapshots.rows,jobs:jobs.rows});}
 if(req.method==='POST'&&path==='/api/refresh'){
 const origin=req.headers.origin;if(!origin||new URL(origin).host!==req.headers.host)return send(403,{error:'Origen inválido'});
 const result=await db.query("INSERT INTO jobs(status) VALUES('queued') ON CONFLICT DO NOTHING RETURNING id");return send(202,{id:result.rows[0]?.id,message:result.rowCount?'Snapshot solicitado':'Ya existe una actualización en curso'});}
 return send(405,{error:'Método no permitido'});
 }catch(e){console.error('API failure:',e.code||e.name);return send(503,{error:'No se pudo acceder a los snapshots. Intenta nuevamente.'});}
}
