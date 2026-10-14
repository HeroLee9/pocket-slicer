import catalog from './orca-options.json' with {type:'json'};

export type OrcaValue = string | string[];
export type OrcaOverrides = Record<string, OrcaValue>;
export type OrcaOption = {
  key:string; type:string; label:string; category:string; tooltip:string; unit:string; mode:string;
  min?:number; max?:number; nullable?:boolean; multiline?:boolean; readonly?:boolean;
  choices?:string[]; choiceLabels?:string[]; defaultValue?:OrcaValue;
  unavailable?:string; unavailableChoices?:Record<string,string>;
};
export const ORCA_SCHEMA_SOURCE = {version:catalog.version, commit:catalog.commit, url:catalog.source};
export const OVERRIDES_STORAGE_KEY = 'pocket-orca-overrides-v1';
const FIXED_MACHINE = new Set(['printer_technology','printer_model','printer_variant','printer_structure','gcode_flavor','printable_area','printable_height','bed_exclude_area','extruder_printable_area','extruder_printable_height','extruder_offset','nozzle_diameter','extruder_type','parallel_printheads_count','parallel_printheads_bed_exclude_areas','support_parallel_printheads','pellet_modded_printer','pellet_flow_coefficient']);
const IDENTITY = new Set(['inherits','inherits_group','preset_name','preset_names','printer_settings_id','print_settings_id','filament_settings_id','filament_ids','filament_self_index','printer_agent','different_settings_to_system','default_print_profile','default_filament_profile','default_bed_type','print_compatible_printers','upward_compatible_machine','extruder_variant_list','default_filament_colour','filament_colour','filament_colour_type','filament_multi_colour','extruder_colour','bed_custom_model','bed_custom_texture','preferred_orientation','best_object_pos','filename_format','use_3mf','bbl_use_printhost']);
const PROJECT_ONLY = new Set(['print_sequence','print_order','first_layer_print_sequence','first_layer_sequence_choice','other_layers_print_sequence','other_layers_print_sequence_nums','other_layers_sequence_choice','printing_by_object_gcode','interlocking_beam','interlocking_beam_layer_count','interlocking_beam_width','interlocking_boundary_avoidance','interlocking_depth','interlocking_orientation','mmu_segmented_region_interlocking_depth','mmu_segmented_region_max_width','start_end_points','manual_filament_change','machine_pause_gcode','change_filament_gcode','template_custom_gcode']);
const MULTI = /(?:prime_tower|wipe_tower|tower_interface|tower_ironing|filament_(?:loading|unloading|cooling|ramming|multitool|flush|stamping|toolchange|change_length|map|printable)|flush_into|flush_volumes|flush_multiplier|wiping_volumes|single_extruder_multi_material|physical_extruder|master_extruder|extruder_ams|filament_switcher|tool_change|retract_length_toolchange|retract_restart_extra_toolchange|cooling_tube|parking_pos_retraction|extra_loading_move|grab_length|high_current_on_filament_swap|long_retractions_when_(?:cut|ec)|retraction_distances_when_(?:cut|ec)|enable_filament_(?:ramming|dynamic_map)|enable_long_retraction_when_cut|filament_extruder_variant|print_extruder|printer_extruder|nozzle_flush_dataset)/;
const HOST = /^(?:print_host|printhost_|host_type$|flashforge_serial_number$)/;
const SPECIAL_HARDWARE = new Set(['bbl_calib_mark_logo','scan_first_layer','enable_wrapping_detection','head_wrap_detect_zone','wrapping_detection_gcode','wrapping_detection_layers','wrapping_exclude_area','activate_chamber_temp_control','support_chamber_temp_control','chamber_temperature','chamber_minimal_temperature']);

