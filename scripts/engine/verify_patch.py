#!/usr/bin/env python3
"""Check pinned patch output, idempotency, and unchanged non-headless source."""
from pathlib import Path
import argparse
import importlib.util
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('orca', type=Path, help='Pinned Orca source checkout; git metadata must be present.')
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('headless_patch', ROOT / 'apply_headless.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)

# Remove only the new opt-in directives; preserve every upstream conditional.
def select_headless(text, enabled):
    result = []
    active = True
    stack = []
    for line in text.splitlines(keepends=True):
        directive = line.strip()
        if directive in ('#ifdef ORCA_WASM_HEADLESS_GCODE', '#ifndef ORCA_WASM_HEADLESS_GCODE', '#if !defined(ORCA_WASM_HEADLESS_GCODE)'):
            condition = enabled if directive.startswith('#ifdef') else not enabled
            stack.append((active, condition))
            active = active and condition
        elif directive == '#else' and stack:
            parent, condition = stack[-1]
            stack[-1] = (parent, not condition)
            active = parent and not condition
        elif directive == '#endif' and stack:
            active = stack.pop()[0]
        elif active:
            result.append(line)
    assert not stack
    return ''.join(result)

with tempfile.TemporaryDirectory(prefix='pocket-headless-patch-') as temporary:
    target = Path(temporary)
    for name, patcher in patch.PATCHERS.items():
        original = subprocess.check_output(['git', '-C', str(args.orca), 'show', f'8500fcdccaa10b5099ac20d252af3a7c560046f1:{name}']).decode()
        output = patcher(original)
        # Upstream #endifs outside the added blocks are preserved by this helper;
        # all newly guarded regions contain no pre-existing conditional directives.
        normal = select_headless(output, False)
        assert re.sub(r'\s+', '', normal) == re.sub(r'\s+', '', original), f'Default source changed: {name}'
        headless = select_headless(output, True)
        if name.endswith('.cpp'):
            for removed in ('result.moves[block.move_id]', 'actual_speed_moves.push_back', 'result.moves.insert'):
                assert removed not in headless, removed
            # A seam visualization marker occupies the queued movement's old
            # native vertex ID. Keep its original normal-mode cache filtering.
            assert 'block.headless_cache_move_type = type;' in headless
            assert 'machine.blocks.back().headless_cache_move_type = EMoveType::Seam;' in headless
            assert 'block.headless_cache_move_type != EMoveType::Extrude' in headless
            assert 'm_result.moves.clear();' in headless
            assert headless.count('m_result.moves.push_back({') == 1
            assert 'const auto& gcode_path_pos = m_headless_gcode_path_pos;' in headless
            for preserved in ('g1_times_cache.push_back(', 'time += double(block_time);', 'first_layer_time += block_time;', 'Polygon     path_poly(iter_points);', 'if (!plate_printable_bbox.contains(bbox))', 'm_used_filaments.process_caches(this);'):
                assert preserved in headless, preserved
        else:
            assert 'EMoveType headless_cache_move_type{ EMoveType::Noop };' in headless
            assert 'm_result.moves[*m_move_id]' not in headless
            assert 'm_result.moves.erase' not in headless
            assert 'm_result.custom_gcode_per_print_z[*m_custom_gcode_per_print_z_id].print_z = position.z();' in headless
        destination = target/name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(original)
    subprocess.run(['python', str(ROOT/'apply_headless.py'), str(target)], check=True)
    snapshot = {name: (target/name).read_bytes() for name in patch.PATCHERS}
    subprocess.run(['python', str(ROOT/'apply_headless.py'), str(target)], check=True)
    assert snapshot == {name: (target/name).read_bytes() for name in patch.PATCHERS}
    # Fail closed before writing anything if either source no longer matches.
    cpp = target/'src/libslic3r/GCode/GCodeProcessor.cpp'
    cpp.write_text(cpp.read_text()+'\n// unrelated modification\n')
    bad = subprocess.run(['python', str(ROOT/'apply_headless.py'), str(target)], capture_output=True, text=True)
    assert bad.returncode != 0 and 'Unrecognized source' in bad.stderr
print('PASS: pinned checksums, idempotency, fail-closed input, unchanged default branch, bounded-headless source invariants')
