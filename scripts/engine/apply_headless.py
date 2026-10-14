#!/usr/bin/env python3
"""Apply the pinned Orca 2.4.2 headless G-code memory patch.

Usage: python apply_headless.py /path/to/orca
Compile ALL Orca translation units with -DORCA_WASM_HEADLESS_GCODE=1.
The script deliberately fails on an unrecognized source version. It does not
modify print settings, bridge APIs, emitted G-code or timing planner settings.
"""
from pathlib import Path
import argparse
import hashlib

FLAG = 'ORCA_WASM_HEADLESS_GCODE'
MARKER = '// Pocket Slicer: bounded native G-code preview retention.'

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError(f'Expected exactly one source anchor: {old[:100]!r}')
    return source.replace(old, new, 1)

def guard(source, begin, end, condition):
    start = source.index(begin)
    stop = source.index(end, start)
    return source[:start] + f'#if {condition}\n' + source[start:stop].rstrip('\n') + '\n#endif\n' + source[stop:]

def patch_header(source):
    source = replace_once(source, '            EMoveType move_type{ EMoveType::Noop };\n', '''            EMoveType move_type{ EMoveType::Noop };
#ifdef ORCA_WASM_HEADLESS_GCODE
            // The desktop cache filter uses the referenced preview vertex type.
            // A seam marker can occupy that index even for a physical travel.
            EMoveType headless_cache_move_type{ EMoveType::Noop };
#endif
''')
    source = replace_once(source, '        GCodeProcessorResult m_result;\n', '''#ifdef ORCA_WASM_HEADLESS_GCODE
        // Pocket Slicer: bounded native G-code preview retention.
        // The existing native validation uses only XY bounds and maximum Z.
        // Each point array holds its minimum and maximum, never all toolpaths.
        struct HeadlessGCodePosInfo {
            Points pos;
            Points pos_custom;
            float max_print_z { 0.0f };
            float max_print_z_custom { 0.0f };
        };
        std::map<int, std::map<int, HeadlessGCodePosInfo>> m_headless_gcode_path_pos;
#endif
        GCodeProcessorResult m_result;
''')
    source = guard(source,
        '                GCodeProcessorResult::MoveVertex& move = m_result.moves.emplace_back(m_result.moves[*m_move_id]);\n',
        '                m_result.custom_gcode_per_print_z[*m_custom_gcode_per_print_z_id].print_z = position.z();\n',
        '!defined(ORCA_WASM_HEADLESS_GCODE)')
    return source

