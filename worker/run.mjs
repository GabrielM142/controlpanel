import pg from 'pg';
import {db} from '../lib/db.mjs';
import {validateRows} from '../lib/model.mjs';
if(!process.env.ODOO_REPLICA_URL||!process.env.DATABASE_URL)throw Error('Configure las dos bases de datos');
const source=new pg.Pool({connectionString:process.env.ODOO_REPLICA_URL,max:1,connectionTimeoutMillis:10000});
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
// A dedicated session lock prevents two workers and permits recovery after crashes.
const lock=await db.connect();
if(!(await lock.query('SELECT pg_try_advisory_lock(817402) AS locked')).rows[0].locked)throw Error('Ya existe un worker');
await db.query("UPDATE jobs SET status='failed',finished_at=now(),error='Worker interrumpido; vuelve a solicitar el snapshot' WHERE status='running'");
while(!stopping){
 const job=(await db.query("UPDATE jobs SET status='running',started_at=now() WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id")).rows[0];
 if(!job){await new Promise(r=>setTimeout(r,3000));continue;}
 let conn;
 try{conn=await source.connect();await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await conn.query("SET LOCAL statement_timeout='40min'");
 // JUJ must implement this versioned reporting view after validating its Odoo schema.
 const rows=validateRows((await conn.query('SELECT period,unit,brand,province,sales::float8,cost::float8,receivable::float8,overdue::float8,inventory::float8,orders::float8,customers::float8 FROM juj_reporting.controlpanel_v1 LIMIT 100001')).rows);
 await conn.query('COMMIT');
 await lock.query('BEGIN');await lock.query("INSERT INTO snapshots(job_id,source,rows) VALUES($1,'Odoo · réplica',$2)",[job.id,JSON.stringify(rows)]);await lock.query("UPDATE jobs SET status='completed',finished_at=now() WHERE id=$1",[job.id]);await lock.query('COMMIT');
 }catch(e){await lock.query('ROLLBACK');if(conn)await conn.query('ROLLBACK').catch(()=>{});console.error('Snapshot failed:',e.code||e.name);await db.query("UPDATE jobs SET status='failed',finished_at=now(),error='No se pudo generar el snapshot; revisar conexión y contrato de datos' WHERE id=$1",[job.id]);}
 finally{conn?.release();}
}
lock.release();await Promise.all([source.end(),db.end()]);
