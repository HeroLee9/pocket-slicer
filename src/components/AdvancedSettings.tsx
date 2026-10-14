import {memo,useDeferredValue,useMemo,useRef,useState} from 'react';
import {ChevronDown,Download,RotateCcw,Search,Upload} from 'lucide-react';
import {ORCA_CATEGORIES,ORCA_OPTIONS,ORCA_SCHEMA_SOURCE,applyOverrides,exportProfileJSON,isVectorOption,maximumOptionValues,optionValue,parseProfileJSON,validateOption,type OrcaOption,type OrcaOverrides,type OrcaValue,type ProfileImport} from '../lib/orca-settings';
import './AdvancedSettings.css';

type Props={baseConfig:Record<string,unknown>;overrides:OrcaOverrides;onChange:(value:OrcaOverrides)=>void;disabled:boolean};
const EDITABLE_COUNT=ORCA_OPTIONS.filter(option=>!option.unavailable).length;
const PAGE_SIZE=24;

function downloadJSON(text:string,name:string){
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);
}

export default function AdvancedSettings({baseConfig,overrides,onChange,disabled}:Props){
  const [open,setOpen]=useState(true),[search,setSearch]=useState(''),[category,setCategory]=useState('all'),[changedOnly,setChangedOnly]=useState(false),[includeUnavailable,setIncludeUnavailable]=useState(false),[limit,setLimit]=useState(PAGE_SIZE);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<ProfileImport|null>(null);
  const input=useRef<HTMLInputElement>(null),query=useDeferredValue(search.trim().toLowerCase());
  const filtered=useMemo(()=>ORCA_OPTIONS.filter(option=>{
    if(!includeUnavailable&&option.unavailable)return false;
    if(category!=='all'&&option.category!==category)return false;
    if(changedOnly&&!Object.hasOwn(overrides,option.key))return false;
    return !query||`${option.label} ${option.key} ${option.tooltip} ${option.category}`.toLowerCase().includes(query);
  }),[query,category,changedOnly,includeUnavailable,overrides]);
  const count=Object.keys(overrides).length;
  function change(key:string,value:OrcaValue|undefined){const next={...overrides};if(value===undefined)delete next[key];else next[key]=value;onChange(next);setError('');setNotice('');}
  async function importFile(file:File){
    setError('');setNotice('');setPending(null);
    try{if(file.size>1_048_576)throw new Error('The settings JSON must be smaller than 1 MB.');setPending(parseProfileJSON(await file.text()));}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(input.current)input.current.value='';}
  }
  function exportFile(full:boolean){
    setError('');try{const text=full?JSON.stringify(applyOverrides(baseConfig,overrides),null,2)+'\n':exportProfileJSON(overrides);downloadJSON(text,full?'pocket-slicer-k1c-profile.json':'pocket-slicer-overrides.json');setNotice('Settings download requested. Check Files.');}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  }
  return <section className="orca-settings" aria-label="All Orca parameters">
    <button type="button" className="orca-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open}><span><strong>All Orca parameters</strong><small>{EDITABLE_COUNT} editable settings{count?` · ${count} changed`:''}</small></span><ChevronDown size={20} className={open?'expanded':''}/></button>
    {open&&<div className="orca-body">
      <p className="orca-intro">Search the OrcaSlicer {ORCA_SCHEMA_SOURCE.version} process, filament, and printer controls. Overrides take priority over the selected presets. Reset a field to use its preset again.</p>
      <div className="orca-search"><Search size={17}/><input aria-label="Search Orca parameters" type="search" placeholder="Search speed, seam, cooling…" value={search} onChange={event=>{setSearch(event.target.value);setLimit(PAGE_SIZE);}}/></div>
      <div className="orca-filters"><label>Category<select aria-label="Orca parameter category" value={category} onChange={event=>{setCategory(event.target.value);setLimit(PAGE_SIZE);}}><option value="all">All categories</option>{ORCA_CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label><label className="orca-check"><input type="checkbox" checked={changedOnly} onChange={event=>{setChangedOnly(event.target.checked);setLimit(PAGE_SIZE);}}/>Changed only ({count})</label><label className="orca-check"><input type="checkbox" checked={includeUnavailable} onChange={event=>{setIncludeUnavailable(event.target.checked);setLimit(PAGE_SIZE);}}/>Show unavailable ({ORCA_OPTIONS.length-EDITABLE_COUNT})</label></div>
      <div className="orca-file-actions"><button type="button" onClick={()=>input.current?.click()} disabled={disabled}><Upload size={15}/>Import JSON</button><button type="button" onClick={()=>exportFile(false)} disabled={disabled}><Download size={15}/>Export overrides</button><button type="button" onClick={()=>exportFile(true)} disabled={disabled}><Download size={15}/>Export full profile</button><button type="button" onClick={()=>{onChange({});setNotice('All overrides reset. The selected presets are active.');setError('');}} disabled={disabled||!count}><RotateCcw size={15}/>Reset all</button></div>
      <input ref={input} type="file" hidden aria-label="Import Orca settings JSON" onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);}}/>
      {pending&&<div className="orca-import-preview" role="region" aria-label="Review imported Orca settings"><strong>{Object.keys(pending.overrides).length} editable settings ready</strong><p>These settings will merge with your existing overrides. Other fields keep their current values.</p>{pending.notes.map(note=><p key={note} className="orca-warning">{note}</p>)}{pending.omitted.length>0&&<details open><summary>{pending.omitted.length} entries will not be applied</summary><ul>{pending.omitted.map(item=><li key={item.key}><code>{item.key}</code> — {item.reason}</li>)}</ul></details>}<div className="orca-file-actions"><button type="button" disabled={disabled} onClick={()=>{onChange({...overrides,...pending.overrides});setNotice(`Imported ${Object.keys(pending.overrides).length} settings${pending.omitted.length?`; ${pending.omitted.length} listed entries were excluded`:''}.`);setPending(null);}}>Apply imported settings</button><button type="button" onClick={()=>setPending(null)}>Cancel import</button></div></div>}
      {error&&<p className="orca-error" role="alert">{error}</p>}{notice&&<p className="orca-notice" role="status">{notice}</p>}
      <div className="orca-result-count" aria-live="polite">{filtered.length} matching parameters{filtered.length>limit?` · showing ${limit}`:''}</div>
      <div className="orca-option-list">{filtered.slice(0,limit).map(option=><OptionRow key={option.key} option={option} baseValue={optionValue(option,baseConfig)} value={overrides[option.key]} disabled={disabled} onChange={change}/>)}</div>
      {!filtered.length&&<p className="orca-empty">No parameters match. Try another term or enable “Show unavailable”.</p>}
      {filtered.length>limit&&<button type="button" className="orca-more" onClick={()=>setLimit(value=>value+PAGE_SIZE)}>Show {Math.min(PAGE_SIZE,filtered.length-limit)} more parameters</button>}
      <p className="orca-footnote">Settings use Orca’s original names and help. Dependent features need their parent setting enabled. Grey controls explain capabilities unavailable in this single-filament K1C workflow.</p>
    </div>}
  </section>;
}

