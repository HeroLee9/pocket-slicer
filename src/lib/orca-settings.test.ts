import {describe,it,expect} from 'vitest';
import {buildConfig} from '../profiles';
import {ORCA_OPTIONS,ORCA_OPTION_MAP,applyOverrides,exportProfileJSON,optionValue,parseProfileJSON,validateOverrides} from './orca-settings';

describe('native Orca parameter catalog',()=>{
  it('includes the whole common/FFF catalog, axis limits and nullable filament overrides',()=>{
    expect(ORCA_OPTIONS.length).toBe(677);
    expect(ORCA_OPTION_MAP.get('wall_sequence')?.choices).toContain('inner-outer-inner wall');
    expect(ORCA_OPTION_MAP.get('sparse_infill_pattern')?.choices).toContain('gyroid');
    expect(ORCA_OPTION_MAP.get('bottom_surface_pattern')?.choices).toContain('monotonic');
    expect(ORCA_OPTION_MAP.get('machine_max_acceleration_x')?.type).toBe('Floats');
    expect(ORCA_OPTION_MAP.get('filament_retraction_length')?.nullable).toBe(true);
    expect(ORCA_OPTION_MAP.has('support_pillar_diameter')).toBe(false);
    expect(ORCA_OPTION_MAP.has('rotate')).toBe(false);
  });
  it('applies settings last without mutating the K1C profile',()=>{
    const base=buildConfig();const result=applyOverrides(base,{wall_loops:'4',outer_wall_speed:'45',filament_start_gcode:[''],machine_end_gcode:'END_PRINT\n;custom'});
    expect(result.wall_loops).toBe('4');expect(base.wall_loops).not.toBe('4');expect(result.filament_start_gcode).toEqual(['']);expect(result.machine_end_gcode).toContain(';custom');expect(result.printable_height).toBe('250');
  });
  it('rejects unknown, GUI-only, incompatible and out-of-range values visibly',()=>{
    for(const value of [{invented:'1'},{post_process:['script.sh']},{printable_height:'500'},{wall_loops:'NaN'},{wall_loops:'2.4'},{nozzle_temperature:['301']},{textured_plate_temp:['101']},{support_type:'tree(manual)'},{brim_type:'painted'},{sparse_infill_pattern:'invented'}])expect(validateOverrides(value).length).toBeGreaterThan(0);
    expect(validateOverrides({wall_loops:'3',infill_wall_overlap:'20%',filament_retraction_length:['nil'],machine_max_acceleration_x:['5000','5000']})).toEqual([]);
    expect(validateOverrides({nozzle_temperature:['220','240']})[0]).toContain('single filament / extruder');
    expect(validateOverrides({retraction_length:['1','2']})[0]).toContain('single filament / extruder');
    expect(validateOverrides({filament_start_gcode:[]})[0]).toContain('enter one value');
    expect(validateOverrides({filament_start_gcode:['']})).toEqual([]);
    expect(validateOverrides({machine_max_acceleration_x:['5000','5000','5000']})[0]).toContain('2 values');
    expect(()=>applyOverrides(buildConfig(),{layer_height:'1'})).toThrow(/Layer height/);
    expect(()=>applyOverrides(buildConfig(),{sparse_infill_density:'100%',sparse_infill_pattern:'gyroid'})).toThrow(/100% infill/);
  });
  it('round-trips multiline strings and arrays without flattening G-code',()=>{
    const overrides={machine_start_gcode:'G28\n; quoted "code"; comma, semicolon',filament_start_gcode:['G92 E0\n;comment'],machine_max_acceleration_x:['5000','3000']};
    expect(parseProfileJSON(exportProfileJSON(overrides)).overrides).toEqual(overrides);
    expect(optionValue(ORCA_OPTION_MAP.get('machine_min_travel_rate')!,{machine_min_travel_rate:'0,0'})).toEqual(['0','0']);
  });
  it('requires a reviewable omission list for desktop metadata and unsupported settings',()=>{
    const imported=parseProfileJSON(JSON.stringify({name:'Desktop preset',inherits:'Parent preset',wall_loops:'4',printable_height:'500',printhost_apikey:'secret',post_process:['evil.sh']}));
    expect(imported.overrides).toEqual({wall_loops:'4'});expect(imported.omitted.map(x=>x.key)).toEqual(['name','inherits','printable_height','printhost_apikey','post_process']);expect(imported.notes[0]).toContain('Parent preset');expect(JSON.stringify(imported)).not.toContain('secret');expect(JSON.stringify(imported)).not.toContain('evil.sh');
    expect(()=>parseProfileJSON('{"wall_loops":"oops"}')).toThrow();
    expect(()=>parseProfileJSON('{"__proto__":{"polluted":true}}')).toThrow();
  });
});
