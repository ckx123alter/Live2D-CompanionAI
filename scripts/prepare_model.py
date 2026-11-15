"""Prepare application-specific indexes on a locally supplied model copy."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOTIONS = {
    'Rest': '举手切默认手',
    'Point': '竖手指切出来动画',
    'Wave': '默认手切举手',
    'Grass': '狗尾草切换出来',
    'RestGrass': '狗尾草切回默认手',
    'RestPoint': '竖手指切回默认',
}


def prepare(directory: Path, check=False):
    directory = directory.resolve()
    entry = directory / '大肥鱼.model3.json'
    data = json.loads(entry.read_text(encoding='utf-8-sig'))
    refs = data['FileReferences']
    expressions = sorted((directory / 'Exp3').glob('*.exp3.json'))
    if not expressions:
        raise ValueError('缺少 Exp3 表情目录，请保留原模型目录结构。')
    motions = {key: f'Animation/{name}.motion3.json' for key, name in MOTIONS.items()}
    required = [refs['Moc'], *refs['Textures'], refs['Physics'], refs['DisplayInfo'],
                'Animation/IDLE.motion3.json', '大肥鱼.png', *motions.values()]
    for relative in required:
        target = (directory / relative).resolve()
        if not target.is_relative_to(directory) or not target.is_file():
            raise ValueError(f'模型文件缺失或路径不合法：{relative}')
    motion_data = {name: json.loads((directory / name).read_text(encoding='utf-8-sig')) for name in motions.values()}
    refs['Expressions'] = [{'Name': path.name.removesuffix('.exp3.json'), 'File': path.relative_to(directory).as_posix()} for path in expressions]
    refs['Motions'] = {key: [{'File': name}] for key, name in motions.items()}
    if not check:
        entry.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        for name, motion in motion_data.items():
            motion.setdefault('Meta', {})['Loop'] = False
            (directory / name).write_text(json.dumps(motion, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Model resources checked.' if check else 'Model indexes prepared; hand motions set to non-looping.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, default=ROOT / 'frontend/public/model')
    parser.add_argument('--check', action='store_true', help='Validate files without modifying them')
    args = parser.parse_args()
    try:
        prepare(args.model_dir, args.check)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'{error}\n')
