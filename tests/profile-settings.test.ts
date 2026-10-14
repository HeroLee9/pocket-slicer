import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { buildConfig, getProfileSummary, DEFAULT_SETTINGS } from '../src/profiles/index.ts';

test('K1C presets resolve inherited temperatures, relative extrusion, and start/end macros', () => {
  for (const [material, nozzle, bed] of [['PLA', 220, 55], ['PETG', 250, 70], ['ABS', 260, 100]] as const) {
    const config = buildConfig({ material });
    const summary = getProfileSummary({ material });
    assert.equal(summary.nozzleTemperature, nozzle);
    assert.equal(summary.bedTemperature, bed);
    assert.equal(config.use_relative_e_distances, '1');
    assert.match(String(config.before_layer_change_gcode), /G92 E0/);
    assert.match(String(config.machine_start_gcode), /^START_PRINT EXTRUDER_TEMP=/m);
    assert.equal(config.machine_end_gcode, 'END_PRINT');
    assert.deepEqual(config.printable_area, ['0x0', '220x0', '220x220', '0x220']);
    assert.equal(config.printable_height, '250');
    assert.equal(config.bed_size_x, 220);
    assert.equal(config.bed_size_y, 220);
    assert.equal('inherits' in config, false);
  }
});

test('rejects settings that exceed K1C hardware and nozzle profile limits', () => {
  for (const input of [
    { nozzleTemperature: 301 }, { bedTemperature: 101 }, { nozzleTemperature: NaN },
    { infill: -1 }, { infill: 101 }, { walls: 0 }, { walls: 2.5 }, { brim: Infinity },
    { layerHeight: 0.31 }, { layerHeight: 0.01 },
  ]) assert.throws(() => buildConfig(input), RangeError);
});

test('different nozzle selections use matching upstream process widths and layer heights', () => {
  assert.equal(getProfileSummary({ nozzle: '0.4', quality: 'fine' }).layerHeight, 0.12);
  assert.equal(getProfileSummary({ nozzle: '0.6', quality: 'standard' }).layerHeight, 0.30);
  assert.equal(getProfileSummary({ nozzle: '0.8', quality: 'draft' }).layerHeight, 0.48);
  assert.deepEqual(buildConfig({ nozzle: '0.6' }).nozzle_diameter, ['0.6']);
  assert.notEqual(buildConfig({ nozzle: '0.4' }).line_width, buildConfig({ nozzle: '0.8' }).line_width);
});

test('temperature overrides affect first and subsequent layers on the selected build plate', () => {
  const summary = getProfileSummary({ nozzleTemperature: 215, bedTemperature: 60, bedType: 'High Temp Plate' });
  assert.equal(summary.firstLayerNozzleTemperature, 215);
  assert.equal(summary.nozzleTemperature, 215);
  assert.equal(summary.firstLayerBedTemperature, 60);
  assert.equal(summary.bedTemperature, 60);
});

test('solid infill uses an Orca supported solid pattern and settings cannot mutate defaults', () => {
  assert.equal(buildConfig({ infill: 100, infillPattern: 'gyroid' }).sparse_infill_pattern, 'rectilinear');
  const first = buildConfig();
  (first.nozzle_temperature as string[])[0] = '300';
  assert.equal(getProfileSummary().nozzleTemperature, 220);
  assert.equal(DEFAULT_SETTINGS.nozzleTemperature, null);
});

test('Elegoo Rapid PETG uses its sourced filament values with K1C machine settings', () => {
  for (const nozzle of ['0.4', '0.6', '0.8'] as const) {
    const config = buildConfig({ material: 'Elegoo Rapid PETG', nozzle });
    const generic = buildConfig({ material: 'PETG', nozzle });
    const summary = getProfileSummary({ material: 'Elegoo Rapid PETG', nozzle });
    assert.equal(summary.filamentProfileName, 'Elegoo Rapid PETG @K1C');
    assert.equal(summary.nozzleTemperature, 250);
    assert.equal(summary.firstLayerNozzleTemperature, 250);
    assert.equal(summary.maxVolumetricSpeed, 18);
    assert.deepEqual(config.filament_type, ['PETG']);
    assert.deepEqual(config.filament_vendor, ['Elegoo']);
    assert.deepEqual(config.filament_flow_ratio, ['0.99']);
    assert.deepEqual(config.filament_density, ['1.26']);
    assert.deepEqual(config.fan_min_speed, ['30']);
    assert.deepEqual(config.fan_max_speed, ['80']);
    assert.deepEqual(config.enable_pressure_advance, ['0']);
    assert.equal('pressure_advance' in config, false);
    for (const key of ['machine_start_gcode', 'machine_end_gcode', 'retraction_length', 'retraction_speed', 'nozzle_diameter', 'line_width', 'layer_height']) {
      assert.deepEqual(config[key], generic[key], `K1C ${key} remains matched to its nozzle`);
    }
    assert.equal('inherits' in config, false);
    assert.equal('compatible_printers' in config, false);
  }
});

