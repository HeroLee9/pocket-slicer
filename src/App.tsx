import {useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,Check,ChevronRight,Clock,Download,FileBox,FolderOpen,LoaderCircle,Settings,ShieldCheck,Spool,Upload,Wifi,X} from 'lucide-react';
import Viewer from './components/Viewer';
import PrintSettings from './components/PrintSettings';
import SettingsDialog from './components/SettingsDialog';
import {cubeModel,readModel,type Model} from './lib/model';
import ModelTools,{type ViewMode} from './components/ModelTools';
import AdvancedSettings from './components/AdvancedSettings';
import {applyOverrides,validateOverrides,type OrcaOverrides} from './lib/orca-settings';
import {DEFAULT_OBJECT_TRANSFORM,objectBounds,plateSTL,validatePlate,arrangePlate,layOnFace,PRESERVE_PLACEMENT_MATRIX,type PlateObject,type ObjectTransform} from './lib/geometry';
import {autoOrientAsync} from './lib/auto-orient';
import {DEFAULT_SETTINGS,buildConfig,getProfileSummary,resolveSettings,type PrintSettings as PrintSettingsType} from './profiles';
import {OrcaSlicerClient,type EngineProgress,type SliceResult} from './engine';
import type {GcodePreview} from './lib/gcode';
import {createGcodeFile,downloadGcode,exportGcode,isNativeFileExportAvailable} from './lib/export';
import {uploadGcode} from './lib/moonraker';

function storedSettings():PrintSettingsType {try{const previous=JSON.parse(localStorage.getItem('pocket-settings-v1')||'{}');if(!localStorage.getItem('pocket-defaults-v2')){previous.infillPattern='gyroid';previous.walls=Math.max(3,Number(previous.walls)||3);previous.startupMode='kamp';}return resolveSettings(previous);}catch{return {...DEFAULT_SETTINGS};}}
function storedOverrides():OrcaOverrides {try{const value=JSON.parse(localStorage.getItem('pocket-orca-overrides-v1')||'{}');return validateOverrides(value).length?{}:value;}catch{return {};}}
const firstNumber=(value:unknown)=>Number(Array.isArray(value)?value[0]:value);
type PlateHistory={present:PlateObject[];past:PlateObject[][];future:PlateObject[][]};
function storedAddress(){try{return localStorage.getItem('pocket-printer-v1')||'';}catch{return '';}}
function formatTime(seconds:number){const min=Math.max(1,Math.round(seconds/60));return min>=60?`${Math.floor(min/60)}h ${min%60}m`:`${min} min`;}

