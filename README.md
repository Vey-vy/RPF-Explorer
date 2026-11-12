# RPF Explorer

RPF Explorer is a Windows desktop archive browser built in Rust and Tauri 2. Its interface is a local HTML/CSS/JavaScript frontend hosted by WebView2; it does not bundle CEF or use remote web assets.

## Supported games

| Game | Archive formats |
| --- | --- |
| Max Payne 3 | RPF4 |
| Grand Theft Auto IV | RPF2 / RPF3 |
| Grand Theft Auto V | RPF7 |
| Red Dead Redemption | RPF6 |
| Red Dead Redemption 2 | RPF8 |

The app discovers archives under a selected game folder and opens archives on demand. GTA V and RDR2 keys are acquired from game files. Other supported formats accept a 64-character hexadecimal AES key or can search game executables for one. Found keys are cached in `rpf_explorer_keys.txt` in the current working directory.

RPF files contained inside another archive can be opened recursively; the explorer detects the nested archive version and returns to the parent with the toolbar back control. Embedded RPF2, RPF3, RPF4, RPF6, and RPF7 archives are supported; embedded RPF8 archives are not yet supported.

The explorer filters opened archive contents, searches across archives (up to 1,000 results), extracts files or folders using native folder dialogs, and previews supported text, DDS, PNG, and JPEG files. Its model viewport decodes OBJ, glTF 2.0 JSON, and GLB files with local companion buffers/materials, plus GTA V YDR, YDD, and YFT resources. Generic model dependencies are restricted to safe relative paths within the selected folder or archive and bounded by preview-size limits; remote and file URIs are never fetched. GTA V resources are decoded and software-rendered into twelve real azimuth views, with drag orbit, zoom, reset, and selectable YDD drawables. Same-name adjacent YTD textures are used when available. Other Rockstar model formats (including WDR/WFT) and some encrypted GTA IV files remain unsupported and are reported explicitly. RDR2 names missing from the built-in hash index are displayed as hexadecimal identifiers.

## Windows prerequisites

- Rust stable and Cargo
- Node.js and npm
- Microsoft C++ Build Tools
- WebView2 Runtime (normally included with current Windows installations)
- WiX Toolset or NSIS to build Windows installers

## Development

From the repository root:

```powershell
npm install --prefix ui
npm --prefix ui run tauri -- dev
```

## Production build

```powershell
npm --prefix ui run tauri -- build
```

The frontend can also be validated independently:

```powershell
npm run build --prefix ui
```

## Command-line interface

The existing CLI remains available:

```text
rpf-explorer.exe --cli find-key <game.exe> <archive.rpf>
rpf-explorer.exe --cli list <archive.rpf> <hex-key> [max]
rpf-explorer.exe --cli test <archive.rpf> <hex-key>
rpf-explorer.exe --cli extract <archive.rpf> <hex-key> <output-folder>
```

To build only the Rust core and CLI:

```powershell
cargo build --release --no-default-features
```

## Project layout

- `src/rpf/` — archive readers, entry handling, and safe extraction
- `src/gui/` — Tauri IPC and trusted filesystem operations
- `ui/` — local Vite frontend
- `tauri.conf.json` and `capabilities/` — desktop shell and scoped IPC configuration
