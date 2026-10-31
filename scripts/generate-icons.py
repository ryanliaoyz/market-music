"""Generate the PWA's price-line icons with Python's standard library."""
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def icon(size):
    points = [(0.24, 0.61), (0.38, 0.45), (0.49, 0.55), (0.65, 0.34), (0.76, 0.40)]
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            px, py = x / size, y / size
            distance = 1
            for (ax, ay), (bx, by) in zip(points, points[1:]):
                t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
                distance = min(distance, ((px - ax - t * (bx - ax)) ** 2 + (py - ay - t * (by - ay)) ** 2) ** 0.5)
            rows.extend((157, 196, 255) if distance < 0.023 else (11, 13, 18))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


root = Path(__file__).resolve().parents[1] / "icons"
root.mkdir(exist_ok=True)
for name, size in [("icon-192", 192), ("icon-512", 512), ("icon-maskable-512", 512), ("apple-touch-icon-180", 180)]:
    (root / f"{name}.png").write_bytes(icon(size))
