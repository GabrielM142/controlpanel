import {CalendarRange,Gauge,Layers3,ListTodo,Radar,Signature,Sparkles,Store,type LucideIcon} from 'lucide-react';

// Fase M · navegación por portales (FASE_DISENO_CENTRO_MANDO.md §2). Solo agrupa: cada reporte
// y cada vista conservan su id, ruta, filtros y opciones. Mando y Omega abren directo su vista;
// el resto abre su página de portal (id "portal-<portal>") con las vistas como tarjetas.
export type PortalId='mando'|'inteligencia'|'unidades'|'planificacion'|'decisiones'|'omega'|'market'|'espacio';
export type Portal={id:PortalId;label:string;icon:LucideIcon;ids:string[];direct?:string;question:string;mobile?:boolean};

export const PORTALS:Portal[]=[
 {id:'mando',label:'Mando',icon:Gauge,ids:['nivel1'],direct:'nivel1',mobile:true,question:'¿Cómo está la empresa ahora mismo?'},
 {id:'inteligencia',label:'Inteligencia',icon:Radar,mobile:true,ids:['comercial','financiero','compras','inventarios','clientes','logistica','marketing','riesgos','bodegas','iris'],
  question:'¿Dónde gano, dónde pierdo y qué está cambiando en cada área?'},
 {id:'unidades',label:'Unidades',icon:Layers3,ids:['mayoristahogar','mayoristaintorno','retailjuj','retailintorno'],question:'¿Cómo va cada unidad de negocio?'},
 {id:'planificacion',label:'Planificación',icon:CalendarRange,ids:['flujo','presupuesto'],question:'¿Cuánta caja y cuánta venta espero, y contra qué meta?'},
 {id:'decisiones',label:'Decisiones',icon:Signature,mobile:true,ids:['decisiones','tickets','notificaciones'],question:'¿Qué espera mi firma, mi respuesta o mi revisión hoy?'},
 {id:'omega',label:'Omega',icon:Sparkles,ids:['omega'],direct:'omega',question:'Pregúntale a Omega sobre toda tu data.'},
 {id:'market',label:'Market',icon:Store,mobile:true,ids:['market','market-odoo','market-skills','market-automations','market-services','trueque','trueque-list'],
  question:'¿Qué módulos, skills o servicios necesita tu empresa?'},
 {id:'espacio',label:'Mi espacio',icon:ListTodo,ids:['tasks','notes'],question:'Tus tareas y notas personales.'},
];
/** Ajustes y Super admin van en el menú del avatar. */
export const SETTINGS_IDS=['control','tema','truekens','insumos','omega-ia','sources'];
export const ADMIN_IDS=['plataforma'];

export const portalPageId=(p:PortalId)=>`portal-${p}`;
export const portalEntry=(p:Portal)=>p.direct||portalPageId(p.id);
export const PORTAL_PAGE_IDS=PORTALS.filter(p=>!p.direct).map(p=>portalPageId(p.id));
export const portalById=new Map(PORTALS.map(p=>[p.id,p]));

/** Portal al que pertenece una vista; los ajustes devuelven null. */
export function portalOf(viewId:string):Portal|null{
 if(viewId.startsWith('portal-'))return portalById.get(viewId.slice(7) as PortalId)||null;
 return PORTALS.find(p=>p.ids.includes(viewId))||null;
}

const LAST='nova.portal';
export const rememberPortal=(p:PortalId)=>{try{localStorage.setItem(LAST,p);}catch{}};
export const lastPortal=():PortalId|null=>{try{const v=localStorage.getItem(LAST);return portalById.has(v as PortalId)?v as PortalId:null;}catch{return null;}};
