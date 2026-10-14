import sourceProfiles from './k1c.json' with { type: 'json' };

export type Material = 'PLA' | 'PETG' | 'Elegoo Rapid PETG' | 'ABS';
export type Quality = 'fine' | 'standard' | 'draft';
export type Nozzle = '0.4' | '0.6' | '0.8';
export type Support = 'off' | 'normal' | 'tree';
export type StartupMode = 'standard' | 'kamp';
export type BedType = 'Textured PEI Plate' | 'High Temp Plate' | 'Engineering Plate';
export type NativeConfig = Record<string, string | number | boolean | string[]>;
export type PrintSettings = {
  material: Material;
  quality: Quality;
  nozzle: Nozzle;
  infill: number;
  walls: number;
  support: Support;
  brim: number;
  nozzleTemperature: number | null;
  bedTemperature: number | null;
  bedType: BedType;
  startupMode: StartupMode;
  layerHeight?: number | null;
  infillPattern?: 'grid' | 'gyroid' | 'rectilinear' | 'cubic';
};

export const DEFAULT_SETTINGS: PrintSettings = {
  material: 'PLA', quality: 'standard', nozzle: '0.4', infill: 15, walls: 3,
  support: 'off', brim: 5, nozzleTemperature: null, bedTemperature: null,
  bedType: 'Textured PEI Plate', startupMode: 'kamp', infillPattern: 'gyroid',
};

export const MATERIALS: Material[] = ['PLA', 'PETG', 'Elegoo Rapid PETG', 'ABS'];
export const QUALITIES: Quality[] = ['fine', 'standard', 'draft'];
export const NOZZLES: Nozzle[] = ['0.4', '0.6', '0.8'];
export const BED_TYPES: BedType[] = ['Textured PEI Plate', 'High Temp Plate', 'Engineering Plate'];
export const PRINTER = {
  name: 'Creality K1C', width: 220, depth: 220, height: 250,
  maxNozzleTemperature: 300, maxBedTemperature: 100,
  specificationSource: 'https://www.creality.com/products/k1c-carbon-3d-printer',
};
export const PROFILE_SOURCE = sourceProfiles.source;

const bedKeys: Record<BedType, string> = {
  'Textured PEI Plate': 'textured_plate_temp',
  'High Temp Plate': 'hot_plate_temp',
  'Engineering Plate': 'eng_plate_temp',
};
const allBedKeys = ['cool_plate_temp', 'eng_plate_temp', 'hot_plate_temp', 'textured_plate_temp', 'textured_cool_plate_temp', 'supertack_plate_temp'];
const firstNumber = (value: unknown) => Number(Array.isArray(value) ? value[0] : value);

function numberInRange(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  }
  return value;
}

export function resolveSettings(input: Partial<PrintSettings> = {}): PrintSettings {
  const settings = { ...DEFAULT_SETTINGS, ...input };
  if (!MATERIALS.includes(settings.material)) throw new RangeError('Choose a supported filament preset.');
  if (!QUALITIES.includes(settings.quality)) throw new RangeError('Choose Fine, Standard, or Draft quality.');
  if (!NOZZLES.includes(settings.nozzle)) throw new RangeError('Choose a 0.4, 0.6, or 0.8 mm nozzle.');
  if (!BED_TYPES.includes(settings.bedType)) throw new RangeError('Choose a supported build plate.');
  if (!['standard', 'kamp'].includes(settings.startupMode)) throw new RangeError('Choose standard or KAMP startup.');
  if (!['off', 'normal', 'tree'].includes(settings.support)) throw new RangeError('Choose a supported support type.');
  if (settings.infillPattern && !['grid', 'gyroid', 'rectilinear', 'cubic'].includes(settings.infillPattern)) throw new RangeError('Choose a supported infill pattern.');
  numberInRange(settings.infill, 'Infill', 0, 100);
  numberInRange(settings.walls, 'Wall count', 1, 12, true);
  numberInRange(settings.brim, 'Brim width', 0, 20);
  if (settings.nozzleTemperature != null) numberInRange(settings.nozzleTemperature, 'Nozzle temperature', 170, PRINTER.maxNozzleTemperature, true);
  if (settings.bedTemperature != null) numberInRange(settings.bedTemperature, 'Bed temperature', 0, PRINTER.maxBedTemperature, true);
  const printer: NativeConfig = sourceProfiles.printers[settings.nozzle].settings;
  if (settings.layerHeight != null) numberInRange(settings.layerHeight, 'Layer height', firstNumber(printer.min_layer_height), firstNumber(printer.max_layer_height));
  return settings;
}

