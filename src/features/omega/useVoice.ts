import {useCallback,useEffect,useRef,useState} from 'react';

// Fase M7 · voz progresiva con la Web Speech API. Primero detecta si existe; nunca escucha sin que
// la persona pulse el micrófono. El texto reconocido va al flujo actual de Pregúntale a Omega
// (que consume Truekens y muestra su costo como hoy). Sin soporte, quien llama abre el chat de texto.
type Rec={lang:string;interimResults:boolean;continuous:boolean;start:()=>void;stop:()=>void;abort:()=>void;
 onresult:((e:{resultIndex:number;results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;
 onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null};
type RecCtor=new()=>Rec;
const ctor=():RecCtor|null=>{if(typeof window==='undefined')return null;const w=window as unknown as {SpeechRecognition?:RecCtor;webkitSpeechRecognition?:RecCtor};return w.SpeechRecognition||w.webkitSpeechRecognition||null;};

export function useVoice(onFinal:(text:string)=>void){
 const [supported]=useState(()=>!!ctor());
 const [listening,setListening]=useState(false);
 const [interim,setInterim]=useState('');
 const [error,setError]=useState<string|null>(null);
 const rec=useRef<Rec|null>(null);const said=useRef('');const cb=useRef(onFinal);cb.current=onFinal;
 const start=useCallback(()=>{
  const C=ctor();if(!C||rec.current)return;
  const r=new C();r.lang='es-EC';r.interimResults=true;r.continuous=false;said.current='';
  r.onresult=e=>{let fin='',mid='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=t;else mid+=t;}
   if(fin)said.current+=fin;setInterim(`${said.current}${mid}`.trim());};
  r.onerror=e=>setError(e.error==='not-allowed'||e.error==='service-not-allowed'?'Sin permiso de micrófono: escribe tu pregunta.':e.error==='no-speech'?'No te escuché. Toca de nuevo.':'No se pudo escuchar. Escribe tu pregunta.');
  r.onend=()=>{rec.current=null;setListening(false);setInterim('');const t=said.current.trim();said.current='';if(t)cb.current(t);};
  rec.current=r;setError(null);setListening(true);
  try{r.start();}catch{rec.current=null;setListening(false);setError('No se pudo abrir el micrófono.');}
 },[]);
 const stop=useCallback(()=>{try{rec.current?.stop();}catch{}},[]);
 useEffect(()=>()=>{try{rec.current?.abort();}catch{}},[]);
 return {supported,listening,interim,error,toggle:()=>listening?stop():start()};
}