export default function App(){
  const [plate,setPlate]=useState<PlateHistory>({present:[],past:[],future:[]}),[selectedId,setSelectedId]=useState<string|null>(null),[settings,setSettings]=useState<PrintSettingsType>(storedSettings);
  const objects=plate.present,selected=objects.find(o=>o.id===selectedId)??objects[0],model=selected?.model??null;
  const [overrides,setOverrides]=useState<OrcaOverrides>(storedOverrides),[printMode,setPrintMode]=useState<'quick'|'all'>('quick'),[viewMode,setViewMode]=useState<ViewMode>('orbit'),[orienting,setOrienting]=useState(false);
  const ownedModels=useRef(new Set<Model>()),loadMode=useRef<'add'|'replace'>('add'),orientationAbort=useRef<AbortController|null>(null);
  const [tab,setTab]=useState<'model'|'print'|'preview'>('model'),[result,setResult]=useState<SliceResult|null>(null),[preview,setPreview]=useState<GcodePreview|null>(null),[layer,setLayer]=useState(1);
  const [loading,setLoading]=useState(false),[slicing,setSlicing]=useState(false),[previewBusy,setPreviewBusy]=useState(false),[progress,setProgress]=useState<EngineProgress>({stage:'',percent:null});
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[settingsOpen,setSettingsOpen]=useState(false),[uploading,setUploading]=useState(false),[engineReady,setEngineReady]=useState(false);
  const [connection,setConnection]=useState({url:storedAddress(),apiKey:''});
  const input=useRef<HTMLInputElement>(null),engine=useRef<OrcaSlicerClient|null>(null),abort=useRef<AbortController|null>(null),previewWorker=useRef<Worker|null>(null);
  useEffect(()=>()=>{engine.current?.dispose();previewWorker.current?.terminate();},[]);
  useEffect(()=>{const keep=new Set([...plate.present,...plate.past.flat(),...plate.future.flat()].map(o=>o.model));for(const model of ownedModels.current)if(!keep.has(model)){model.geometry.dispose();ownedModels.current.delete(model);}},[plate]);
  useEffect(()=>()=>{for(const model of ownedModels.current)model.geometry.dispose();orientationAbort.current?.abort();},[]);
  useEffect(()=>{try{resolveSettings(settings);localStorage.setItem('pocket-settings-v1',JSON.stringify(settings));localStorage.setItem('pocket-defaults-v2','1');}catch{/* browser storage is optional */}},[settings]);
  useEffect(()=>{try{localStorage.setItem('pocket-printer-v1',connection.url);}catch{/* browser storage is optional */}},[connection.url]);
  useEffect(()=>{try{applyOverrides(buildConfig(settings),overrides);localStorage.setItem('pocket-orca-overrides-v1',JSON.stringify(overrides));}catch{/* optional storage */}},[overrides,settings]);
  const dimensions=useMemo(()=>{if(!selected)return null;try{return objectBounds(selected.model,selected.transform).size;}catch{return null;}},[selected]);
  const configState=useMemo(()=>{let base:Record<string,unknown>;try{base=buildConfig(settings);}catch(e){return {base:buildConfig(),effective:buildConfig(),error:e instanceof Error?e.message:String(e)};}try{return {base,effective:applyOverrides(base,overrides),error:''};}catch(e){return {base,effective:base,error:e instanceof Error?e.message:String(e)};}},[settings,overrides]);
  const config=configState.effective;
  const plateCheck=useMemo(()=>objects.length?validatePlate(objects,{brim:String(config.brim_type)==='no_brim'?0:firstNumber(config.brim_width)||0}):{errors:[],warnings:[]},[objects,config]);
  const validation=configState.error||plateCheck.errors[0]||'';
  let summary;try{summary=getProfileSummary(settings);}catch{summary=getProfileSummary();}
  const layerHeight=firstNumber(config.layer_height),infill=String(config.sparse_infill_density);
  function invalidate(){setResult(null);setPreview(null);setError('');setMessage('');previewWorker.current?.terminate();setPreviewBusy(false);}
  function changeSettings(value:PrintSettingsType){
    invalidate();
    // Changing a quick control removes only the matching expert override.
    const keys:Partial<Record<keyof PrintSettingsType,string[]>>={infill:['sparse_infill_density'],infillPattern:['sparse_infill_pattern'],walls:['wall_loops'],support:['enable_support','support_type'],brim:['brim_type','brim_width'],layerHeight:['layer_height'],nozzleTemperature:['nozzle_temperature','nozzle_temperature_initial_layer'],bedTemperature:['cool_plate_temp','eng_plate_temp','hot_plate_temp','textured_plate_temp','textured_cool_plate_temp','supertack_plate_temp'].flatMap(k=>[k,k+'_initial_layer']),bedType:['curr_bed_type'],startupMode:['machine_start_gcode','gcode_label_objects','exclude_object']};
    setOverrides(current=>{const next={...current};for(const key of Object.keys(value) as (keyof PrintSettingsType)[])if(value[key]!==settings[key])for(const name of keys[key]??[])delete next[name];if(value.material!==settings.material){for(const key of Object.keys(next))if(key.startsWith('filament_')||key.includes('temperature')||key.includes('plate_temp')||key.includes('fan')||key.includes('cooling')||key.includes('pressure_advance')||key.startsWith('slow_down_')||key==='close_fan_the_first_x_layers')delete next[key];}if(value.nozzle!==settings.nozzle||value.quality!==settings.quality){for(const key of Object.keys(next))if(key.includes('line_width')||key==='layer_height'||key==='initial_layer_print_height'||key==='nozzle_diameter')delete next[key];}return next;});
    setSettings(value);
  }
  function commit(next:PlateObject[]){invalidate();setPlate(p=>({present:next,past:[...p.past,p.present].slice(-30),future:[]}));}
  function changeObject(id:string,patch:Partial<ObjectTransform>){commit(objects.map(o=>o.id===id?{...o,transform:{...o.transform,...patch}}:o));}
  function history(direction:'undo'|'redo'){invalidate();setPlate(p=>direction==='undo'&&p.past.length?{present:p.past.at(-1)!,past:p.past.slice(0,-1),future:[p.present,...p.future]}:direction==='redo'&&p.future.length?{present:p.future[0],past:[...p.past,p.present],future:p.future.slice(1)}:p);}
  function choose(mode:'add'|'replace'){loadMode.current=mode;input.current?.click();}
  async function load(files:File[]){setLoading(true);setError('');const imported:Model[]=[];try{
    if(objects.length+(loadMode.current==='replace'?-1:0)+files.length>20)throw new Error('Keep the plate to 20 models or fewer on a phone.');
    for(const file of files)imported.push(await readModel(file));
    const added=imported.map(model=>({id:crypto.randomUUID(),model,transform:{...DEFAULT_OBJECT_TRANSFORM}}));
    let next=[...(loadMode.current==='replace'?objects.filter(o=>o.id!==selected?.id):objects),...added];
    if(next.reduce((sum,o)=>sum+o.model.triangles,0)>1_000_000)throw new Error('The whole plate must stay under 1 million triangles for mobile slicing.');
    if(next.length>1){try{next=arrangePlate(next,{brim:firstNumber(config.brim_width)||0});}catch{/* Keep imports available for manual positioning. */}}
    imported.forEach(model=>ownedModels.current.add(model));commit(next);setSelectedId(added[0].id);setTab('model');setMessage(imported.map(m=>m.notice).filter(Boolean).join(' '));
  }catch(e){imported.forEach(m=>m.geometry.dispose());setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);if(input.current)input.current.value='';}}
  function demo(){const model=cubeModel();ownedModels.current.add(model);const object={id:crypto.randomUUID(),model,transform:{...DEFAULT_OBJECT_TRANSFORM}};commit([...objects,object]);setSelectedId(object.id);setTab('model');}
  function arrange(){try{commit(arrangePlate(objects,{brim:String(config.brim_type)==='no_brim'?0:firstNumber(config.brim_width)||0}));setMessage('Models arranged on the bed.');}catch(e){setError(e instanceof Error?e.message:String(e));}}
  function duplicate(){if(!selected)return;if(objects.length>=20||objects.reduce((n,o)=>n+o.model.triangles,0)+selected.model.triangles>1_000_000){setError('This plate has reached the mobile model or triangle limit.');return;}const object={...selected,id:crypto.randomUUID(),transform:{...selected.transform,positionX:selected.transform.positionX+10,positionY:selected.transform.positionY+10}};let next=[...objects,object];try{next=arrangePlate(next,{brim:firstNumber(config.brim_width)||0});}catch{}commit(next);setSelectedId(object.id);}
  async function orient(){if(!selected)return;setOrienting(true);setError('');orientationAbort.current=new AbortController();try{const result=await autoOrientAsync(selected.model,selected.transform,{signal:orientationAbort.current.signal,brim:firstNumber(config.brim_width)||0});changeObject(selected.id,result.transform);setMessage(`Orientation updated after checking ${result.summary.candidates} possible faces. Inspect contact and supports before printing.`);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setOrienting(false);orientationAbort.current=null;}}
  function face(id:string,index:number){const object=objects.find(o=>o.id===id);if(!object)return;try{changeObject(id,layOnFace(object.model,object.transform,index));setViewMode('orbit');setMessage('Selected face placed on the bed.');}catch(e){setError(e instanceof Error?e.message:String(e));}}
  async function slice(){
    if(!model||slicing||validation)return;
    invalidate();setSlicing(true);setProgress({stage:'Preparing model…',percent:null});
    let wakeLock:WakeLockSentinel|null=null;
    try{
      abort.current=new AbortController();
      try{wakeLock=await navigator.wakeLock?.request('screen')??null;}catch{/* optional */}
      engine.current??=new OrcaSlicerClient();
      if(!engineReady){await engine.current.initialize(setProgress);setEngineReady(true);}
      if(abort.current.signal.aborted)throw new Error('Slicing cancelled.');
      const next=await engine.current.slice({stl:plateSTL(objects),name:objects.length===1?model.name:'build-plate.stl',config,transform:PRESERVE_PLACEMENT_MATRIX},{onProgress:setProgress,signal:abort.current.signal});
      setResult(next);setTab('preview');setProgress({stage:'Slice complete',percent:100});setPreviewBusy(true);
      const worker=new Worker(new URL('./lib/gcode.worker.ts',import.meta.url),{type:'module'});previewWorker.current=worker;
      worker.onmessage=({data})=>{setPreviewBusy(false);worker.terminate();previewWorker.current=null;if(data.error)setMessage(`G-code is ready. Preview could not load: ${data.error}`);else{setPreview(data.preview);setLayer(data.preview.layers.length);}};
      worker.onerror=()=>{setPreviewBusy(false);setMessage('G-code is ready, but its preview could not load.');worker.terminate();previewWorker.current=null;};
      worker.postMessage(next.gcode);
    }catch(e){const text=e instanceof Error?e.message:String(e);if(abort.current?.signal.aborted||text.toLowerCase().includes('cancel'))setMessage('Slicing cancelled. Your model is unchanged.');else setError(text);}
    finally{setSlicing(false);await wakeLock?.release().catch(()=>{});abort.current=null;}
  }
  function cancel(){abort.current?.abort();if(!engineReady){engine.current?.dispose();engine.current=null;}else engine.current?.cancel();setProgress({stage:'Cancelling…',percent:null});}
  async function save(){if(!result)return;setError('');setMessage('');try{const r=await exportGcode(result.gcode as Uint8Array<ArrayBuffer>,result.name);if(r.method==='download')setMessage('Download requested. In Files, move the G-code to your USB drive.');else if(r.method==='native')setMessage('G-code saved to Files.');else if(r.method==='share')setMessage('G-code shared. Check your selected destination in Files.');}catch(e){setError(e instanceof Error?e.message:String(e));}}
  async function send(){if(!result)return;if(!connection.url){setSettingsOpen(true);return;}setUploading(true);setError('');try{const r=await uploadGcode(connection,result.gcode as Uint8Array<ArrayBuffer>,result.name);setMessage(`Uploaded ${r.item.path}. Open Fluidd or Mainsail to start the print.`);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setUploading(false);}}
  const seconds=result?.statistics?.timeSeconds?.normal;
  const printTime=seconds?formatTime(seconds):preview?.time||'—';
  const grams=result?.statistics?.filament?.totalMassG;
  const filament=grams?`${grams.toFixed(1)} g`:preview?.filamentGrams&&preview.filamentGrams!=='—'?`${preview.filamentGrams} g`:'—';
  const busy=slicing||loading||orienting;
  return <main className="app-shell"><header className="app-header"><div><h1>Pocket Slicer</h1><p>Creality K1C <span>·</span> {settings.nozzle} mm</p></div><button className="icon-button" onClick={()=>setSettingsOpen(true)} aria-label="Settings and help"><Settings size={24}/></button></header>
  {/* iOS Files can misclassify model types; validate the selected file in readModel. */}
  <input ref={input} data-testid="model-file" type="file" multiple hidden onChange={e=>{const files=Array.from(e.target.files??[]);if(files.length)void load(files);}}/>
  <div className="workspace"><section className="model-region" aria-label="3D model preview" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files.length){loadMode.current='add';void load(Array.from(e.dataTransfer.files));}}}><Viewer objects={objects} selectedId={selected?.id??null} onSelect={setSelectedId} onMove={changeObject} onFace={face} mode={viewMode} onMode={setViewMode} disabled={busy} preview={preview} layer={layer} showPreview={tab==='preview'&&!!result} dimensions={dimensions}/><div className="canvas-caption"><span>Tap to select · orbit or move in the view</span><span>{objects.length?`${objects.reduce((n,o)=>n+o.model.triangles,0).toLocaleString()} triangles`:'STL · OBJ · 3MF'}</span></div></section>
  <section className="control-region"><nav className="tabs" aria-label="Slicer views">{(['model','print','preview'] as const).map(v=><button key={v} aria-current={tab===v?'page':undefined} className={tab===v?'active':''} onClick={()=>setTab(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</nav>
  <div className="panel">
    {tab==='model'&&<>{!model?<div className="import-panel"><FolderOpen size={30} strokeWidth={1.4}/><h2>Choose a model</h2><p>Open files from your iPhone, iCloud Drive, or USB drive.</p><button className="primary" onClick={()=>choose('add')} disabled={busy}><Upload size={18}/>{loading?'Opening…':'Import model'}</button><button className="text-button" onClick={demo} disabled={busy}>Try a 20 mm cube <ChevronRight size={16}/></button><span className="hint">STL, OBJ, or 3MF · up to 50 MB per file</span></div>:<ModelTools objects={objects} selectedId={selected?.id??null} onSelect={setSelectedId} onAdd={()=>choose('add')} onReplace={()=>choose('replace')} onDuplicate={duplicate} onDelete={()=>{commit(objects.filter(o=>o.id!==selected?.id));setSelectedId(null);}} onChange={t=>selected&&changeObject(selected.id,t)} onError={setError} onArrange={arrange} onOrient={orient} onUndo={()=>history('undo')} onRedo={()=>history('redo')} canUndo={plate.past.length>0} canRedo={plate.future.length>0} mode={viewMode} onMode={setViewMode} disabled={busy} orienting={orienting} dimensions={dimensions}/>}</>}
    {tab==='print'&&<><div className="settings-tabs"><button aria-pressed={printMode==='quick'} onClick={()=>setPrintMode('quick')}>Quick settings</button><button aria-pressed={printMode==='all'} onClick={()=>setPrintMode('all')}>All Orca settings</button></div>{printMode==='quick'?<>{Object.keys(overrides).length>0&&<div className="override-notice">{Object.keys(overrides).length} expert overrides are active. The effective settings appear in All Orca settings.</div>}<PrintSettings value={settings} onChange={changeSettings} disabled={busy}/></>:<AdvancedSettings baseConfig={configState.base} overrides={overrides} onChange={value=>{invalidate();setOverrides(value);}} disabled={busy}/>}</>}
    {tab==='preview'&&<>{result?<><div className="statistics"><div><Clock size={24}/><span>Print time<strong>{printTime}</strong></span></div><div><Spool size={24}/><span>Filament<strong>{filament}</strong></span></div></div>{previewBusy&&<p className="notice"><LoaderCircle size={16} className="spin"/> Building layer preview…</p>}{preview&&preview.layers.length>0&&<div className="layer-control"><div><label htmlFor="layer">Layer {layer} / {preview.layers.length}</label><span>{preview.layers[layer-1]?.z.toFixed(2)} mm</span></div><input id="layer" type="range" min="1" max={preview.layers.length} value={layer} onChange={e=>setLayer(Number(e.target.value))}/><div className="legend"><span><i style={{background:'#246bfd'}}/>Walls</span><span><i style={{background:'#f59e2b'}}/>Infill</span><span><i style={{background:'#3dbb78'}}/>Supports</span></div></div>}{preview?.truncated&&<p className="hint">Preview is limited to 750,000 segments to save memory. The exported G-code contains the full print.</p>}<div className="result-file"><FileBox size={18}/><span>{result.name}</span><span>{(result.gcode.byteLength/1024/1024).toFixed(2)} MB</span></div><button className="primary" onClick={save}><Download size={19}/>Save G-code</button><button className="secondary" onClick={send} disabled={uploading}>{uploading?<LoaderCircle size={18} className="spin"/>:<Wifi size={18}/>} {uploading?'Uploading…':'Send to printer'}</button>{!isNativeFileExportAvailable()&&<button className="text-button download-link" onClick={()=>{downloadGcode(createGcodeFile(result.gcode as Uint8Array<ArrayBuffer>,result.name));setMessage('Download requested. Check Files for your G-code.');}}>Download G-code instead</button>}<p className="save-hint">{isNativeFileExportAvailable()?'Choose your USB drive in Files.':'On iPhone: Save to Files → your USB drive.'}</p><p className="hint">Estimates come from Orca. Preview the first layers before printing.</p></>:<div className="empty-preview"><Spool size={32} strokeWidth={1.3}/><h2>See every layer</h2><p>Slice your model to preview its toolpaths and save G-code.</p></div>}</>}
    {plateCheck.warnings.map((warning,i)=><p className="notice plate-warning" key={i}>{warning}</p>)}
    {validation&&<p className="error" role="alert"><AlertCircle size={18}/>{validation}</p>}
    {error&&<div className="error" role="alert"><AlertCircle size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></div>}
    {message&&<p className="notice" role="status">{message}</p>}
    {slicing&&<div className="slice-progress" role="status"><div><LoaderCircle size={17} className="spin"/><span>{progress.stage}</span><strong>{progress.percent!==null?`${Math.round(progress.percent)}%`:''}</strong></div><progress max="100" value={progress.percent??undefined}/><p>Keep this app open while slicing.</p><button className="secondary" onClick={cancel}>Cancel slicing</button></div>}
    {!slicing&&model&&!(tab==='preview'&&result)&&<div className="slice-action"><button className="primary" disabled={busy||!!validation} onClick={slice}>{loading?<LoaderCircle size={18} className="spin"/>:<Spool size={19}/>}{objects.length>1?'Slice plate':'Slice model'}</button><span>{settings.material} · {layerHeight||summary.layerHeight} mm · {infill} infill</span></div>}
    <footer><ShieldCheck size={17}/><span>Slicing stays on this device</span>{engineReady&&<Check size={14}/>}</footer>
  </div></section></div><SettingsDialog open={settingsOpen} onClose={()=>setSettingsOpen(false)} connection={connection} onConnection={setConnection}/></main>;
}