type RowProps={option:OrcaOption;baseValue:OrcaValue|undefined;value:OrcaValue|undefined;disabled:boolean;onChange:(key:string,value:OrcaValue|undefined)=>void};
const OptionRow=memo(function OptionRow({option,baseValue,value,disabled,onChange}:RowProps){
  const changed=value!==undefined,current=value??baseValue;
  const initial=option.nullable?'nil':option.choices?.find(choice=>!option.unavailableChoices?.[choice])??(['Bool','Bools'].includes(option.type)?'0':(['String','Strings'].includes(option.type)?'':String(option.min??0)));
  const values=isVectorOption(option)?(Array.isArray(current)?current:[current??initial]):[Array.isArray(current)?current[0]:current??''];
  const unavailable=!!option.unavailable;
  const invalid=changed?validateOption(option,value):undefined;
  const set=(index:number,next:string)=>{if(isVectorOption(option)){const list=[...values];list[index]=next;onChange(option.key,list);}else onChange(option.key,next);};
  return <article className={`orca-option${changed?' orca-changed':''}${unavailable?' orca-unavailable':''}`} data-option={option.key}>
    <div className="orca-option-heading"><div><label htmlFor={`orca-${option.key}-0`}>{option.label}</label><span className="orca-category">{option.category}</span></div>{changed&&<button type="button" className="orca-reset" title="Reset to preset" aria-label={`Reset ${option.label} to preset`} disabled={disabled} onClick={()=>onChange(option.key,undefined)}><RotateCcw size={15}/></button>}</div>
    <code className="orca-key">{option.key}</code>
    {unavailable?<p className="orca-unavailable-reason">{option.unavailable}</p>:<>
      <div className="orca-values">{values.map((entry,index)=><div className="orca-value" key={index}>{values.length>1&&<span className="orca-index">{option.key.startsWith('machine_')?(index===0?'Normal':'Silent'):`Value ${index+1}`}</span>}<ScalarControl option={option} value={entry} index={index} disabled={disabled} onChange={next=>set(index,next)}/>{values.length>1&&<button type="button" className="orca-remove-value" aria-label={`Remove ${option.label} value ${index+1}`} disabled={disabled} onClick={()=>onChange(option.key,values.filter((_,i)=>i!==index))}>×</button>}</div>)}</div>
      {isVectorOption(option)&&values.length<maximumOptionValues(option)&&<button type="button" className="orca-add-value" disabled={disabled} onClick={()=>onChange(option.key,[...values,initial])}>{values.length?'Add value':'Set value'}</button>}
      <div className="orca-value-meta"><span>{changed?'Override':current===undefined?'Engine default':'Preset / engine default'}</span>{(option.min!==undefined||option.max!==undefined)&&<span>{option.min??'−∞'} … {option.max??'∞'}{option.unit?' '+option.unit:''}</span>}</div>
      {invalid&&<p className="orca-error" role="alert">{invalid}</p>}
    </>}
    {option.tooltip&&<details className="orca-help"><summary>About this setting{option.unit?` · ${option.unit}`:''}</summary><p>{option.tooltip}</p></details>}
  </article>;
});

