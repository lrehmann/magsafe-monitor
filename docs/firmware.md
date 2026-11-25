# Firmware downloads and hardware references

[AppleSN's MagSafe Charger Firmware index](https://applesn.info/firmware/magsafe-charger-firmware/) tracks firmware releases and points to Apple-hosted downloads. Apple publishes current MobileAsset catalogs for [A2140](https://mesu.apple.com/assets/com_apple_MobileAsset_UARP_A2140/com_apple_MobileAsset_UARP_A2140.xml) and [A2580](https://mesu.apple.com/assets/com_apple_MobileAsset_UARP_A2580/com_apple_MobileAsset_UARP_A2580.xml).

## Apple firmware archives

These links download the original Apple update packages. The SHA-256 values identify the exact ZIP files used for this project. The catalog groups A2580 and A3250 on the same firmware branch. A3502 and A3503 still need a confirmed update baseline.

| Charger branch | Package version | Build | Original ZIP | SHA-256 |
| --- | --- | --- | --- | --- |
| A2140 | 258.0.0 | `10M3761` | [Download from Apple](https://updates.cdn-apple.com/2023/patches/032-23356/3CB01A8C-D8A7-435C-B29D-9A5DD56F2DD6/com_apple_MobileAsset_UARP_A2140/3e323a70d0aac7ce6ecb99a7b804c817ad0afea5.zip) | `d8f331854d6040b40dbf99fd16e9e6dfa8393e5351cd99ba9046590d4ed775b0` |
| A2140 | 255.0.0 | `10M1821` | [Download from Apple](https://updates.cdn-apple.com/2022/patches/002-77743/9671E2B3-B35A-4839-8BB7-B4A31BFA9424/com_apple_MobileAsset_UARP_A2140/8d4d8c2fe62f3746617f83a8f3fb5df2a1df71e5.zip) | `688c02d2b4cba0f947c1bcdc8794c8af7dac375b51391bc8e675fb3b5f353c49` |
| A2140 | 247.0.0 | `10M229` | [Download from Apple](https://updates.cdn-apple.com/2021/patches/071-94517/FB6AC7D4-EBB5-467A-A4E9-6E2443264725/com_apple_MobileAsset_UARP_A2140/cd10d57729e80c42b4f92a36ba9319fa25c89532.zip) | `eb5c14797d2a4485c8004295e0624ebd41e7dcafa42a00875fa6da62622ae852` |
| A2140 | 174.0.0 | `9M5069` | [Download from Apple](https://updates.cdn-apple.com/2021/patches/001-41718/6A559748-6878-4659-9E40-7C2F109C8C36/com_apple_MobileAsset_UARP_A2140/d71db88fbe883494c8d9898795e9fac9e93645bc.zip) | `07bb3f3ba9e4833a7291f901f506e6d2c167cea1545630dd186648f24f9e9a34` |
| A2580 / A3250 | 148.0.0 | `2A168` | [Download from Apple](https://updates.cdn-apple.com/2025/patches/082-10672/54393986-494A-46D3-B766-1B150D34D130/com_apple_MobileAsset_UARP_A2580/3b0aebda25c1d71790d8591c26c269831eeab8d7.zip) | `3935aba9ff3da888f2799c4a9f963f48d4cc96542ac35d3036f972286e96bde8` |
| A2580 / A3250 | 136.0.0 | `2A146` | [Download from Apple](https://updates.cdn-apple.com/2025/patches/072-59320/29CC304D-2903-4CB9-81C4-343C26EDF0D2/com_apple_MobileAsset_UARP_A2580/2aa45f5b9be60f5ab28b89c61e7bb2ba6f3ee3c4.zip) | `095bbea225e8d12cbeeb84a4b2e8d732f93923890c50406b48baa46b50d6eeb2` |
| A2580 / A3250 | 133.0.0 | `2A143` | [Download from Apple](https://updates.cdn-apple.com/2025/patches/062-90580/9E837254-8916-408E-A6F7-9171284F8F8C/com_apple_MobileAsset_UARP_A2580/e41fc14af25de54f0ed4c2a2ef29e637ace171a8.zip) | `41cd9fbac83c6117cf24b9e8785646af547ccbfe97c20e457b2314f8fdf92d93` |
| A2580 / A3250 | 128.0.0 | `2A138` | [Download from Apple](https://updates.cdn-apple.com/2024/patches/052-48536/331B264D-14D9-4346-81F6-F15D94DA7E15/com_apple_MobileAsset_UARP_A2580/55b6f0d5567783d9fd9071105ae3e0e88a8303eb.zip) | `e1af3edaac8aa070c22d5e47415c9e4822d9d32d075497927258dd5a2cde64a7` |

To inspect a downloaded file on macOS, substitute its filename below and compare the digest with the table. The root `Info.plist` identifies the update package. The `AssetData/Firmware.acsw/` directory contains the firmware payload. The A2580 packages also include `BuildManifest.plist` and `Restore.plist` metadata for device family `chg1,1`.

```sh
archive=3e323a70d0aac7ce6ecb99a7b804c817ad0afea5.zip
shasum -a 256 "$archive"
unzip -l "$archive"
unzip -p "$archive" Info.plist | plutil -p -
```

The A2140 version appears as `258.0.0.0` in the monitor and as `2.58` in the AppleSN catalog. The firmware package version, catalog build, and USB revision each have their own identifier. The monitor compares the active version against a model-specific baseline. It reads diagnostics and telemetry without installing firmware.

## PDFs and hardware references

- [Apple A2140 dimensional drawing (PDF)](https://developer.apple.com/download/files/accessories/dimensional-drawings/apple-magsafe-charger.pdf)
- [Apple A2580 and A3250 dimensional drawing (PDF)](https://developer.apple.com/download/files/accessories/dimensional-drawings/apple-magsafe-charger-1-m-and-apple-magsafe-charger-2-m.pdf)
- [Apple MagSafe Charger Module accessory interface specification, section 70 (PDF)](https://fccid.io/m/61b78183d440605d00cf286caebdb5a85a74ba52ddd5f1f1c493894eee64041b.pdf) and [searchable Manuals+ copy (PDF)](https://manuals.plus/apple/c222-magsafe-charger-module-manual.pdf). The specification describes the C222/C223 OEM modules and gives context for USB HID interfaces and UARP.
- [Apple's MagSafe charger setup and model guide](https://support.apple.com/en-gu/105047)
- [A3502 USB identification on a Mac](https://www.macotakara.jp/accessories/entry-49475.html)