function unavailable(key:string):string|undefined {
  if(FIXED_MACHINE.has(key))return key==='nozzle_diameter'?'Choose the fitted nozzle in the main print settings. This keeps its printer preset consistent.':'Fixed to the K1C hardware and 220 × 220 × 250 mm build volume.';
  if(HOST.test(key))return 'Desktop printer connection setting. Use Settings & help for this app’s connection.';
  if(IDENTITY.has(key)||key.startsWith('compatible_'))return 'Desktop preset or display metadata; it does not change slicing in this app.';
  if(PROJECT_ONLY.has(key))return 'Requires separate objects, painted regions, or inserted events. This app currently slices one merged model.';
  if(MULTI.test(key)||/(?:_filament_id|^support_filament$|^support_interface_filament$|^extruder$)/.test(key))return 'Requires a filament changer or multiple extruders. This K1C setup uses one filament and one extruder.';
  if(SPECIAL_HARDWARE.has(key))return 'Requires hardware or printer integration that this stock K1C setup does not provide.';
  if(key==='post_process')return 'Desktop post-processing scripts cannot run inside the browser.';
  if(key==='thumbnails'||key==='thumbnails_format')return 'The headless engine does not render embedded thumbnail images.';
  if(key==='time_lapse_gcode'||key==='timelapse_type')return 'Timelapse capture needs printer-side integration and is not provided by this app.';
  if(['brim_ears','ironing_expansion','tree_support_with_infill'].includes(key))return 'Legacy compatibility setting. Use Brim type, Ironing inset, or the current tree-support controls.';
  return undefined;
}
function category(option:OrcaOption):string {
  const key=option.key;
  if(/gcode/.test(key))return 'Custom G-code';
  if(/^(brim|skirt|raft|draft_shield|single_loop_draft_shield)/.test(key))return 'Bed adhesion';
  if(/(?:retract|z_hop|wipe_distance|^wipe$|deretraction|travel_slope)/.test(key))return 'Retraction';
  if(/fan|cooling|slow_down|slowdown/.test(key))return 'Cooling';
  if(/^(filament_|pressure_advance|enable_pressure_advance|adaptive_pressure_advance|nozzle_temperature|.*plate_temp|idle_temperature|temperature_vitrification|bed_temperature_formula)/.test(key))return 'Filament';
  if(['Quality','Strength','Speed','Support'].includes(option.category))return option.category;
  if(/accel|jerk|^machine_|^input_shap|nozzle_|^min_layer_height$|^max_layer_height$|^printer_|^printable_|^extruder_|^bed_mesh|^adaptive_bed_mesh|^z_offset$|^use_firmware_retraction$|^emit_machine|^resonance|resonance_avoidance/.test(key))return 'Printer & motion';
  if(option.category==='Filament overrides')return 'Retraction';
  return 'Other';
}
const bridgeOptions:OrcaOption[]=[
  {key:'adaptive_layer_height',type:'Bool',label:'Adaptive layer height',category:'Quality',tooltip:'Let Orca vary layer height automatically using the model geometry and nozzle limits.',unit:'',mode:'advanced',defaultValue:'0'},
  {key:'adaptive_layer_height_quality',type:'Float',label:'Adaptive layer quality',category:'Quality',tooltip:'Adaptive layer-height quality from 0 (coarser) to 1 (finer). Used when adaptive layer height is enabled.',unit:'',mode:'advanced',min:0,max:1,defaultValue:'0.5'},
];
export const ORCA_OPTIONS:OrcaOption[]=[...(catalog.options as OrcaOption[]),...bridgeOptions].map(source=>{
  const option:OrcaOption={...source,category:category(source),unavailable:unavailable(source.key)};
  if(source.readonly&&!option.unavailable)option.unavailable='Read-only engine information.';
  if(source.key==='support_type')option.unavailableChoices={'normal(manual)':'Manual support painting is not available.','tree(manual)':'Manual support painting is not available.'};
  if(source.key==='brim_type')option.unavailableChoices={painted:'Brim painting is not available.'};
  if(/^nozzle_temperature(?:_|$)/.test(source.key))option.max=Math.min(option.max??300,300);
  if(/plate_temp/.test(source.key))option.max=Math.min(option.max??100,100);
  return option;
});
export const ORCA_OPTION_MAP=new Map(ORCA_OPTIONS.map(option=>[option.key,option]));
export const ORCA_CATEGORIES=['Quality','Strength','Speed','Support','Bed adhesion','Filament','Cooling','Retraction','Printer & motion','Custom G-code','Other'];
export const isVectorOption=(option:OrcaOption)=>['Floats','Ints','Bools','Enums','Strings','Percents','FloatsOrPercents','Points','PointsGroups'].includes(option.type);
export const maximumOptionValues=(option:OrcaOption)=>option.type==='Points'||option.type==='PointsGroups'?64:option.key.startsWith('machine_')&&option.type!=='Strings'?2:1;
const SCALAR_TYPES:Record<string,string>={Floats:'Float',Ints:'Int',Bools:'Bool',Enums:'Enum',Strings:'String',Percents:'Percent',FloatsOrPercents:'FloatOrPercent',Points:'Point',PointsGroups:'PointsGroup'};
const scalarType=(option:OrcaOption)=>SCALAR_TYPES[option.type]??option.type;
const NUMBER=/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const MAX_JSON_BYTES=1_048_576;