/** Flattened native Orca options for OneSlicerEngine session.init UTF-8 JSON. */
export function buildConfig(input: Partial<PrintSettings> = {}): NativeConfig {
  const settings = resolveSettings(input);
  const printer = sourceProfiles.printers[settings.nozzle];
  const process = sourceProfiles.processes[settings.nozzle][settings.quality];
  const filament = sourceProfiles.filaments[settings.material];
  const config: NativeConfig = structuredClone({ ...printer.settings, ...process.settings, ...filament.settings });
  // Bed extents are bridge pseudo-options used when it centers a model.
  config.bed_size_x = PRINTER.width;
  config.bed_size_y = PRINTER.depth;
  config.bed_shape = 'rectangle';
  config.curr_bed_type = settings.bedType;
  config.printer_settings_id = printer.name;
  config.print_settings_id = process.name;
  config.filament_settings_id = [filament.name];
  // This app currently slices one filament and one extruder.
  config.enable_prime_tower = '0';
  config.single_extruder_multi_material = '0';
  config.wall_loops = String(settings.walls);
  config.sparse_infill_density = `${settings.infill}%`;
  // Orca rejects Grid/Gyroid at 100%; solid infill uses rectilinear.
  config.sparse_infill_pattern = settings.infill === 100 ? 'rectilinear' : (settings.infillPattern ?? 'gyroid');
  config.wall_sequence = 'inner-outer-inner wall';
  // These legacy preset aliases are not native 2.4.2 enum values. Preserve
  // the effective defaults previously used when the engine ignored them.
  if (config.ironing_pattern === 'zig-zag') config.ironing_pattern = 'rectilinear';
  if (config.wall_direction === 'auto') config.wall_direction = 'ccw';
  config.default_acceleration = '5000';
  config.travel_acceleration = '5000';
  // Preserve lower role/first-layer accelerations while limiting inherited
  // profile defaults to the user's 5000 mm/s² preference. Percentages remain
  // relative to the capped default/travel/outer-wall accelerations.
  for (const key of ['inner_wall_acceleration', 'outer_wall_acceleration', 'top_surface_acceleration', 'initial_layer_acceleration', 'initial_layer_travel_acceleration', 'sparse_infill_acceleration', 'internal_solid_infill_acceleration', 'bridge_acceleration']) {
    const value = config[key];
    if (value == null) continue;
    const text = String(value);
    config[key] = text.endsWith('%') ? `${Math.min(Number.parseFloat(text), 100)}%` : String(Math.min(Number(text), 5000));
  }
  if (settings.startupMode === 'kamp') {
    // Guilouz KAMP's START_PRINT owns homing, adaptive meshing and purging.
    // Its mesh/purge macros read Orca's EXCLUDE_OBJECT_DEFINE polygons.
    config.gcode_label_objects = '1';
    config.exclude_object = '1';
    config.machine_start_gcode = [
      'SET_PRINT_STATS_INFO TOTAL_LAYER=[total_layer_count]',
      'M140 S0',
      'M104 S0',
      '_ADAPTIVE_BED_MESH_ON',
      '_ADAPTIVE_PURGE_LINE_ON',
      'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer_single]',
      'M204 S5000',
      'M83',
      'G92 E0',
    ].join('\n');
  }
  config.enable_support = settings.support === 'off' ? '0' : '1';
  config.support_type = settings.support === 'tree' ? 'tree(auto)' : 'normal(auto)';
  config.brim_type = settings.brim > 0 ? 'outer_only' : 'no_brim';
  config.brim_width = String(settings.brim);
  if (settings.layerHeight != null) config.layer_height = String(settings.layerHeight);
  if (settings.nozzleTemperature != null) {
    config.nozzle_temperature = [String(settings.nozzleTemperature)];
    config.nozzle_temperature_initial_layer = [String(settings.nozzleTemperature)];
  }
  // The inherited generic ABS preset says 105C, but Creality specifies 100C
  // for the K1C. Cap inherited values, and reject explicit values above 100C.
  for (const key of allBedKeys) {
    for (const suffix of ['', '_initial_layer']) {
      const option = key + suffix;
      if (settings.bedTemperature != null) config[option] = [String(settings.bedTemperature)];
      else if (config[option] != null) config[option] = [String(Math.min(firstNumber(config[option]), PRINTER.maxBedTemperature))];
    }
  }
  return config;
}

/** Values shown in the UI are derived from exactly the config we slice. */
export function getProfileSummary(input: Partial<PrintSettings> = {}) {
  const settings = resolveSettings(input);
  const config = buildConfig(settings);
  return {
    printer: PRINTER.name,
    nozzle: Number(settings.nozzle),
    material: settings.material,
    startupMode: settings.startupMode,
    quality: settings.quality,
    profileName: sourceProfiles.processes[settings.nozzle][settings.quality].name,
    filamentProfileName: sourceProfiles.filaments[settings.material].name,
    layerHeight: firstNumber(config.layer_height),
    firstLayerHeight: firstNumber(config.initial_layer_print_height),
    nozzleTemperature: firstNumber(config.nozzle_temperature),
    firstLayerNozzleTemperature: firstNumber(config.nozzle_temperature_initial_layer),
    bedTemperature: firstNumber(config[bedKeys[settings.bedType]]),
    firstLayerBedTemperature: firstNumber(config[bedKeys[settings.bedType] + '_initial_layer']),
    maxVolumetricSpeed: firstNumber(config.filament_max_volumetric_speed),
    infillPattern: String(config.sparse_infill_pattern),
    wallSequence: String(config.wall_sequence),
    acceleration: firstNumber(config.default_acceleration),
    minLayerHeight: firstNumber(config.min_layer_height),
    maxLayerHeight: firstNumber(config.max_layer_height),
  };
}