function ScalarControl({option,value,index,disabled,onChange}:{option:OrcaOption;value:string;index:number;disabled:boolean;onChange:(value:string)=>void}){
  const id=`orca-${option.key}-${index}`,label=option.label+(index?` ${index+1}`:'');
  if(['Bool','Bools'].includes(option.type))return <select id={id} aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{option.nullable&&<option value="nil">Use printer value</option>}<option value="0">Off</option><option value="1">On</option></select>;
  if(['Enum','Enums'].includes(option.type))return <select id={id} aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{!value&&<option value="">Choose a value</option>}{option.nullable&&<option value="nil">Use printer value</option>}{value&&!option.choices?.includes(value)&&value!=='nil'&&<option value={value}>{value}</option>}{option.choices?.map((choice,i)=><option key={choice} value={choice} disabled={!!option.unavailableChoices?.[choice]}>{option.choiceLabels?.[i]||choice}{option.unavailableChoices?.[choice]?' · unavailable':''}</option>)}</select>;
  if(option.multiline||option.key.includes('gcode'))return <textarea id={id} aria-label={label} rows={5} spellCheck={false} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/>;
  const numeric=['Float','Floats','Int','Ints'].includes(option.type)&&!option.nullable;
  return <input id={id} aria-label={label} type={numeric?'number':'text'} inputMode={['String','Strings'].includes(option.type)?'text':'decimal'} step={['Int','Ints'].includes(option.type)?1:'any'} min={option.min} max={option.max} value={value} disabled={disabled} placeholder={option.nullable?'nil = use printer value':option.type.includes('Percent')?'Number or %':option.type.includes('Point')?'XxY':''} onChange={event=>onChange(event.target.value)}/>;
}
