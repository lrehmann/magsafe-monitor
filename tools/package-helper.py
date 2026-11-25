"""Build the Mac helper ZIP from the dashboard and native probe sources."""

from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUTPUT = DIST / "magsafe-mac-helper.zip"


def main():
    native_files = [
        "serve.py", "live-probe.c", "charger-usb.h", "uarp-probe.c", "mac-helper-readme.txt",
    ]
    web_files = [
        file.relative_to(ROOT)
        for file in DIST.iterdir()
        if file.suffix in {".html", ".css", ".mjs"}
    ]
    files = sorted([Path(name) for name in native_files] + web_files)
    with TemporaryDirectory(dir=DIST) as temporary:
        archive = Path(temporary) / OUTPUT.name
        with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
            for file in files:
                bundle.write(ROOT / file, Path("magsafe-mac-helper") / file)
        archive.replace(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
