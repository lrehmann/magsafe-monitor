# Build and test MagSafe Monitor

## Mac setup

You need desktop Chrome, Python 3, Apple's Command Line Tools, and `libusb` with `pkg-config`. If the Command Line Tools are absent, install them with `xcode-select --install`. With Homebrew, install the USB dependencies and start the monitor with:

```sh
brew install libusb pkg-config
git clone https://github.com/lrehmann/magsafe-monitor.git
cd magsafe-monitor
python3 serve.py
```

Open [the local monitor](http://127.0.0.1:8778/) in Chrome. Plug in one charger, click **Select charger**, grant USB access, and check **Charger diagnostics**. On a supported A2140, the **Live USB monitor** starts plotting as soon as samples arrive. **Stop monitoring** ends the session. An A2140 stream can be active in one helper session at a time.

The dashboard files in `dist/` are plain HTML, CSS, and JavaScript modules. The Python server compiles the macOS probes into a temporary directory at startup. It binds to the loopback address on port 8778 and serves diagnostics and newline-delimited telemetry to the local page and the approved hosted session.

## Test without hardware

Run the decoder and firmware-comparison tests with Node.js 20 or later:

```sh
node --test
```

To preview the responsive interface and the browser-only WebHID path, serve the static files:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open [the static preview](http://127.0.0.1:8080/) in desktop Chrome. The native USB path uses the Mac setup above. WebHID needs a secure context such as HTTPS or loopback. [Chrome's WebHID guide](https://developer.chrome.com/docs/capabilities/hid)

## Source map

| File | Purpose |
| --- | --- |
| [`dist/capture.mjs`](../dist/capture.mjs) | Device selection, HID listeners, dashboard diagnostics, and JSON export |
| [`dist/browser-uarp.mjs`](../dist/browser-uarp.mjs) and [`dist/uarp-replies.mjs`](../dist/uarp-replies.mjs) | Browser diagnostics and UARP response framing |
| [`dist/charger-profiles.mjs`](../dist/charger-profiles.mjs) | Supported USB IDs, interface names, and model-specific firmware comparisons |
| [`dist/dotara-stream.mjs`](../dist/dotara-stream.mjs) | A2140 binary record layouts and decoder |
| [`dist/live-field-labels.mjs`](../dist/live-field-labels.mjs) | Field names, scales, duplicate record sources, and chart groups |
| [`dist/live-monitor.mjs`](../dist/live-monitor.mjs) | Live readings, median smoothing, raw hex values, and plots |
| [`serve.py`](../serve.py), [`uarp-probe.c`](../uarp-probe.c), and [`live-probe.c`](../live-probe.c) | Local helper, macOS diagnostics, and A2140 streaming |
| [`dist/bridge.mjs`](../dist/bridge.mjs) and [`dist/hosted-helper.mjs`](../dist/hosted-helper.mjs) | Session approval and message transport between the hosted page and the loopback helper |
| [`worker.mjs`](../worker.mjs) | Cloudflare Worker for the public static files under `/magsafe-monitor/` |

The A2140 helper enables input reports for USB revisions `0x0174`, `0x0247`, `0x0255`, and `0x0258`. The main field layout was checked against live `0x0258` data. The `0x0174` branch maps a smaller set of firmware-matched records. Additional hardware captures are useful for both intermediate builds.

## Contribute a capture or decoder change

1. Record the charger model and active firmware from **Charger diagnostics**. Include the USB ID and `bcdDevice` revision when available.
2. Capture an idle baseline, then attach a phone and wait for a steady charging period. Remove it and record the approximate attach and removal times. Note the phone model and power source if they matter to the comparison.
3. Export the JSON and review it before attaching it to an issue or pull request. A short report excerpt around a transition is often enough. The JSON includes raw device replies, device and interface details, and capture timestamps.
4. For a field change, include the record ID, body-relative offset, proposed encoding, units or scale, and a brief explanation of how you reproduced the reading.

Browser export JSON contains `diagnostics`, `interfaces`, and `reports`. Each browser report has a host timestamp (`at`, in Unix milliseconds), interface ID, HID usage, report ID, and hex payload. WebHID delivers the report ID separately. Native helper telemetry arrives in a separate stream, where the A2140 decoder expects the report ID at the beginning of the frame. The browser's export follows its WebHID input log, so note which path produced a sample.

To record the native stream directly, start `serve.py` and stop any dashboard monitoring session. Run the command below during the test, then press Ctrl+C to finish the capture. Each line is a JSON message with a `type` such as `ready`, `report`, or `heartbeat`.

```sh
curl --fail --no-buffer --request POST \
  --header 'Origin: http://127.0.0.1:8778' --header 'Content-Length: 0' \
  http://127.0.0.1:8778/api/live --output magsafe-capture-native.ndjson
```

Decoded A2140 packets start with bytes `02 90`. The record header has a little-endian 32-bit firmware clock, 16-bit record kind, and 16-bit sequence number. Field offsets start at the record body, after the eight-byte header. Most plotted fields are little-endian 32-bit floats. The per-record encoding marks integer fields. Add a small synthetic fixture to [the tests](../test/monitor.test.mjs) when you add a layout or change its encoding.

## Package the helper

```sh
python3 tools/package-helper.py
```

This builds `dist/magsafe-mac-helper.zip` from the source files. To preview the Worker routes locally, run `npx wrangler dev --config wrangler.example.jsonc` and open `/magsafe-monitor/` on the URL it prints. The hosted helper bridge accepts the production origin `https://luke.lol`. Use the Mac setup for native telemetry during local development.
