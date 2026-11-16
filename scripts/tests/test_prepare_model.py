import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from scripts.prepare_model import prepare_mobile


class MobileModelTests(unittest.TestCase):
    def test_atlas_resize_preserves_originals_aspect_ratio_and_other_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            atlas = root / 'original.png'
            Image.new('RGBA', (4096, 1024), (123, 45, 67, 128)).save(atlas)
            original = atlas.read_bytes()
            data = {'Version': 3, 'FileReferences': {'Textures': ['original.png'],
                    'Moc': 'original.moc3', 'Physics': 'original.physics3.json',
                    'Motions': {'Wave': [{'File': 'Animation/wave.motion3.json'}]}}}
            before = json.dumps(data)
            prepare_mobile(root, data)
            self.assertEqual(atlas.read_bytes(), original)
            self.assertEqual(json.dumps(data), before)
            entry = root / '大肥鱼.mobile.model3.json'
            mobile = json.loads(entry.read_text(encoding='utf-8'))
            texture = root / mobile['FileReferences'].pop('Textures')[0]
            self.assertEqual(mobile['FileReferences'], {k: v for k, v in data['FileReferences'].items() if k != 'Textures'})
            with Image.open(texture) as image:
                self.assertEqual(image.size, (2048, 512))
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.getpixel((0, 0))[3], 128)
            stamps = (texture.stat().st_mtime_ns, entry.stat().st_mtime_ns)
            prepare_mobile(root, data)
            self.assertEqual(stamps, (texture.stat().st_mtime_ns, entry.stat().st_mtime_ns))


if __name__ == '__main__':
    unittest.main()
