import terms from './terms.json';

export {terms};
/** Canonical text that is hashed and registered server-side (scripts/admin.mjs terms). Keep in sync with termsCanonical there. */
export function termsCanonical(t:typeof terms=terms){return [t.version,t.intro,...t.sections.map(s=>`${s.title}. ${s.body}`),t.note].join('\n');}
export async function termsSha256(){
 const data=new TextEncoder().encode(termsCanonical());
 const hash=await crypto.subtle.digest('SHA-256',data);
 return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
