MagSafe Monitor – Mac helper

This helper enables A2140 live telemetry for https://luke.lol/magsafe-monitor/.
It listens on 127.0.0.1:8778. USB requests and reports stay on this Mac.

Requirements: macOS, Python 3, Apple Command Line Tools, and libusb with pkg-config.
If you use Homebrew, the dependencies are available via:
    brew install libusb pkg-config

Start the helper from this directory:
    python3 serve.py

Select the charger on the site, choose Connect Mac helper, and approve the
session in the popup. Leave the helper window open while monitoring.
Use Stop monitoring before closing it.
