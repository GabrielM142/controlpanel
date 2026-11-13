import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {AlertTriangle,CheckCircle2,ImagePlus,Loader2,Lock} from 'lucide-react';
import {useTenants} from '../tenants/useTenants';
import {ConfirmDialog,Eyebrow} from '../omega/ui';
import {FINANCIAL,LOGO_MAX_BYTES,SWATCHES,hueClash,onBrandFor,swatchHex,useBrandTheme,type BrandMode} from './useBrandTheme';

const MODES:{id:BrandMode;label:string}[]=[{id:'dark',label:'Oscuro'},{id:'light',label:'Claro'},{id:'auto',label:'Automático'}];
const finDot=(token:string)=>`om-dot-${token.replace('--fin-','')}`;

/** Configuración › Tema de la empresa. Solo cambia la marca (envase); los colores financieros no se tocan. */
export default function ThemeView(){
 const {active}=useTenants();
 const {theme,save,reset,shared,canEdit}=useBrandTheme();
 const [saveError,setSaveError]=useState<string|null>(null);
 const [color,setColor]=useState(theme.brandColor);
 const [mode,setMode]=useState<BrandMode>(theme.mode);
 const [saving,setSaving]=useState(false);
 const [saved,setSaved]=useState(false);
 const [confirmClash,setConfirmClash]=useState(false);
 const [logo,setLogo]=useState<string|undefined>(theme.logo);
 const [logoError,setLogoError]=useState<string|null>(null);
 const fileRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{setColor(theme.brandColor);setMode(theme.mode);setLogo(theme.logo);},[theme]);
 const pickLogo=(f?:File)=>{
  setLogoError(null);if(!f)return;
  if(!['image/png','image/svg+xml'].includes(f.type)){setLogoError('Usa un archivo SVG o PNG.');return;}
  if(f.size>LOGO_MAX_BYTES){setLogoError('El logo debe pesar menos de 200 KB.');return;}
  const r=new FileReader();r.onload=()=>setLogo(String(r.result));r.onerror=()=>setLogoError('No se pudo leer el archivo.');r.readAsDataURL(f);
 };

 const check=useMemo(()=>({...onBrandFor(color),clash:hueClash(color)}),[color]);
 const swatches=useMemo(()=>SWATCHES.map(s=>({...s,hex:swatchHex(s.id)})),[]);
 const dirty=color!==theme.brandColor||mode!==theme.mode||logo!==theme.logo;

 const doSave=()=>{setSaving(true);setSaved(false);setSaveError(null);save({brandColor:color,mode,logo}).then(()=>setSaved(true),e=>setSaveError((e as Error).message)).finally(()=>setSaving(false));};
 const onSave=()=>{if(check.clash)setConfirmClash(true);else doSave();};

 const preview={'--brand':color,'--on-brand':check.on} as CSSProperties;
 return <div className="om-theme">
  <header className="om-theme-head">
   <div><h2 className="om-headline om-headline--sm">Tema de {active.name}</h2>
    <p className="om-muted">Elige el color de tu marca. OMEGA revisa el contraste y que no se confunda con los colores financieros.</p></div>
   <div className="om-theme-actions">
    <button type="button" className="om-btn om-btn--ghost" onClick={()=>{reset().catch(e=>setSaveError((e as Error).message));setSaved(false);}}>Restablecer</button>
    <button type="button" className="om-btn om-btn--gold" onClick={onSave} disabled={saving||!dirty} aria-busy={saving}>{saving?<Loader2 size={15} className="om-spin" aria-hidden="true"/>:null}{saving?'Guardando…':saved&&!dirty?'Guardado':'Guardar tema'}</button>
    {saveError&&<p className="legend-note om-ai-error" role="alert">{saveError}</p>}
    {shared&&!canEdit&&<p className="legend-note">El color y el logo de la empresa los cambia un administrador; aquí puedes elegir tu modo claro u oscuro.</p>}
   </div>
  </header>

  <div className="om-theme-grid">
   <section className="om-theme-settings" aria-label="Ajustes del tema">
    <div className="om-card">
     <strong className="om-theme-title">Color de marca</strong>
     <div role="radiogroup" aria-label="Color de marca" className="om-swatches">
      {swatches.map(s=><button key={s.id} type="button" role="radio" aria-checked={color===s.hex} aria-label={s.name} className={`om-swatch${color===s.hex?' is-on':''}`} onClick={()=>setColor(s.hex)}>
       <span className="om-swatch-chip" style={{background:`var(--swatch-${s.id})`}} aria-hidden="true"/>
       <span className="om-swatch-name">{s.name}</span><code>{s.hex}</code>
      </button>)}
     </div>
     <label className="om-custom-color"><span>Otro color</span><input type="color" value={color} onChange={e=>setColor(e.target.value.toLowerCase())} aria-label="Elegir otro color de marca"/><code>{color}</code></label>
    </div>

    <div className={`om-card om-theme-check${check.clash||check.ratio<4.5?' is-warn':''}`}>
     <strong className="om-theme-title">Revisión automática</strong>
     <p className="om-check-row">{check.ratio>=4.5?<CheckCircle2 size={18} className="om-check-ok" aria-hidden="true"/>:<AlertTriangle size={18} className="om-check-warn" aria-hidden="true"/>}
      <span><strong>Contraste {check.ratio.toFixed(1)}:1</strong> · los botones usarán texto {check.name}. {check.ratio>=4.5?'Cumple AA.':'No llega a 4.5:1: elige un tono más claro u oscuro.'}</span></p>
     <p className="om-check-row">{check.clash?<AlertTriangle size={18} className="om-check-warn" aria-hidden="true"/>:<CheckCircle2 size={18} className="om-check-ok" aria-hidden="true"/>}
      <span>{check.clash?<>Se parece al color de <strong>{check.clash}</strong>. Podría confundirse con un dato financiero.</>:'No se confunde con ningún color financiero.'}</span></p>
    </div>

    <div className="om-card">
     <strong className="om-theme-title">Apariencia</strong>
     <div className="segmented om-mode" role="group" aria-label="Modo">{MODES.map(m=><button key={m.id} type="button" aria-pressed={mode===m.id} onClick={()=>setMode(m.id)}>{m.label}</button>)}</div>
     <div className="om-logo-row"><span className="om-logo-slot">{logo?<img src={logo} alt="Logo actual de la empresa"/>:<ImagePlus size={20} aria-hidden="true"/>}</span>
      <span className="om-muted">Logo de la empresa (SVG o PNG, hasta 200 KB). Se muestra junto a la Ω de OMEGA{shared?' y lo ven todos los usuarios de la empresa':' y se guarda en este navegador'}.</span>
      <input ref={fileRef} type="file" accept="image/png,image/svg+xml" className="om-sr" aria-label="Elegir archivo de logo" onChange={e=>{pickLogo(e.target.files?.[0]);e.target.value='';}}/>
      <div className="om-logo-actions"><button type="button" className="om-btn om-btn--ghost" onClick={()=>fileRef.current?.click()}>{logo?'Cambiar logo':'Subir logo'}</button>
      {logo&&<button type="button" className="om-btn om-btn--ghost" onClick={()=>setLogo(undefined)}>Quitar</button>}</div></div>
     {logoError&&<p className="om-check-row" role="alert"><AlertTriangle size={16} className="om-check-warn" aria-hidden="true"/>{logoError}</p>}
    </div>

    <div className="om-card om-locked">
     <strong className="om-theme-title"><Lock size={15} aria-hidden="true"/> Colores financieros (fijos para todas las empresas)</strong>
     <div className="om-locked-grid">{FINANCIAL.map(f=><span key={f.token}><i className={finDot(f.token)} aria-hidden="true"/><span><strong>{f.label}</strong><small>{f.why}</small></span></span>)}</div>
    </div>
   </section>

   <section className="om-theme-preview" aria-label="Vista previa en vivo">
    <Eyebrow>Vista previa en vivo</Eyebrow>
    <div className="om-pv" style={preview} data-pv-mode={mode==='light'?'light':'dark'}>
     <div className="om-pv-side"><span className="om-pv-logo">Ω</span>{logo&&<img className="om-pv-co" src={logo} alt=""/>}<span className="om-pv-nav is-on"/><span className="om-pv-nav"/><span className="om-pv-nav"/><span className="om-pv-nav"/></div>
     <div className="om-pv-main">
      <div className="om-pv-top"><span className="om-eyebrow">Briefing</span><span className="om-pv-cta">Presentar</span></div>
      <span className="om-pv-title">Tu cierre en una mirada.</span>
      <div className="om-pv-row">
       <svg width="90" height="90" viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="60" fill="none" className="om-pv-track" strokeWidth="14"/><circle cx="75" cy="75" r="60" fill="none" stroke="var(--brand)" strokeWidth="14" strokeLinecap="round" strokeDasharray="256 377" transform="rotate(-90 75 75)"/><text x="75" y="88" textAnchor="middle" className="om-pv-num">68</text></svg>
       <div className="om-pv-kpis"><span className="om-pv-kpi om-kpi--income">Ingresos<strong>A favor</strong></span><span className="om-pv-kpi om-kpi--loss">Utilidad<strong>En contra</strong></span><span className="om-pv-kpi om-kpi--cash">Caja<strong>Liquidez</strong></span><span className="om-pv-kpi om-kpi--goal">Meta<strong>Presupuesto</strong></span></div>
      </div>
      <p className="om-muted">La marca solo pinta el envase; los datos siempre usan los colores financieros.</p>
     </div>
    </div>
    <div className="om-legend-box om-legend-box--theme" aria-label="Código de color">
     <span className="om-eyebrow">Código de color de los datos</span>
     {[['income','Ingresos · a favor'],['loss','Costos y pérdidas'],['goal','Meta y presupuesto'],['cash','Caja y liquidez'],['risk','Riesgo · por vencer'],['ai','Omega IA']].map(([k,l])=><span key={k} className="om-legend-item"><i className={`om-dot-${k}`} aria-hidden="true"/>{l}</span>)}
    </div>
   </section>
  </div>
  <ConfirmDialog open={confirmClash} title="¿Guardar un color parecido a un dato?" body={`Tu color de marca se parece al de ${check.clash||''}. Los gerentes podrían confundirlo con una cifra financiera.`}
   confirmLabel="Guardar igual" onCancel={()=>setConfirmClash(false)} onConfirm={()=>{setConfirmClash(false);doSave();}}/>
 </div>;
}
