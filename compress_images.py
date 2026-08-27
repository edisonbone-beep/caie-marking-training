#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compress oversized images in img/ for faster page loading.

Rules:
  - Images wider than MAX_WIDTH are downscaled (aspect ratio preserved).
  - Files larger than MAX_BYTES are re-encoded at JPEG_QUALITY.
  - Everything else is left untouched.

Usage:
  python3 compress_images.py          # compress in place
  python3 compress_images.py --dry    # only report what would change

Recommended to run before committing any newly imported paper scans.
"""
import os
import sys
from PIL import Image

IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img')
MAX_WIDTH = 2000        # px - plenty for on-screen viewing at full zoom
MAX_BYTES = 400 * 1024  # 400 KB
JPEG_QUALITY = 80


def process(dry=False):
    files = sorted(f for f in os.listdir(IMG_DIR) if f.lower().endswith(('.jpg', '.jpeg')))
    total_before = 0
    total_after = 0
    changed = 0

    for name in files:
        path = os.path.join(IMG_DIR, name)
        size = os.path.getsize(path)
        total_before += size

        im = Image.open(path)
        im.load()
        w, h = im.size

        needs_resize = w > MAX_WIDTH
        needs_reencode = size > MAX_BYTES
        if not needs_resize and not needs_reencode:
            total_after += size
            continue

        new_w = min(w, MAX_WIDTH)
        new_h = round(h * new_w / w)
        if needs_resize:
            im = im.resize((new_w, new_h), Image.LANCZOS)

        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')

        if dry:
            est = '~? KB (dry run)'
            print('[dry] %-22s %dx%d %4dKB -> %dx%d %s' % (name, w, h, size // 1024, new_w, new_h, est))
            total_after += size
            continue

        im.save(path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        new_size = os.path.getsize(path)
        total_after += new_size
        changed += 1
        print('%-22s %dx%d %4dKB -> %dx%d %4dKB  (%.0f%%)' % (
            name, w, h, size // 1024, new_w, new_h, new_size // 1024,
            (1 - new_size / size) * 100))

    print('\n%d file(s) changed' % changed)
    print('total: %.1f MB -> %.1f MB (saved %.1f MB)' % (
        total_before / 1e6, total_after / 1e6, (total_before - total_after) / 1e6))


if __name__ == '__main__':
    process(dry='--dry' in sys.argv)
