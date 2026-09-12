"""Generate the IDE's icons from the brand asset.

    python apps/desktop/scripts/generate-icons.py <fork root> [--verify]

Writes every icon file the Windows, macOS and Linux bundles and the About
window read, then reopens each one and checks its sizes. With --verify it
only checks. The four release channels share one mark: the IDE ships
`stable`, and the other three exist because the About window compiles one
image per channel.
"""

import sys
from pathlib import Path

from PIL import Image

SOURCE = Path(__file__).resolve().parents[2] / "web" / "public" / "knightcode-icon.png"
CHANNELS = ["", "-dev", "-nightly", "-preview"]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
# Pixel sizes. Pillow writes the 16pt icon only as its @2x (32px) entry;
# macOS scales that down for 1x displays.
ICNS_SIZES = [32, 64, 128, 256, 512, 1024]


def outputs(fork: Path) -> dict[Path, tuple[str, list[int]]]:
    resources = fork / "crates" / "zed" / "resources"
    files: dict[Path, tuple[str, list[int]]] = {}
    for channel in CHANNELS:
        files[resources / f"app-icon{channel}.png"] = ("PNG", [512])
        files[resources / f"app-icon{channel}@2x.png"] = ("PNG", [1024])
        files[resources / "windows" / f"app-icon{channel}.ico"] = ("ICO", ICO_SIZES)
    # DocumentTypes.plist names "Document"; upstream uses the app mark here too.
    files[resources / "Document.icns"] = ("ICNS", ICNS_SIZES)
    return files


def write(path: Path, kind: str, sizes: list[int], source: Image.Image) -> None:
    if kind == "PNG":
        source.resize((sizes[0], sizes[0]), Image.Resampling.LANCZOS).save(path, optimize=True)
    elif kind == "ICO":
        source.save(path, format="ICO", sizes=[(size, size) for size in sizes])
    else:
        source.save(path, format="ICNS")


def verify(path: Path, kind: str, sizes: list[int]) -> str:
    with Image.open(path) as image:
        assert image.format == kind, f"{path}: {image.format}, expected {kind}"
        if kind == "PNG":
            assert image.size == (sizes[0], sizes[0]), f"{path}: {image.size}"
            return f"{image.size[0]}x{image.size[1]}"
        if kind == "ICO":
            found = sorted(width for width, _ in image.info["sizes"])
            assert found == sizes, f"{path}: {found}, expected {sizes}"
            return ",".join(map(str, found))
        found = sorted({width * scale for width, _, scale in image.info["sizes"]})
        assert found == sizes, f"{path}: {found}, expected {sizes}"
        entries = image.info["sizes"]
    for width, height, scale in entries:
        with Image.open(path) as entry:
            entry.size = (width, height)
            entry.load(scale)
            assert entry.size == (width * scale, height * scale), f"{path}: entry {width}@{scale}x"
    return f"{len(entries)} entries, {','.join(map(str, found))}"


def main() -> None:
    args = [arg for arg in sys.argv[1:] if arg != "--verify"]
    if len(args) != 1:
        sys.exit(__doc__)
    fork = Path(args[0]).resolve()
    files = outputs(fork)

    if "--verify" not in sys.argv:
        source = Image.open(SOURCE).convert("RGBA")
        assert source.size == (1024, 1024), f"{SOURCE}: {source.size}, expected 1024x1024"
        for path, (kind, sizes) in files.items():
            write(path, kind, sizes, source)

    for path, (kind, sizes) in files.items():
        print(f"{path.relative_to(fork)}: {kind} {verify(path, kind, sizes)}")


if __name__ == "__main__":
    main()
