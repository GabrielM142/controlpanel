import {timingSafeEqual} from 'node:crypto';

// Trueque Factory intake endpoint. GET lists recent requests; POST persists a new one.
// Same auth model as api/index.mjs: allowed when APP_MODE=demo or on Basic auth match.

function authorized(req){
 const secret=process.env.PANEL_PASSWORD;if(!secret)return false;
 const supplied=Buffer.from(req.headers.authorization||'');
 const expected=Buffer.from('Basic '+Buffer.from('juj:'+secret).toString('base64'));
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}

const PLAN=new Set(['free','pro','enterprise']);
const PRIORITY=new Set(['baja','media','alta','urgente']);

function pickString(v,max){if(typeof v!=='string')return '';const t=v.trim();return t.length>max?t.slice(0,max):t;}

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json');
 const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 const demo=process.env.APP_MODE==='demo';
 if(!demo&&!authorized(req)){res.setHeader('WWW-Authenticate','Basic realm="CONTROLPANEL JUJ", charset="UTF-8"');return send(401,{error:'Acceso restringido'});}
 if(!process.env.DATABASE_URL)return send(503,{error:'Base analítica pendiente de configuración. Guardando localmente hasta la conexión con Odoo.'});
 try{
  const {db}=await import('../lib/db.mjs');
  if(req.method==='GET'){
   const r=await db.query("SELECT id,created_at,client_name,plan,title,priority,status,tokens_used FROM trueque_requests ORDER BY created_at DESC LIMIT 30");
   return send(200,{requests:r.rows});
  }
  if(req.method==='POST'){
   const origin=req.headers.origin;
   if(!demo&&(!origin||new URL(origin).host!==req.headers.host))return send(403,{error:'Origen inválido'});
   let body='';for await(const chunk of req)body+=chunk;if(body.length>32000)return send(413,{error:'Solicitud demasiado grande'});
   const j=JSON.parse(body||'{}');
   const clientName=pickString(j.client_name,120);
   const title=pickString(j.title,140);
   const process=pickString(j.process,600);
   const actors=pickString(j.actors,400);
   const dataSources=pickString(j.data_sources,400);
   const integrations=pickString(j.integrations,400);
   const outputs=pickString(j.outputs,400);
   if(!clientName||!title||!process||!actors||!dataSources||!integrations||!outputs)return send(400,{error:'Faltan campos obligatorios'});
   const plan=PLAN.has(j.plan)?j.plan:'free';
   const priority=PRIORITY.has(j.priority)?j.priority:'media';
   const email=pickString(j.client_email,180)||null;
   const budget=pickString(j.budget,80)||null;
   const timeline=pickString(j.timeline,120)||null;
   const conversation=Array.isArray(j.conversation)?j.conversation.slice(0,80):[];
   const tokensUsed=Number.isFinite(j.tokens_used)?Math.max(0,Math.min(5000,j.tokens_used|0)):0;
   const insert=await db.query(
    `INSERT INTO trueque_requests(client_name,client_email,plan,title,process,actors,data_sources,integrations,outputs,priority,budget,timeline,conversation,tokens_used)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING id,created_at,status`,
    [clientName,email,plan,title,process,actors,dataSources,integrations,outputs,priority,budget,timeline,JSON.stringify(conversation),tokensUsed]
   );
   return send(201,insert.rows[0]);
  }
  return send(405,{error:'Método no permitido'});
 }catch(e){console.error('Trueque API failure:',e.code||e.name||e.message);return send(503,{error:'No se pudo procesar la solicitud. Intenta nuevamente.'});}
}
