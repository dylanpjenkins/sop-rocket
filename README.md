# SOP Rocket

A free, open-source desktop app for creating Standard Operating Procedures. Add screenshots, annotate with circles, and export to PDF. Built with Electron, React, and shadcn/ui.

## Features

- **Library** -- SOPs stored in a configurable folder (default: Documents/SOPs). Create, rename, and delete folders; open SOPs from the sidebar.
- **Editor** -- Add steps with drag-and-drop screenshots or paste from clipboard. Reorder steps via drag handle, delete steps, and edit descriptions with a rich text editor.
- **Annotations** -- Draw circle annotations on images to highlight areas of interest.
- **Export** -- Export the current SOP to PDF with optional brand colors.
- **Settings** -- Configurable storage path, app theme (Light / Dark / Follow system), and optional brand colors for SOPs and PDFs.

## Download

Pre-built Windows installers are available on the [Releases](https://github.com/dylanpjenkins/sop-rocket/releases) page.

> **Note:** The installer is not code-signed, so Windows SmartScreen may show a warning. Click "More info" then "Run anyway" to proceed.

## Build from Source

```bash
git clone https://github.com/dylanpjenkins/sop-rocket.git
cd sop-rocket
npm install
```

### Development

```bash
npm run dev
```

### Production Build (Windows)

```bash
npm run build
npm run build:win
```

Output: `release/` directory (NSIS installer).

## Keyboard Shortcuts


| Shortcut     | Action          |
| ------------ | --------------- |
| Ctrl+S       | Save            |
| Ctrl+Shift+E | Export PDF      |
| Escape       | Back to Library |


## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE)

## Support

If you find this project useful, consider [sponsoring on GitHub](https://github.com/sponsors/dylanpjenkins).