export function optionValue(option:OrcaOption,config:Record<string,unknown>):OrcaValue|undefined {
  const raw=config[option.key]??option.defaultValue;
  if(raw===undefined)return undefined;
  if(Array.isArray(raw))return raw.map(item=>item===null?'nil':typeof item==='boolean'?(item?'1':'0'):String(item));
  const value=typeof raw==='boolean'?(raw?'1':'0'):String(raw);
  if(!isVectorOption(option))return value;
  return option.type==='Strings'?[value]:value.split(option.type==='PointsGroups'?'#':',');
}

export function validateOption(option:OrcaOption,value:unknown):string|undefined {
  const prefix=`${option.label} (${option.key})`;
  if(option.unavailable)return `${prefix}: ${option.unavailable}`;
  if(isVectorOption(option)!==Array.isArray(value))return `${prefix}: expected ${isVectorOption(option)?'a list of values':'a single value'}.`;
  const values=Array.isArray(value)?value:[value];
  if(values.length>maximumOptionValues(option))return `${prefix}: this setup supports ${maximumOptionValues(option)} value${maximumOptionValues(option)>1?'s (normal and silent motion modes)':' for its single filament / extruder'}.`;
  if(values.length===0&&option.type!=='Points'&&option.type!=='PointsGroups')return `${prefix}: enter one value; use an empty text value to clear G-code.`;
  for(const raw of values){
    if(typeof raw!=='string')return `${prefix}: values must use Orca’s string format.`;
    if(raw.includes('\0')||raw.length>65_536)return `${prefix}: text is too large or contains a NUL character.`;
    const value=raw.trim(),type=scalarType(option);
    if(option.nullable&&value==='nil')continue;
    if(type==='String')continue;
    if(type==='Bool'){if(!['0','1'].includes(value))return `${prefix}: choose On or Off.`;continue;}
    if(type==='Enum'){
      if(!option.choices?.includes(value))return `${prefix}: choose one of ${option.choices?.join(', ')??'the listed options'}.`;
      if(option.unavailableChoices?.[value])return `${prefix}: ${option.unavailableChoices[value]}`;
      continue;
    }
    if(type==='Point'||type==='Point3'||type==='PointsGroup'){
      const points=type==='PointsGroup'?value.split(','):[value];
      if(points.some(point=>{const coords=point.split(/[x,]/);return coords.length!==(type==='Point3'?3:2)||coords.some(n=>!NUMBER.test(n.trim())||!Number.isFinite(Number(n)));}))return `${prefix}: use ${type==='Point3'?'X,Y,Z':'XxY'} coordinates.`;
      continue;
    }
    const percent=value.endsWith('%');
    if(percent&&!['Percent','FloatOrPercent'].includes(type))return `${prefix}: enter a number without %.`;
    const numeric=percent?value.slice(0,-1):value;
    if(!NUMBER.test(numeric)||!Number.isFinite(Number(numeric)))return `${prefix}: enter a finite number${type==='FloatOrPercent'?' or percentage':''}.`;
    const n=Number(numeric);
    if(type==='Int'&&!Number.isInteger(n))return `${prefix}: enter a whole number.`;
    if(option.min!==undefined&&n<option.min)return `${prefix}: minimum ${option.min}${option.unit?' '+option.unit:''}.`;
    if(option.max!==undefined&&n>option.max)return `${prefix}: maximum ${option.max}${option.unit?' '+option.unit:''}.`;
  }
  return undefined;
}

export function validateOverrides(input:unknown):string[]{
  if(!input||typeof input!=='object'||Array.isArray(input))return ['Orca overrides must be a JSON object.'];
  const errors:string[]=[];
  for(const [key,value] of Object.entries(input)){
    const option=ORCA_OPTION_MAP.get(key);
    if(!option){errors.push(`Unknown Orca setting: ${key}. It cannot be applied by this version.`);continue;}
    const error=validateOption(option,value);if(error)errors.push(error);
  }
  return errors;
}

