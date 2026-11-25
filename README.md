# MagSafe Monitor

Inspect an Apple MagSafe charger over USB from desktop Chrome. The monitor reads charger diagnostics, shows the HID interfaces, and plots live power, current, temperature, and coil measurements on supported firmware.

**[Open the live monitor](https://luke.lol/magsafe-monitor/)** · **[Build and test locally](docs/development.md)** · **[Firmware downloads and reference PDFs](docs/firmware.md)**

## Try it

1. Plug a single Apple MagSafe charger into your computer over USB.
2. Open the monitor in desktop Chrome and click **Select charger**. Selecting a charger starts diagnostics and monitoring.
3. For decoded A2140 telemetry, run the [Mac helper](https://luke.lol/magsafe-monitor/magsafe-mac-helper.zip), then click **Connect Mac helper** and approve the session in the helper window. The [local setup](docs/development.md) also runs the entire dashboard on your Mac.
4. Use **Export JSON** to save diagnostics and the browser's captured HID reports. Click **Stop monitoring** when finished.

USB reports are processed on your computer. Brackets around a chart label indicate a tentative interpretation. Unidentified readings display their raw hex words, and the optional smoothing uses a trailing three-second median.

## Charger support

| Model | USB identification | What the monitor can read |
| --- | --- | --- |
| A2140, original 15W | `05AC:0500` | UARP diagnostics and decoded telemetry through the Mac helper. Live plots were verified on USB revision `0x0258`. |
| A2580 and A3250, 2024 25W | `05AC:0506` family | UARP diagnostics and passive HID capture. Field decoding still needs hardware captures. |
| A3502 and A3503, 2025 Qi2 25W | `05AC:0506` observed for A3502 | A3502 shares the USB family above. A3503's USB ID and the live field layouts for both models still need verification. |

Apple's model list and the firmware sources are collected in the [reference notes](docs/firmware.md).

## Contributing

**Pull requests are welcome.** Captures from other charger models and firmware revisions, corrections to field labels, and small decoder tests are especially helpful. Include the model, active firmware, USB revision if available, and the test conditions. The [development guide](docs/development.md#contribute-a-capture-or-decoder-change) has a short capture procedure and explains where to put a decoder change.

This is an independent project. Apple publishes the firmware and hardware documents linked in the reference notes.
