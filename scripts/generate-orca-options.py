#!/usr/bin/env python3
"""Extract presentation metadata from the exact Orca source used by our WASM.

Usage: python scripts/generate-orca-options.py /path/to/OrcaSlicer
This parses only PrintConfigDef common/FFF declarations, not SLA, CLI options,
or G-code placeholders. Dynamic axis and filament-override definitions are
expanded using their upstream definitions. No runtime C++ or WASM is modified.
"""
import ast
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

COMMIT = '8500fcdccaa10b5099ac20d252af3a7c560046f1'
root = Path(sys.argv[1])
assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
raw = (root / 'src/libslic3r/PrintConfig.cpp').read_text()
# Preserve literal contents when stripping comments.
source = re.sub(r'("(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*)',
                lambda m: m[0] if m[0].startswith('"') else '\n' * m[0].count('\n'), raw)
body = source[source.index('void PrintConfigDef::init_common_params()'):source.index('void PrintConfigDef::init_extruder_option_keys()')]
strings = re.compile(r'(?:u8)?("(?:\\.|[^"\\])*")')


def text(expression):
    return ''.join(ast.literal_eval(m[1]) for m in strings.finditer(expression))


def statement(block, field):
    match = re.search(r'def->' + field + r'\s*=\s*', block)
    if not match:
        return ''
    expression = block[match.end():]
    # Find the first semicolon outside a string.
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|;', expression):
        if token[0] == ';':
            return expression[:token.start()]
    return ''