/** Overrides apply last. Reject invalid keys/values before the worker sees them. */
export function applyOverrides(baseConfig:Record<string,unknown>,overrides:OrcaOverrides={}):Record<string,unknown>{
  const errors=validateOverrides(overrides);if(errors.length)throw new RangeError(errors.join('\n'));
  const result={...baseConfig,...structuredClone(overrides)};
  const first=(key:string)=>Number(Array.isArray(result[key])?(result[key] as unknown[])[0]:result[key]);
  const layer=first('layer_height'),minimum=first('min_layer_height'),maximum=first('max_layer_height');
  if(Number.isFinite(minimum)&&Number.isFinite(maximum)&&minimum>maximum)throw new RangeError('Minimum layer height must not exceed maximum layer height.');
  if(Number.isFinite(layer)&&((Number.isFinite(minimum)&&layer<minimum)||(Number.isFinite(maximum)&&layer>maximum)))throw new RangeError(`Layer height must stay between the nozzle limits (${minimum}–${maximum} mm).`);
  const density=String(result.sparse_infill_density??'').replace('%','');
  if(Number(density)===100&&!['rectilinear','alignedrectilinear','monotonic','monotonicline','concentric','hilbertcurve','archimedeanchords','octagramspiral'].includes(String(result.sparse_infill_pattern)))throw new RangeError('100% infill needs a solid-compatible pattern such as Rectilinear. Change the infill pattern or reduce density.');
  // Bed geometry is never taken from a user profile; the worker and viewer use
  // the same physical K1C limits even after import.
  result.bed_size_x=220;result.bed_size_y=220;result.bed_shape='rectangle';result.printable_height='250';
  return result;
}

export type ProfileImport={overrides:OrcaOverrides;omitted:{key:string;reason:string}[];notes:string[]};
export function parseProfileJSON(text:string):ProfileImport{
  if(new TextEncoder().encode(text).length>MAX_JSON_BYTES)throw new Error('The settings JSON must be smaller than 1 MB.');
  const document=JSON.parse(text) as unknown;
  if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('Choose a JSON object containing Orca settings.');
  const outer=document as Record<string,unknown>;
  let source=outer;
  if(outer.format==='pocket-slicer-overrides'){
    if(outer.version!==1||!outer.overrides||typeof outer.overrides!=='object'||Array.isArray(outer.overrides))throw new Error('Unsupported Pocket Slicer settings file.');
    source=outer.overrides as Record<string,unknown>;
  }
  const overrides:OrcaOverrides=Object.create(null),omitted:ProfileImport['omitted']=[],notes:string[]=[];
  for(const [key,raw]of Object.entries(source)){
    const option=ORCA_OPTION_MAP.get(key);
    if(!option||option.unavailable){
      omitted.push({key,reason:option?.unavailable??'Not a supported native setting in OrcaSlicer 2.4.2.'});
      if(key==='inherits'&&raw)notes.push(`This profile inherits “${String(raw)}”. Its parent is not included; unchanged values will come from your selected K1C preset.`);
      continue;
    }
    const encode=(value:unknown):string=>{if(value===null&&option.nullable)return 'nil';if(typeof value==='string')return value;if(typeof value==='number'&&Number.isFinite(value))return String(value);if(typeof value==='boolean')return value?'1':'0';throw new Error(`${key}: expected text, a number, or a boolean.`);};
    const value=isVectorOption(option)?(Array.isArray(raw)?raw.map(encode):optionValue(option,{[key]:encode(raw)})!):encode(raw);
    const error=validateOption(option,value);if(error)throw new Error(error);
    overrides[key]=value;
  }
  if(!Object.keys(overrides).length)throw new Error('This file contains no editable settings for the current K1C setup.');
  return {overrides,omitted,notes};
}

export function exportProfileJSON(overrides:OrcaOverrides):string{
  const errors=validateOverrides(overrides);if(errors.length)throw new Error(errors.join('\n'));
  return JSON.stringify({format:'pocket-slicer-overrides',version:1,engine:`OrcaSlicer ${catalog.version}`,overrides},null,2)+'\n';
}