test('Elegoo supported plates use 80C and ordinary PETG defaults remain unchanged', () => {
  for (const bedType of ['Textured PEI Plate', 'High Temp Plate', 'Engineering Plate'] as const) {
    const summary = getProfileSummary({ material: 'Elegoo Rapid PETG', bedType });
    assert.equal(summary.bedTemperature, 80);
    assert.equal(summary.firstLayerBedTemperature, 80);
  }
  const overridden = getProfileSummary({ material: 'Elegoo Rapid PETG', nozzleTemperature: 240, bedTemperature: 85 });
  assert.equal(overridden.nozzleTemperature, 240);
  assert.equal(overridden.firstLayerNozzleTemperature, 240);
  assert.equal(overridden.bedTemperature, 85);
  assert.equal(overridden.firstLayerBedTemperature, 85);
  const generic = getProfileSummary({ material: 'PETG' });
  assert.equal(generic.bedTemperature, 70);
  assert.equal(generic.maxVolumetricSpeed, 9);
});

test('all nozzle and quality presets use requested wall, infill and acceleration defaults', () => {
  assert.equal(DEFAULT_SETTINGS.walls, 3);
  for (const nozzle of ['0.4', '0.6', '0.8'] as const) {
    for (const quality of ['fine', 'standard', 'draft'] as const) {
      const config = buildConfig({ nozzle, quality });
      assert.equal(config.wall_loops, '3');
      assert.equal(config.wall_sequence, 'inner-outer-inner wall');
      assert.equal(config.ironing_pattern ?? 'rectilinear', 'rectilinear');
      assert.equal(config.wall_direction ?? 'ccw', 'ccw');
      assert.equal(config.sparse_infill_pattern, 'gyroid');
      assert.equal(config.default_acceleration, '5000');
      assert.equal(config.travel_acceleration, '5000');
      for (const key of ['inner_wall_acceleration', 'outer_wall_acceleration', 'top_surface_acceleration', 'initial_layer_acceleration']) {
        assert(Number(config[key]) <= 5000, `${nozzle} ${quality} ${key}`);
      }
      assert(Number(config.initial_layer_acceleration) <= 1000);
    }
  }
  assert.equal(buildConfig({ infillPattern: 'grid' }).sparse_infill_pattern, 'grid');
  assert.equal(buildConfig({ infill: 100 }).sparse_infill_pattern, 'rectilinear');
  assert.equal(getProfileSummary().acceleration, 5000);
});

test('KAMP startup enables helper modes without adding duplicate calibration or purge', () => {
  const config = buildConfig();
  const startup = String(config.machine_start_gcode);
  assert.equal(DEFAULT_SETTINGS.startupMode, 'kamp');
  assert.equal(config.gcode_label_objects, '1');
  assert.equal(config.exclude_object, '1');
  assert(startup.includes('_ADAPTIVE_BED_MESH_ON\n_ADAPTIVE_PURGE_LINE_ON\nSTART_PRINT'));
  assert.equal(startup.split('\n').filter(line => line.startsWith('START_PRINT ')).length, 1);
  assert(!/^(G28|BED_MESH_CALIBRATE|_?LINE_PURGE|CX_PRINT_DRAW_ONE_LINE)(?:\s|$)/m.test(startup));
  assert(startup.includes('M83\nG92 E0'));
  const standard = String(buildConfig({ startupMode: 'standard' }).machine_start_gcode);
  assert(standard.startsWith('START_PRINT EXTRUDER_TEMP='));
  assert(!standard.includes('_ADAPTIVE_'));
});
