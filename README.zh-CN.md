<p align="center">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

<h1 id="rebook-web" align="center">rebook-web</h1>

<p align="center">
  <a href="https://github.com/L-Chris/torto">Torto（小龟阅读）</a>的 Web 版——高性能、AI 原生、本地优先的浏览器电子书阅读器。<br>
  基于 <a href="https://github.com/L-Chris/rebook">rebook</a> 阅读内核构建。
</p>

<p align="center">
  <a href="https://read.rethinkos.com/"><img src="https://img.shields.io/badge/在线体验-read.rethinkos.com-3fa97c" alt="在线体验"></a>
  <img src="https://img.shields.io/badge/platform-Web-5b6ee1" alt="Web 平台">
  <img src="https://img.shields.io/badge/UI-React%2019-7c3aed" alt="基于 React 19">
</p>

<p align="center">
  <a href="#-特性">特性</a> •
  <a href="#-支持格式">支持格式</a> •
  <a href="#-在线体验">在线体验</a> •
  <a href="#-隐私">隐私</a> •
  <a href="#-开发">开发</a> •
  <a href="#-相关项目">相关项目</a>
</p>

## 关于

rebook-web 把 Torto 的阅读体验带进了浏览器：打开一个标签页，就拥有了自己的数字书架——无需安装。它既可以完全离线阅读，也可以按需连接 AI 和 WebDAV。

所有解析、排版与渲染都在浏览器内由独立的 [rebook](https://github.com/L-Chris/rebook) 内核完成，并针对翻页、重排、缩放和浏览器窗口变化持续优化。

## ✨ 特性

<div align="left">✅ 已实现</div>

| **特性** | **说明** | **状态** |
| --- | --- | --- |
| **⚡ 高性能阅读体验** | 独立的 rebook 阅读内核；支持分页、滚动、单页和双页布局，翻页与重排持续优化。 | ✅ |
| **🤖 深度 AI 阅读** | 提供 `/summary`、`/search`、`/rewrite`、`/extract` 等快捷命令；可引用当前章节或指定书籍并附图提问；AI 回答附带可点击的原文引用，直接定位到对应段落。 | ✅ 可选 |
| **🌐 双模式智能翻译** | 浏览器内置翻译零配置开箱即用，也可接入自定义 AI 翻译服务；支持双语对照或替换原文，目录也能翻译。 | ✅ 可选 |
| **☁️ 可选的云端书架** | 不登录也能导入和阅读，书籍默认保存在当前浏览器；登录后可连接坚果云、Nextcloud 等 WebDAV 服务，在不同设备间继续阅读。 | ✅ 可选 |
| **📚 完整的阅读工具** | 本地书架、书籍搜索、目录导航、全文搜索和断点续读；自定义字体、字号、主题和页面布局；支持文字朗读、阅读进度记录与多种封面提取方式。 | ✅ |
| **🧩 可扩展、跨设备** | 内置扩展商店，可按需启用翻译、AI 对话和朗读能力；桌面端三栏布局与移动端抽屉交互；Light / Dark 主题和简体中文 / English 界面。 | ✅ |

## 📖 支持格式

| 格式 | 支持情况 |
| --- | --- |
| EPUB | ✅ |
| MOBI / AZW3 | ✅ |
| FB2 | ✅ |
| PDF | ✅ |
| CBZ | ✅ |

## 🌐 在线体验

直接使用托管版本 **[read.rethinkos.com](https://read.rethinkos.com/)**——导入书籍即可开始阅读；除非主动开启云同步或 AI 功能，否则任何内容都不会上传。

如需自己部署，需要 Node.js、npm，并在本仓库旁并排放置 [rebook](https://github.com/L-Chris/rebook) 内核的源码：

```bash
npm install
npm run dev
```

默认开发地址为 `http://127.0.0.1:3132/`。构建生产版本：

```bash
npm run build
```

## 🔒 隐私

- 导入的书籍与阅读数据默认保存在浏览器本地存储中。
- AI、翻译与云同步均为可选功能，只有在你主动配置并使用对应服务时，内容才会离开浏览器。
- WebDAV 流量由浏览器直连你选择的服务，不经过任何 rebook 运营的中转服务器。

## 🛠️ 开发

rebook-web 基于 React 19 + Vite + Tailwind CSS。阅读内核以 `file:../rebook` 本地依赖方式引入，因此请把两个仓库并排克隆后再安装依赖。

```bash
npm run dev         # 启动开发服务器
npm run build       # 类型检查并构建生产版本
npm run typecheck   # 仅类型检查
```

请在 [Issues](https://github.com/L-Chris/rebook-web/issues) 反馈可复现的问题，附上书籍格式、截图与复现步骤，但请勿上传完整版权书籍。

## 🔗 相关项目

- [rebook](https://github.com/L-Chris/rebook)：跨平台电子书解析与阅读内核
- [Torto](https://github.com/L-Chris/torto)：Windows 与 macOS 原生桌面版
- [rebook-service](https://github.com/L-Chris/rebook-service)：账号、云端书架与可选 AI 服务
- [torto-site](https://github.com/L-Chris/torto-site)：Torto 官方网站
