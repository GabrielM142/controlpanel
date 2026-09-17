import {ChartNoAxesCombined,Coins,Database,GitBranch,LayoutDashboard,LineChart,Mail,MessageSquare,Package,ShieldCheck,Sparkles,Users,Wand2,Wrench,Zap} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

export type MarketCategory='odoo'|'skills'|'automations'|'services';
export type MarketPrice={amount:number;setup?:number;monthly?:number;label:string};
export type MarketItem={
 id:string;
 category:MarketCategory;
 name:string;
 tagline:string;
 description:string;
 price:MarketPrice|null;
 tags:string[];
 icon:LucideIcon;
 highlight?:'nuevo'|'popular'|'bundle';
 delivery:string;
};

export const CATEGORY_META:Record<MarketCategory,{label:string;icon:LucideIcon;description:string}>={
 odoo:{label:'Módulos Odoo',icon:Package,description:'Extensiones certificadas para tu instancia de Odoo — SRI, facturación, POS, reportes.'},
 skills:{label:'Skills',icon:Sparkles,description:'Paquetes de expertise y consultoría con nuestro equipo especializado.'},
 automations:{label:'Automatizaciones',icon:Zap,description:'Bots, integraciones y flujos automáticos que ahorran horas al mes.'},
 services:{label:'Servicios',icon:Wrench,description:'Retainers, auditorías y paquetes de acompañamiento continuo.'},
};

const P=(amount:number,label:string,setup?:number,monthly?:number):MarketPrice=>({amount,label,setup,monthly});

