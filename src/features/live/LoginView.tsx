import {useState,type FormEvent} from 'react';
import {Loader2,LogIn} from 'lucide-react';
import {useLive} from './LiveData';

export default function LoginView(){
 const {login}=useLive();
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const submit=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setError(null);
  try{await login(email,password);}catch(err){setError((err as Error).message);}finally{setBusy(false);}
 };
 return <main className="login-shell">
  <form className="panel login-card" onSubmit={submit}>
   <div className="omega-brand"><span className="omega-mark" aria-hidden="true">Ω</span><div><strong>OMEGA</strong><small>La última palabra en tus datos</small></div></div>
   <label className="filter"><span>Correo</span><input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label className="filter"><span>Contraseña</span><input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {error&&<p className="block-missing" role="alert">{error}</p>}
   <button className="button primary" disabled={busy}>{busy?<Loader2 size={14} className="spin"/>:<LogIn size={14}/>}Ingresar</button>
   <p className="legend-note">El acceso a cada empresa se valida en el servidor según tu membresía.</p>
  </form>
 </main>;
}
