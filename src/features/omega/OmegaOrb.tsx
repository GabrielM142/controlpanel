import {Mic} from 'lucide-react';

// Orbe de Omega con micrófono y onda de voz. La escucha real (Web Speech API) llega en M7;
// sin soporte o sin permiso, el botón abre el chat de texto. Nunca graba sin que el usuario pulse.
export default function OmegaOrb({listening,onPress,label}:{listening:boolean;onPress:()=>void;label:string}){
 return <div className="mx-orb-row">
  <button type="button" className={`mx-orb${listening?' is-on':''}`} aria-pressed={listening} aria-label={listening?'Dejar de escuchar':'Hablar con Omega'} onClick={onPress}><Mic size={24} strokeWidth={1.8} aria-hidden="true"/></button>
  <div className="mx-orb-text"><strong className="mx-hud-title">OMEGA</strong><span>{label}</span></div>
  <span className={`om-wave mx-orb-wave${listening?'':' is-idle'}`} aria-hidden="true"><i/><i/><i/><i/><i/></span>
 </div>;
}
