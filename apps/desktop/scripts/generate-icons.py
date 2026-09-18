"""Generate the IDE's icons and in-UI marks from the brand assets.

    python apps/desktop/scripts/generate-icons.py <fork root> [--verify]

Writes every icon file the Windows, macOS and Linux bundles and the About
window read, then reopens each one and checks its sizes. With --verify it
only checks. The four release channels share one mark: the IDE ships
`stable`, and the other three exist because the About window compiles one
image per channel.

There are two brand sources, because the two jobs want different things.
The application icon comes from the full-colour `knightcode-icon.png`: an
app icon is rendered at 512 px and larger, where colour and depth are the
point. The in-UI marks come from `knightcode-mark.svg`, a monochrome
silhouette of the same knight in a 16-unit box — the trace in
`packages/ai/src/auth/oauth/oauth-page.ts` that the CLI's terminal logo is
rasterised from, with the eye cut out — because `gpui` renders an icon as a
mask that the theme colours, so a colour source would be thrown away.

The in-UI files keep their upstream file names. They are internal
identifiers behind `IconName` and `VectorName`, nothing renders the name,
and keeping them means all forty-odd call sites are fixed by the file
change alone and no merge conflicts are created.
"""

import re
import sys
from pathlib import Path

from PIL import Image

SOURCE = Path(__file__).resolve().parents[2] / "web" / "public" / "knightcode-icon.png"
MARK = Path(__file__).resolve().parents[2] / "web" / "public" / "knightcode-mark.svg"
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


# Each in-UI mark: the box it is drawn in, and how the knight is placed in it.
# `None` fills the box; a (x, y, scale) leaves room for whatever else the file
# draws, which for the prediction icons is what says accepted, rejected or off.
MARKS: dict[str, tuple[int, "tuple[float, float, float] | None"]] = {
    "assets/images/zed_logo.svg": (96, None),
    "assets/icons/ai_zed.svg": (16, None),
    "assets/icons/zed_agent.svg": (16, None),
    "assets/icons/zed_agent_two.svg": (16, None),
    "assets/icons/zed_src_custom.svg": (16, None),
    "assets/icons/zed_predict.svg": (16, (1.4, 4.4, 0.44)),
    "assets/icons/zed_predict_disabled.svg": (16, (1.4, 4.4, 0.44)),
    "assets/icons/zed_predict_up.svg": (16, (1.4, 4.4, 0.44)),
    "assets/icons/zed_predict_down.svg": (16, (1.4, 4.4, 0.44)),
    "assets/icons/zed_predict_error.svg": (16, (1.4, 4.4, 0.44)),
}

# What each prediction icon draws beside the mark. Replacing these with the mark
# as well would make "shown", "accepted", "rejected", "failed" and "off"
# indistinguishable in the status bar, which is the only place they appear.
DECORATIONS: dict[str, str] = {
    "assets/icons/zed_predict.svg": (
        '<path d="M12 5L14 8L12 11" stroke="black" stroke-width="1.2"/>\n'
        '<path d="M10 6.5L11 8L10 9.5" stroke="black" stroke-width="1.2"/>'
    ),
    "assets/icons/zed_predict_up.svg": (
        '<path d="M10 6.66667L10.5 6.33333L12.5 5L14.5 6.33333L15 6.66667" stroke="black" stroke-width="1.2"/>\n'
        '<path d="M12.5 11V5" stroke="black" stroke-width="1.2"/>'
    ),
    "assets/icons/zed_predict_down.svg": (
        '<path d="M10 9.33333L10.5 9.66667L12.5 11L14.5 9.66667L15 9.33333" stroke="black" stroke-width="1.2"/>\n'
        '<path d="M12.5 5V11" stroke="black" stroke-width="1.2"/>'
    ),
    "assets/icons/zed_predict_error.svg": (
        '<path d="M12.5 4.5V8.6" stroke="black" stroke-width="1.4" stroke-linecap="round"/>\n'
        '<path d="M12.5 10.9V11.1" stroke="black" stroke-width="1.4" stroke-linecap="round"/>'
    ),
    # A slash through the mark, which is what "off" looks like everywhere else.
    "assets/icons/zed_predict_disabled.svg": (
        '<path d="M2.2 13.8L13.8 2.2" stroke="black" stroke-width="1.4" stroke-linecap="round"/>'
    ),
}


def mark_body() -> str:
    """Everything inside the brand mark's `<svg>`, in its own 16-unit box."""
    match = re.search(r"<svg[^>]*>\s*(.*?)\s*</svg>", MARK.read_text(encoding="utf-8"), re.S)
    assert match and "<path" in match.group(1), f"{MARK}: no paths found"
    return match.group(1)


def mark_svg(box: int, placement, decoration: str) -> str:
    """One in-UI mark file. `gpui` masks these, so the fill colour is arbitrary
    and only the geometry matters."""
    path = mark_body()
    if placement is None:
        scale = box / 16
        body = path if scale == 1 else f'<g transform="scale({scale:g})">{path}</g>'
    else:
        x, y, scale = placement
        body = f'<g transform="translate({x:g} {y:g}) scale({scale:g})">{path}</g>'
    lines = [
        f'<svg width="{box}" height="{box}" viewBox="0 0 {box} {box}" fill="none" '
        'xmlns="http://www.w3.org/2000/svg">',
        body,
    ]
    if decoration:
        lines.append(decoration)
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


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
        for name, (box, placement) in MARKS.items():
            (fork / name).write_text(
                mark_svg(box, placement, DECORATIONS.get(name, "")),
                encoding="utf-8",
                newline="\n",
            )

    for path, (kind, sizes) in files.items():
        print(f"{path.relative_to(fork)}: {kind} {verify(path, kind, sizes)}")

    for name, (box, placement) in MARKS.items():
        expected = mark_svg(box, placement, DECORATIONS.get(name, ""))
        found = (fork / name).read_text(encoding="utf-8")
        assert found == expected, f"{name}: not the generated mark; re-run without --verify"
        print(f"{name}: SVG {box}x{box}")


if __name__ == "__main__":
    main()
