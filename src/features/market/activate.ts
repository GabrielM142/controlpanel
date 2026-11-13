import type {MarketItem} from './data';

/** "Activar" fuera del Market: mismo flujo actual (abre Factory con el nombre precargado). No registra nada ni confirma. */
export function activateSkill(item:MarketItem,onNavigate:(id:string)=>void){
 try{sessionStorage.setItem('nova.factory.prefill',item.name);}catch{}
 window.dispatchEvent(new CustomEvent('report-notice',{detail:`${item.name}: completa la solicitud en Factory. Aún no se registró nada.`}));
 onNavigate('trueque');
}
