import {readFile} from 'node:fs/promises';
import {db} from '../lib/db.mjs';
await db.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));await db.end();
