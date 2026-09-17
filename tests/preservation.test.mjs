import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('client structure and behavior are preserved exactly',()=>{
 const original=readFileSync(new URL('../public/referencia.html',import.meta.url),'utf8').trim();
 const premium=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace('<link rel="stylesheet" href="/premium.css">\n','').trim();
 assert.equal(premium,original);
 const pages=original.match(/const PAGES = \[([\s\S]*?)\];/)[1];
 assert.equal((pages.match(/\{id:/g)||[]).length,13);
});
