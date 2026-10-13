import {useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,Check,ChevronRight,Clock,Download,FileBox,FolderOpen,LoaderCircle,RefreshCw,RotateCcw,Settings,ShieldCheck,Spool,Upload,Wifi,X} from 'lucide-react';
import Viewer from './components/Viewer';
import PrintSettings from './components/PrintSettings';
import SettingsDialog from './components/SettingsDialog';
import {cubeModel,DEFAULT_TRANSFORM,modelDimensions,modelSTL,readModel,type Model,type Transform} from './lib/model';
import {DEFAULT_SETTINGS,buildConfig,getProfileSummary,resolveSettings,type PrintSettings as PrintSettingsType} from './profiles';
import {OrcaSlicerClient,type EngineProgress,type SliceResult} from './engine';
import type {GcodePreview} from './lib/gcode';
import {createGcodeFile,downloadGcode,exportGcode,isNativeFileExportAvailable} from './lib/export';
import {uploadGcode} from './lib/moonraker';

function storedSettings():PrintSettingsType {try{return resolveSettings(JSON.parse(localStorage.getItem('pocket-settings-v1')||'{}'));}catch{return {...DEFAULT_SETTINGS};}}
function storedAddress(){try{return localStorage.getItem('pocket-printer-v1')||'';}catch{return '';}}
function formatTime(seconds:number){const min=Math.max(1,Math.round(seconds/60));return min>=60?`${Math.floor(min/60)}h ${min%60}m`:`${min} min`;}