def number(expression):
    expression = expression.strip().replace('INITIAL_LAYER_HEIGHT', '0.2').replace('INITIAL_RAFT_LAYERS', '0')
    expression = re.sub(r'(?<=[\d.])[fF]\b', '', expression)
    if re.fullmatch(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', expression):
        value = float(expression)
        return int(value) if value.is_integer() else value
    return None


enum_maps = {}
for match in re.finditer(r'static (?:const )?t_config_enum_values\s+s_keys_map_(\w+)\s*(?:=\s*)?\{([\s\S]*?)\n\};', source):
    enum_maps[match[1]] = {value.strip().split('::')[-1].rstrip(')'): key for key, value in
                         re.findall(r'\{\s*"([^"]+)"\s*,\s*([^}]+)\}', match[2])}


def default_value(block, kind):
    match = re.search(r'def->set_default_value\(new ConfigOption\w+(?:<([^>]+)>)?\s*([({])([\s\S]*?)\);', block)
    if not match:
        return None
    expression = match[3].strip().rstrip(')}').strip().strip('{}')
    if 'nil_value' in expression:
        return ['nil'] if kind.endswith('s') else 'nil'
    if kind in ('coString', 'coStrings'):
        values = [ast.literal_eval(m[1]) for m in strings.finditer(expression)]
        return (values if values else []) if kind == 'coStrings' else (''.join(values) if values else '')
    if kind in ('coEnum', 'coEnums'):
        token = expression.split('::')[-1]
        registry_type = re.search(r'(?:ConfigOptionEnum<|s_keys_map_)(\w+)', statement(block, 'enum_keys_map'))
        value = enum_maps.get(match[1] or (registry_type[1] if registry_type else ''), {}).get(token)
        return ([value] if kind == 'coEnums' else value) if value is not None else None
    if kind in ('coPoint', 'coPoints'):
        points = re.findall(r'Vec2d\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*\)', expression)
        values = [f'{number(x)}x{number(y)}' for x, y in points]
        return values if kind == 'coPoints' else (values[0] if values else None)
    if kind == 'coPointsGroups':
        return []
    parts = [part.strip() for part in expression.split(',')]
    if kind == 'coFloatOrPercent' and len(parts) == 2:
        value = number(parts[0])
        return str(value) + ('%' if parts[1] == 'true' else '') if value is not None else None
    values = []
    for part in parts:
        if part in ('true', 'INITIAL_REDUCE_CROSSING_WALL'):
            values.append('0' if part == 'INITIAL_REDUCE_CROSSING_WALL' else '1')
        elif part == 'false':
            values.append('0')
        elif (value := number(part)) is not None:
            values.append(str(value) + ('%' if kind in ('coPercent', 'coPercents') else ''))
        else:
            return None
    return values if kind.endswith('s') else (values[0] if values else None)


definitions = list(re.finditer(r'def\s*=\s*this->add\(\s*"([^"\n]+)"(\s*\+\s*axis.name)?\s*,\s*(co\w+)\s*\)', body))
options = {}
aliases = {}
for index, match in enumerate(definitions):
    block = body[match.end():definitions[index + 1].start() if index + 1 < len(definitions) else len(body)]
    # The dynamically generated filament override block must not leak metadata
    # onto the last preceding literal definition.
    block = block.split('for (auto& opt_key : filament_extruder_override_keys)')[0]
    key, axis, kind = match[1], match[2], match[3]
    row = {'key': key, 'type': kind[2:], 'label': text(statement(block, 'full_label')) or text(statement(block, 'label')) or key.replace('_', ' ').capitalize(),
           'category': text(statement(block, 'category')), 'tooltip': text(statement(block, 'tooltip')),
           'unit': text(statement(block, 'sidetext')), 'mode': statement(block, 'mode').replace('com', '').lower() or 'simple'}
    for field in ('min', 'max'):
        if (value := number(statement(block, field))) is not None:
            row[field] = value
    for field in ('nullable', 'multiline', 'readonly'):
        if statement(block, field).strip() == 'true':
            row[field] = True
    for field in ('enum_values', 'enum_labels'):
        values = [text(m[1]) for m in re.finditer(r'def->' + field + r'\.push_back\(((?:"(?:\\.|[^"\\])*"|[^;])+?)\);', block)]
        assigned = statement(block, field)
        if assigned.strip().startswith('{'):
            values = [ast.literal_eval(m[1]) for m in strings.finditer(assigned)]
        elif '->' in assigned:
            target = aliases.get(assigned.split('->')[0].strip())
            if target:
                values = target.get('choices' if field == 'enum_values' else 'choiceLabels', [])
        if values:
            row['choices' if field == 'enum_values' else 'choiceLabels'] = values
    if kind in ('coEnum', 'coEnums') and 'choices' not in row:
        registry = statement(block, 'enum_keys_map')
        enum_type = re.search(r'(?:ConfigOptionEnum<|s_keys_map_)(\w+)', registry)
        if enum_type and enum_type[1] in enum_maps:
            row['choices'] = list(enum_maps[enum_type[1]].values())
    if (value := default_value(block, kind)) is not None:
        row['defaultValue'] = value
    if axis:
        for letter in 'xyze':
            expanded = dict(row, key=key + letter, label=key.replace('machine_max_', 'Maximum ').replace('_', ' ').strip() + ' ' + letter.upper())
            expanded.pop('defaultValue', None)
            options[expanded['key']] = expanded
    else:
        options[key] = row
    for alias in re.findall(r'(\w+)\s*=\s*def\s*;', block):
        aliases[alias] = row

override_block = source.split('const std::vector<std::string> filament_extruder_override_keys = {', 1)[1].split('};', 1)[0]
for key in re.findall(r'"([^"]+)"', override_block):
    row = copy.deepcopy(options[key.removeprefix('filament_')])
    row.update(key=key, category='Filament overrides', nullable=True, mode='advanced')
    row['defaultValue'] = ['nil']
    options[key] = row

output = {'version': '2.4.2', 'commit': COMMIT,
          'source': f'https://github.com/OrcaSlicer/OrcaSlicer/blob/{COMMIT}/src/libslic3r/PrintConfig.cpp',
          'options': sorted(options.values(), key=lambda option: option['key'])}
destination = Path(__file__).resolve().parents[1] / 'src/lib/orca-options.json'
destination.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Generated {len(options)} native common/FFF options in {destination}')
