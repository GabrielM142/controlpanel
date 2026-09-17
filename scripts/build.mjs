import {mkdir,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});await cp('lib/model.mjs','dist/model.mjs');