export default function App(){
  const [model,setModel]=useState<Model|null>(null),[transform,setTransform]=useState<Transform>({...DEFAULT_TRANSFORM}),[settings,setSettings]=useState<PrintSettingsType>(storedSettings);
  const [tab,setTab]=useState<'model'|'print'|'preview'>('model'),[result,setResult]=useState<SliceResult|null>(null),[preview,setPreview]=useState<GcodePreview|null>(null),[layer,setLayer]=useState(1);
  const [loading,setLoading]=useState(false),[slicing,setSlicing]=useState(false),[previewBusy,setPreviewBusy]=useState(false),[progress,setProgress]=useState<EngineProgress>({stage:'',percent:null});
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[settingsOpen,setSettingsOpen]=useState(false),[uploading,setUploading]=useState(false),[engineReady,setEngineReady]=useState(false);
  const [connection,setConnection]=useState({url:storedAddress(),apiKey:''});
  const input=useRef<HTMLInputElement>(null),engine=useRef<OrcaSlicerClient|null>(null),abort=useRef<AbortController|null>(null),previewWorker=useRef<Worker|null>(null);
  useEffect(()=>()=>{engine.current?.dispose();previewWorker.current?.terminate();},[]);
  useEffect(()=>()=>{model?.geometry.dispose();},[model]);
  useEffect(()=>{try{localStorage.setItem('pocket-settings-v1',JSON.stringify(settings));}catch{/* browser storage is optional */}},[settings]);
  useEffect(()=>{try{localStorage.setItem('pocket-printer-v1',connection.url);}catch{/* browser storage is optional */}},[connection.url]);
  const dimensions=useMemo(()=>{if(!model)return null;try{return modelDimensions(model,transform);}catch{return null;}},[model,transform]);
  let validation='';try{buildConfig(settings);if(model&&!dimensions)validation='Enter a valid scale and rotation.';const clearance=settings.brim>0?settings.brim+0.5:0.5;if(dimensions&&(dimensions[0]+2*clearance>220||dimensions[1]+2*clearance>220||dimensions[2]>250))validation='The model and brim need more room than the K1C bed allows. Reduce scale or brim width.';}catch(e){validation=e instanceof Error?e.message:String(e);}
  let summary;try{summary=getProfileSummary(settings);}catch{summary=getProfileSummary();}
  function invalidate(){setResult(null);setPreview(null);setError('');setMessage('');previewWorker.current?.terminate();setPreviewBusy(false);}
  function changeSettings(value:PrintSettingsType){invalidate();setSettings(value);}
  function changeTransform(value:Transform){invalidate();setTransform(value);}
  async function load(file:File){setLoading(true);setError('');try{const next=await readModel(file);invalidate();setModel(next);setTransform({...DEFAULT_TRANSFORM});setTab('model');setMessage(next.notice||'');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);if(input.current)input.current.value='';}}
  function demo(){invalidate();setModel(cubeModel());setTransform({...DEFAULT_TRANSFORM});setTab('model');}
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
      const next=await engine.current.slice({stl:modelSTL(model,transform),name:model.name,config:buildConfig(settings)},{onProgress:setProgress,signal:abort.current.signal});
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
  const busy=slicing||loading;
  return <main className="app-shell"><header className="app-header"><div><h1>Pocket Slicer</h1><p>Creality K1C <span>·</span> {settings.nozzle} mm</p></div><button className="icon-button" onClick={()=>setSettingsOpen(true)} aria-label="Settings and help"><Settings size={24}/></button></header>
  {/* iOS Files can misclassify model types; validate the selected file in readModel. */}
  <input ref={input} type="file" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void load(f);}}/>
  <div className="workspace"><section className="model-region" aria-label="3D model preview" onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files[0])void load(e.dataTransfer.files[0]);}}><Viewer model={model} transform={transform} preview={preview} layer={layer} showPreview={tab==='preview'&&!!result} dimensions={dimensions}/><div className="canvas-caption"><span>Drag to orbit · pinch to zoom</span><span>{model?`${model.triangles.toLocaleString()} triangles`:'STL · OBJ · 3MF'}</span></div></section>
  <section className="control-region"><nav className="tabs" aria-label="Slicer views">{(['model','print','preview'] as const).map(v=><button key={v} aria-current={tab===v?'page':undefined} className={tab===v?'active':''} onClick={()=>setTab(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</nav>
  <div className="panel">
    {tab==='model'&&<>{!model?<div className="import-panel"><FolderOpen size={30} strokeWidth={1.4}/><h2>Choose a model</h2><p>Open a file from your iPhone, iCloud Drive, or USB drive.</p><button className="primary" onClick={()=>input.current?.click()} disabled={busy}><Upload size={18}/>{loading?'Opening…':'Import model'}</button><button className="text-button" onClick={demo} disabled={busy}>Try a 20 mm cube <ChevronRight size={16}/></button><span className="hint">STL, OBJ, or 3MF · up to 50 MB</span></div>:<><div className="file-row"><FileBox size={22}/><div><strong title={model.name}>{model.name}</strong><span>{dimensions?.map(v=>v.toFixed(1)).join(' × ')} mm</span></div><button className="icon-button" aria-label="Replace model" title="Replace model" onClick={()=>input.current?.click()} disabled={busy}><RefreshCw size={19}/></button></div><fieldset disabled={busy} className="transform-panel"><label className="transform-row"><span>Scale</span><input aria-label="Scale percent" type="number" min="0.1" max="10000" step="1" value={Number.isFinite(transform.scale)?transform.scale:''} onChange={e=>changeTransform({...transform,scale:e.target.valueAsNumber})}/><span className="unit">%</span></label><div className="rotation-heading">Rotate</div>{(['x','y','z'] as const).map(axis=><label className="transform-row rotation-row" key={axis}><span className={`axis-${axis}`}>{axis.toUpperCase()}</span><input aria-label={`Rotate ${axis.toUpperCase()} degrees`} type="number" step="90" value={Number.isFinite(transform[axis])?transform[axis]:''} onChange={e=>changeTransform({...transform,[axis]:e.target.valueAsNumber})}/><span className="unit">°</span></label>)}<button type="button" className="text-button reset-model" onClick={()=>changeTransform({...DEFAULT_TRANSFORM})}><RotateCcw size={15}/>Reset transform</button></fieldset><p className="hint">The model is centered on the bed and placed flat on its lowest point. Mesh dimensions are interpreted in millimeters.</p></>}</>}
    {tab==='print'&&<PrintSettings value={settings} onChange={changeSettings} disabled={busy}/>}
    {tab==='preview'&&<>{result?<><div className="statistics"><div><Clock size={24}/><span>Print time<strong>{printTime}</strong></span></div><div><Spool size={24}/><span>Filament<strong>{filament}</strong></span></div></div>{previewBusy&&<p className="notice"><LoaderCircle size={16} className="spin"/> Building layer preview…</p>}{preview&&preview.layers.length>0&&<div className="layer-control"><div><label htmlFor="layer">Layer {layer} / {preview.layers.length}</label><span>{preview.layers[layer-1]?.z.toFixed(2)} mm</span></div><input id="layer" type="range" min="1" max={preview.layers.length} value={layer} onChange={e=>setLayer(Number(e.target.value))}/><div className="legend"><span><i style={{background:'#246bfd'}}/>Walls</span><span><i style={{background:'#f59e2b'}}/>Infill</span><span><i style={{background:'#3dbb78'}}/>Supports</span></div></div>}{preview?.truncated&&<p className="hint">Preview is limited to 750,000 segments to save memory. The exported G-code contains the full print.</p>}<div className="result-file"><FileBox size={18}/><span>{result.name}</span><span>{(result.gcode.byteLength/1024/1024).toFixed(2)} MB</span></div><button className="primary" onClick={save}><Download size={19}/>Save G-code</button><button className="secondary" onClick={send} disabled={uploading}>{uploading?<LoaderCircle size={18} className="spin"/>:<Wifi size={18}/>} {uploading?'Uploading…':'Send to printer'}</button>{!isNativeFileExportAvailable()&&<button className="text-button download-link" onClick={()=>{downloadGcode(createGcodeFile(result.gcode as Uint8Array<ArrayBuffer>,result.name));setMessage('Download requested. Check Files for your G-code.');}}>Download G-code instead</button>}<p className="save-hint">{isNativeFileExportAvailable()?'Choose your USB drive in Files.':'On iPhone: Save to Files → your USB drive.'}</p><p className="hint">Estimates come from Orca. Preview the first layers before printing.</p></>:<div className="empty-preview"><Spool size={32} strokeWidth={1.3}/><h2>See every layer</h2><p>Slice your model to preview its toolpaths and save G-code.</p></div>}</>}
    {validation&&<p className="error" role="alert"><AlertCircle size={18}/>{validation}</p>}
    {error&&<div className="error" role="alert"><AlertCircle size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></div>}
    {message&&<p className="notice" role="status">{message}</p>}
    {slicing&&<div className="slice-progress" role="status"><div><LoaderCircle size={17} className="spin"/><span>{progress.stage}</span><strong>{progress.percent!==null?`${Math.round(progress.percent)}%`:''}</strong></div><progress max="100" value={progress.percent??undefined}/><p>Keep this app open while slicing.</p><button className="secondary" onClick={cancel}>Cancel slicing</button></div>}
    {!slicing&&model&&!(tab==='preview'&&result)&&<div className="slice-action"><button className="primary" disabled={busy||!!validation} onClick={slice}>{loading?<LoaderCircle size={18} className="spin"/>:<Spool size={19}/>}Slice model</button><span>{settings.material} · {summary.layerHeight} mm · {settings.infill}% infill</span></div>}
    <footer><ShieldCheck size={17}/><span>Slicing stays on this device</span>{engineReady&&<Check size={14}/>}</footer>
  </div></section></div><SettingsDialog open={settingsOpen} onClose={()=>setSettingsOpen(false)} connection={connection} onConnection={setConnection}/></main>;
}
