<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

<h1 id="torto-web" align="center">torto-web</h1>

<p align="center">
  The web edition of <a href="https://github.com/TortoTech/torto">Torto</a> — a fast, AI-native, local-first ebook reader that runs entirely in your browser.<br>
  Built on the <a href="https://github.com/TortoTech/rebook">rebook</a> reading kernel.
</p>

<p align="center">
  <a href="https://read.rethinkos.com/"><img src="https://img.shields.io/badge/demo-read.rethinkos.com-3fa97c" alt="Online demo"></a>
  <img src="https://img.shields.io/badge/platform-Web-5b6ee1" alt="Web platform">
  <img src="https://img.shields.io/badge/UI-React%2019-7c3aed" alt="Built with React 19">
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#supported-formats">Formats</a> •
  <a href="#try-it-online">Try it online</a> •
  <a href="#privacy">Privacy</a> •
  <a href="#development">Development</a> •
  <a href="#related-projects">Related projects</a>
</p>

## About

torto-web brings the Torto reading experience to the browser: open a tab and you have a digital bookshelf — no installation required. It works fully offline, and connects to AI providers and WebDAV storage only when you ask it to.

All parsing, layout, and rendering runs client-side on the standalone [rebook](https://github.com/TortoTech/rebook) kernel, with continuous optimization for page turns, reflow, zooming, and window resizing.

## Features

<div align="left">✅ Implemented</div>

| **Feature** | **Description** | **Status** |
| --- | --- | --- |
| **High-performance reading** | Independent rebook kernel with paged, scrolled, single-page, and two-page layouts, tuned for smooth turns and reflow. | ✅ |
| **Deep AI reading** | Slash commands like `/summary`, `/search`, `/rewrite`, and `/extract`; quote the current chapter or any book with images attached; answers include clickable citations that jump to the source paragraph. | ✅ Optional |
| **Dual-mode translation** | Built-in browser translation with zero configuration, or your own AI translation service; bilingual or replacement mode, including the table of contents. | ✅ Optional |
| **Optional cloud bookshelf** | Import and read without an account — books stay in the browser; sign in to sync through WebDAV providers such as Jianguoyun and Nextcloud, and pick up where you left off on any device. | ✅ Optional |
| **Complete reading toolkit** | Local bookshelf, book search, table-of-contents navigation, full-book search, and resume reading; customizable fonts, sizes, themes, and page layouts; text-to-speech, progress tracking, and multiple cover-extraction strategies. | ✅ |
| **Extensible and cross-device** | Built-in extension store for translation, AI chat, and TTS capabilities; three-column desktop layout and drawer-based mobile interaction; Light / Dark themes and 简体中文 / English UI. | ✅ |

## Supported formats

| Format | Support |
| --- | --- |
| EPUB | ✅ |
| MOBI / AZW3 | ✅ |
| FB2 | ✅ |
| PDF | ✅ |
| CBZ | ✅ |

## Try it online

Use the hosted build at **[read.rethinkos.com](https://read.rethinkos.com/)** — import a book and start reading; nothing is uploaded unless you enable cloud sync or AI features.

To run your own copy, you need Node.js, npm, and a local checkout of the [rebook](https://github.com/TortoTech/rebook) kernel next to this repository:

```bash
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:3132/`. Build a production bundle with:

```bash
npm run build
```

## Privacy

- Imported books and reading data stay in your browser's local storage by default.
- AI, translation, and cloud sync are opt-in. Content leaves the browser only when you configure and actively use a provider.
- WebDAV traffic goes directly from your browser to the service you choose; there is no rebook-operated relay.

## Development

torto-web is a React 19 + Vite + Tailwind CSS application. The reading kernel is consumed as a local `file:../rebook` dependency, so clone both repositories side by side before installing.

```bash
npm run dev         # start the dev server
npm run build       # type-check and build for production
npm run typecheck   # types only
```

Please report reproducible problems in [Issues](https://github.com/TortoTech/torto-web/issues). Include the book format, screenshots, and reproduction steps, but do not upload complete copyrighted books.

## Related projects

- [rebook](https://github.com/TortoTech/rebook) — cross-platform ebook parsing and reading kernel
- [Torto](https://github.com/TortoTech/torto) — the native desktop edition for Windows and macOS
- [rebook-service](https://github.com/TortoTech/rebook-service) — accounts, cloud bookshelf, and optional AI services
- [tortotech.github.io](https://github.com/TortoTech/tortotech.github.io) — the Torto official website