def patch_cpp(source):
    source = replace_once(source,
        '        result.moves[block.move_id].time[static_cast<size_t>(mode)] = block_time;\n',
        '''#ifndef ORCA_WASM_HEADLESS_GCODE
        result.moves[block.move_id].time[static_cast<size_t>(mode)] = block_time;
#endif
''')
    start = source.index('        // detect actual speed moves required to render toolpaths using actual speed\n')
    stop = source.index('        g1_times_cache.push_back(', start)
    old = source[start:stop]
    source = source[:start] + '''#ifdef ORCA_WASM_HEADLESS_GCODE
        // Native visualization is unused in the headless engine. Keep the
        // original time-cache filtering; only omit the visualization vertices.
        if (mode == PrintEstimatedStatistics::ETimeMode::Normal &&
            block.headless_cache_move_type != EMoveType::Extrude &&
            block.headless_cache_move_type != EMoveType::Travel &&
            block.headless_cache_move_type != EMoveType::Wipe)
            continue;
#else
''' + old + '#endif\n' + source[stop:]
    source = replace_once(source, '        block.move_id = static_cast<unsigned int>(m_result.moves.size());\n', '''        block.move_id = static_cast<unsigned int>(m_result.moves.size());
#ifdef ORCA_WASM_HEADLESS_GCODE
        block.headless_cache_move_type = type;
#endif
''')
    source = replace_once(source, '                store_move_vertex(EMoveType::Seam);\n', '''                store_move_vertex(EMoveType::Seam);
#ifdef ORCA_WASM_HEADLESS_GCODE
                // Upstream gives this marker the just-queued block's preview ID.
                // Preserve its cache filtering without retaining the vertex list.
                for (TimeMachine& machine : m_time_processor.machines)
                    if (machine.enabled && !machine.blocks.empty())
                        machine.blocks.back().headless_cache_move_type = EMoveType::Seam;
#endif
''')
    start = source.index('    struct GCodePosInfo\n')
    stop = source.index('    bool valid = true;\n', start)
    old = source[start:stop]
    source = source[:start] + '''#ifdef ORCA_WASM_HEADLESS_GCODE
    using GCodePosInfo = HeadlessGCodePosInfo;
    const auto& gcode_path_pos = m_headless_gcode_path_pos;
#else
''' + old + '#endif\n\n' + source[stop:]
    source = replace_once(source, '    m_result.reset();\n', '''    m_result.reset();
#ifdef ORCA_WASM_HEADLESS_GCODE
    m_headless_gcode_path_pos.clear();
#endif
''')
    source = replace_once(source, '    m_result.moves.push_back({\n', '''#ifdef ORCA_WASM_HEADLESS_GCODE
    // Only the latest vertex is needed by seam detection and marker height
    // bookkeeping. Historical vertices and per-move annotations are desktop
    // preview data, independent of the planner and exported instructions.
    m_result.moves.clear();
#endif
    m_result.moves.push_back({
''')
    source = replace_once(source, '''        m_print_z
    });

    if (type == EMoveType::Seam) {''', '''        m_print_z
    });

#ifdef ORCA_WASM_HEADLESS_GCODE
    if (type == EMoveType::Extrude) {
        auto& bounds = m_headless_gcode_path_pos[m_object_label_id][filament_id];
        const bool custom = m_extrusion_role == ExtrusionRole::erCustom;
        Points& points = custom ? bounds.pos_custom : bounds.pos;
        auto extend_xy = [&points](const Vec3f& position) {
            const Point point(scale_(double(position.x())), scale_(double(position.y())));
            if (points.empty()) {
                points.push_back(point);
                points.push_back(point);
            } else {
                points[0].x() = std::min(points[0].x(), point.x());
                points[0].y() = std::min(points[0].y(), point.y());
                points[1].x() = std::max(points[1].x(), point.x());
                points[1].y() = std::max(points[1].y(), point.y());
            }
        };
        extend_xy(m_result.moves.back().position);
        // Include both extrusion endpoints. This also encloses any desktop
        // acceleration visualization points interpolated along the segment.
        extend_xy(Vec3f(m_start_position[X] + m_x_offset,
                        m_start_position[Y] + m_y_offset, 0.0f)
                  + m_extruder_offsets[filament_id]);
        float& max_z = custom ? bounds.max_print_z_custom : bounds.max_print_z;
        max_z = std::max(max_z, m_print_z);
    }
#endif

    if (type == EMoveType::Seam) {''')
    # This block is empty in headless mode because TimeMachine never produces
    # ActualSpeedMove records. Guard it explicitly to exclude historical indices.
    source = guard(source,
        '    // insert actual speed moves into the move list\n',
        '\n}\n\nvoid GCodeProcessor::simulate_st_synchronize',
        '!defined(ORCA_WASM_HEADLESS_GCODE)')
    return source

PATCHERS = {
    'src/libslic3r/GCode/GCodeProcessor.hpp': patch_header,
    'src/libslic3r/GCode/GCodeProcessor.cpp': patch_cpp,
}
# Source commit 8500fcdccaa10b5099ac20d252af3a7c560046f1, OrcaSlicer v2.4.2.
SOURCE_SHA256 = {
    'src/libslic3r/GCode/GCodeProcessor.hpp': '1a4e381a946237c66d80efc9219023fb6a83b04acfb35f8f3a208c2514f29fda',
    'src/libslic3r/GCode/GCodeProcessor.cpp': '990e7b1131b4c28ceda60992b101c4bbae0d3ffca79df9f0d99c9ebae89aa976',
}
PATCHED_SHA256 = {
    'src/libslic3r/GCode/GCodeProcessor.hpp': 'b94f9c9ee49e6bfcd81f675e1bfcc196522212e9b3077cb7d061cb7752680b8c',
    'src/libslic3r/GCode/GCodeProcessor.cpp': '8f64fd286a0d934e5b257c81f2c2fb8de2eb5fb2b6ed220ba393d393205da696',
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('orca', type=Path)
    args = parser.parse_args()
    updates = []
    for relative, patcher in PATCHERS.items():
        path = args.orca / relative
        original = path.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        if digest == PATCHED_SHA256[relative]:
            print(f'Already patched: {relative}')
            continue
        if digest != SOURCE_SHA256[relative]:
            raise RuntimeError(f'Unrecognized source for {relative}: {digest}; refusing a partial or misplaced patch.')
        result = patcher(original.decode('utf-8')).encode('utf-8')
        if hashlib.sha256(result).hexdigest() != PATCHED_SHA256[relative]:
            raise RuntimeError(f'Patch output checksum mismatch: {relative}')
        updates.append((path, result))
    for path, result in updates:
        path.write_bytes(result)
        print(f'Patched: {path}')
    print('Required main-build compiler definition: -DORCA_WASM_HEADLESS_GCODE=1')

if __name__ == '__main__':
    main()
