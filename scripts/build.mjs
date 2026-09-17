import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','premium.css'])await copyFile('public/'+file,'dist/'+file);