// Catálogo de ejemplo — precios de referencia, se ajustan al conectar la ficha comercial.
export const marketCatalog:MarketItem[]=[
 // Módulos Odoo
 {id:'m-odoo-sri',category:'odoo',name:'Facturación electrónica SRI',tagline:'Cumple con la normativa de Ecuador',description:'Emisión de comprobantes electrónicos, firma digital, retenciones y libros. Actualizado con la Resolución 2025.',price:P(1800,'$1.800 setup + $80/mes',1800,80),tags:['SRI','Ecuador','facturación'],icon:ShieldCheck,highlight:'popular',delivery:'2 semanas'},
 {id:'m-odoo-crm',category:'odoo',name:'CRM Avanzado',tagline:'Pipeline comercial con IA',description:'Funnel visual por vendedor, scoring de leads, integración WhatsApp y reportes ejecutivos.',price:P(2500,'$2.500 setup + $150/mes',2500,150),tags:['CRM','ventas','pipeline'],icon:ChartNoAxesCombined,delivery:'3 semanas'},
 {id:'m-odoo-pos',category:'odoo',name:'POS conectado',tagline:'Terminal punto de venta online/offline',description:'POS con sincronización a Odoo, catálogo por sucursal y control de caja diario.',price:P(1200,'$1.200 setup',1200),tags:['POS','retail','sucursal'],icon:LayoutDashboard,delivery:'2 semanas'},
 {id:'m-odoo-multi',category:'odoo',name:'Inventarios multi-bodega',tagline:'Stock por sucursal, traslados y kits',description:'Gestión avanzada de bodegas con transferencias, mermas y kits de armado.',price:null,tags:['inventario','bodega','stock'],icon:Package,delivery:'A definir'},
 {id:'m-odoo-reports',category:'odoo',name:'Reportes personalizados',tagline:'Diseño a medida',description:'Reportes ejecutivos con branding del cliente, exportación a PDF/Excel y programación por correo.',price:P(880,'desde $880 por reporte'),tags:['reportes','pdf','gerencia'],icon:LineChart,delivery:'1 semana'},
 {id:'m-odoo-firma',category:'odoo',name:'Firma electrónica integrada',tagline:'Firma segura de documentos',description:'Firma digital con certificado del SRI directamente desde Odoo, con auditoría.',price:P(980,'$980 setup',980),tags:['firma','SRI','legal'],icon:ShieldCheck,delivery:'2 semanas'},

 // Skills
 {id:'sk-consult-comercial',category:'skills',name:'Consultoría Comercial',tagline:'10 horas de acompañamiento',description:'Diagnóstico comercial, plan de acción y capacitación con un experto en ventas B2B.',price:P(850,'$850 por bloque de 10h'),tags:['comercial','estrategia'],icon:Users,delivery:'2 semanas'},
 {id:'sk-precios',category:'skills',name:'Estrategia de precios',tagline:'Pricing dinámico por segmento',description:'Análisis de elasticidad, benchmark de mercado y recomendación de tabla de precios trimestral.',price:P(1500,'$1.500/mes retainer'),tags:['pricing','margen'],icon:Coins,highlight:'nuevo',delivery:'Mensual'},
 {id:'sk-cartera',category:'skills',name:'Optimización de cartera',tagline:'Reducir vencidos y DSO',description:'Auditoría de cartera, segmentación de clientes y armado de política de cobranza.',price:P(1200,'$1.200 proyecto único',1200),tags:['finanzas','cartera','DSO'],icon:LineChart,delivery:'3 semanas'},
 {id:'sk-sku',category:'skills',name:'Rentabilidad por SKU',tagline:'Análisis fino de mix',description:'Análisis ABC/XYZ, costos ocultos y recomendación de discontinuación o repricing.',price:P(2200,'$2.200 proyecto único',2200),tags:['SKU','rentabilidad','inventario'],icon:Package,delivery:'4 semanas'},
 {id:'sk-dashboard',category:'skills',name:'Dashboard ejecutivo a medida',tagline:'Panel gerencial personalizado',description:'Diseño e implementación de dashboard ejecutivo con métricas del negocio, conectado a Odoo.',price:P(3500,'$3.500 proyecto único',3500),tags:['dashboard','gerencia','odoo'],icon:LayoutDashboard,highlight:'bundle',delivery:'4-6 semanas'},

 // Automatizaciones
 {id:'a-wa-cartera',category:'automations',name:'Alertas de cartera por WhatsApp',tagline:'Notificaciones automáticas',description:'Bot que avisa a clientes por WhatsApp cuando su factura está por vencer o vencida.',price:P(650,'$650 setup + $30/mes',650,30),tags:['WhatsApp','cartera','bot'],icon:MessageSquare,highlight:'popular',delivery:'2 semanas'},
 {id:'a-sync-excel',category:'automations',name:'Sincronización Excel → Odoo',tagline:'Cargas masivas sin errores',description:'Robot que ingesta archivos Excel/CSV, valida y publica en Odoo con log de errores.',price:P(890,'$890 setup',890),tags:['excel','carga','odoo'],icon:Database,delivery:'2 semanas'},
 {id:'a-bot-pedidos',category:'automations',name:'Bot de pedidos por email',tagline:'Pedidos parseados automáticamente',description:'Lee correos de pedidos, extrae SKU y cantidades, y crea la orden en Odoo.',price:P(1500,'$1.500 setup + $60/mes',1500,60),tags:['email','pedidos','bot'],icon:Mail,delivery:'3 semanas'},
 {id:'a-slack',category:'automations',name:'Notificaciones ventas a Slack/Teams',tagline:'Métricas al equipo en tiempo real',description:'Envía KPIs comerciales diarios/semanales a un canal de Slack o Teams.',price:P(450,'$450 setup',450),tags:['slack','teams','notificaciones'],icon:Zap,delivery:'1 semana'},
 {id:'a-mail-reports',category:'automations',name:'Reportes por correo programados',tagline:'Informes automáticos por email',description:'Genera y envía reportes ejecutivos por correo según cronograma (diario, semanal, mensual).',price:P(380,'$380 setup',380),tags:['reportes','email','automático'],icon:Mail,delivery:'1 semana'},
 {id:'a-git-integraciones',category:'automations',name:'Integraciones a medida',tagline:'Conectá cualquier sistema',description:'Integraciones API entre Odoo y sistemas externos (banco, marketplace, courier, CRM externo).',price:null,tags:['API','integración','ETL'],icon:GitBranch,delivery:'A definir'},

 // Servicios
 {id:'s-nova-care',category:'services',name:'Nova Care · Soporte 20h/mes',tagline:'Soporte continuo con SLA',description:'20 horas mensuales de soporte técnico y funcional, SLA de respuesta 4h y priorización.',price:P(1200,'$1.200/mes',undefined,1200),tags:['soporte','SLA','retainer'],icon:ShieldCheck,highlight:'popular',delivery:'Onboarding en 1 semana'},
 {id:'s-audit',category:'services',name:'Auditoría anual del ERP',tagline:'Diagnóstico completo',description:'Revisión de configuración, seguridad, permisos, calidad de datos y plan de mejoras.',price:null,tags:['auditoría','ERP','anual'],icon:ChartNoAxesCombined,delivery:'4 semanas'},
 {id:'s-onboarding',category:'services',name:'Onboarding del equipo',tagline:'Puesta en marcha guiada',description:'Setup inicial, migración de datos, configuración por área y arranque con acompañamiento.',price:P(2200,'$2.200 proyecto único',2200),tags:['onboarding','arranque'],icon:Wand2,delivery:'3-4 semanas'},
 {id:'s-cap-odoo',category:'services',name:'Capacitación Odoo grupal',tagline:'Formación para tu equipo',description:'Programa de capacitación por rol (comercial, contable, logística) con material a medida.',price:P(1500,'$1.500 grupo de 10',1500),tags:['capacitación','equipo','odoo'],icon:Users,delivery:'2 semanas'},
];
