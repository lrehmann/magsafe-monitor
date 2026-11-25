#!/usr/bin/env python3
import json
import shlex
import struct
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8778
AUTHORITY = f"{HOST}:{PORT}"
ORIGIN = f"http://{AUTHORITY}"
PROPERTY_NAMES = {
    1: "manufacturer",
    2: "model",
    4: "hardware",
    5: "activeFirmware",
    6: "stagedFirmware",
    7: "statistics",
    8: "lastError",
}
FEATURE_NAMES = {
    0xB4: "firmwareBuild",
    0x13: "productionMode",
    0x40: "provisioningStatus",
    0xE0: "bootDiagnostics",
    0xB2: "updateStatus",
    0xBA: "bootloaderRevision",
    0xBB: "componentRevisions",
    0xBC: "hardwareProductId",
}


def read_features(binary):
    try:
        result = subprocess.run([binary, "--features"], capture_output=True, text=True, timeout=6)
    except subprocess.TimeoutExpired:
        return {}
    if result.returncode:
        return {}

    readings = {}
    for line in result.stdout.splitlines():
        raw_id, raw_value = line.split()
        report = int(raw_id, 16)
        payload = bytes.fromhex(raw_value)
        if report in (0xB4, 0xBA, 0xBC) and len(payload) == 2:
            value = f"0x{int.from_bytes(payload, 'little'):04X}"
        elif report == 0xBB and len(payload) % 2 == 0:
            value = " · ".join(f"0x{word:04X}" for (word,) in struct.iter_unpack("<H", payload))
        else:
            value = payload.hex(" ").upper()
        readings[FEATURE_NAMES[report]] = {"value": value, "reportId": report, "hex": payload.hex(" ").upper()}
    return readings


def read_magsafe(binary, live_probe):
    result = subprocess.run([binary], capture_output=True, text=True, timeout=9)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "The USB probe did not finish.")

    values = {}
    product = None
    for line in result.stdout.splitlines():
        fields = line.split()
        if fields[0] == "usb":
            product, version = map(int, fields[1:])
            values["usbIdentity"] = {"value": f"05AC:{product:04X} · USB version 0x{version:04X}"}
            continue
        if fields[0] == "version":
            values["protocolVersion"] = int(fields[2])
            continue
        prop = int(fields[1])
        apple_property = fields[0].startswith("apple-")
        key = "hardwareFusingType" if apple_property else PROPERTY_NAMES[prop]
        if fields[0] in ("timeout", "apple-timeout"):
            values[key] = {"error": "No reply"}
            continue
        status = int(fields[2])
        if status:
            values[key] = {"error": f"Device status {status}"}
            continue
        payload = bytes.fromhex(fields[3]) if len(fields) == 4 else b""
        if apple_property or prop in (1, 2, 4):
            value = payload.decode("utf-8", errors="replace")
        elif prop in (5, 6) and len(payload) == 16:
            version = struct.unpack(">4I", payload)
            value = ".".join(map(str, version)) if any(version) else "None"
        else:
            value = payload.hex(" ").upper()
        values[key] = {"value": value, "hex": payload.hex(" ").upper()}
    if product == 0x0500 and live_probe:
        values.update(read_features(live_probe))
    return values


class Handler(SimpleHTTPRequestHandler):
    lock = Lock()
    live_lock = Lock()

    def __init__(self, *args):
        super().__init__(*args, directory=str(ROOT / "dist"))

    def do_GET(self):
        if self.headers.get("Host") != AUTHORITY:
            self.send_error(403)
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/charger-info", "/api/live"):
            self.send_error(404)
            return
        if self.headers.get("Host") != AUTHORITY or self.headers.get("Origin") != ORIGIN:
            self.send_error(403)
            return
        if self.headers.get("Content-Length") != "0" or self.headers.get("Transfer-Encoding"):
            self.send_error(400)
            return
        if self.path == "/api/live":
            self.stream_charger()
            return
        with self.lock:
            try:
                self.json_response(200, read_magsafe(self.server.probe, self.server.live_probe))
            except RuntimeError as error:
                self.json_response(503, {"error": str(error)})
            except subprocess.TimeoutExpired:
                self.json_response(504, {"error": "The USB probe timed out."})

    def stream_charger(self):
        if not self.server.live_probe:
            self.json_response(503, {"error": "The local server needs libusb to start the live monitor."})
            return
        if not self.live_lock.acquire(blocking=False):
            self.json_response(409, {"error": "A live monitor is already running. Stop it before starting another."})
            return
        try:
            self.connection.settimeout(3)
            with subprocess.Popen([self.server.live_probe], stdout=subprocess.PIPE) as monitor:
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    for line in monitor.stdout:
                        self.wfile.write(line)
                except (ConnectionError, TimeoutError):
                    pass
                finally:
                    if monitor.poll() is None:
                        monitor.terminate()
                        try:
                            monitor.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            monitor.kill()
                            monitor.wait()
        finally:
            self.live_lock.release()

    def json_response(self, status, result):
        payload = json.dumps(result).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main():
    tools = Path("/Library/Developer/CommandLineTools")
    clang = tools / "usr/bin/clang"
    compiler = [str(clang), "-isysroot", str(tools / "SDKs/MacOSX.sdk")] if clang.is_file() else ["xcrun", "clang"]
    native_flags = ["-Wall", "-Wextra", "-Werror", "-framework", "IOKit", "-framework", "CoreFoundation"]
    with tempfile.TemporaryDirectory(prefix="magsafe-diagnostics-") as temporary:
        binary = str(Path(temporary) / "uarp-probe")
        subprocess.run([
            *compiler, *native_flags, "-o", binary, str(ROOT / "uarp-probe.c"),
        ], check=True)
        live_probe = str(Path(temporary) / "live-probe")
        try:
            usb_flags = subprocess.check_output(["pkg-config", "--cflags", "--libs", "libusb-1.0"], text=True)
            subprocess.run([
                *compiler, *native_flags, "-o", live_probe, str(ROOT / "live-probe.c"), *shlex.split(usb_flags),
            ], check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            live_probe = None
        with ThreadingHTTPServer((HOST, PORT), Handler) as server:
            server.probe = binary
            server.live_probe = live_probe
            print(f"MagSafe Diagnostics available at {ORIGIN}/", flush=True)
            server.serve_forever()


if __name__ == "__main__":
    main()
