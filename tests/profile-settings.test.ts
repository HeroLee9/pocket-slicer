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
    assert.match(String(config.machine_start_gcode), /^START_PRINT EXTRUDER_TEMP=/);
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
