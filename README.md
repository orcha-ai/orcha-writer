<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/brand/orcha-writer-readme-logo-dark.svg" />
    <img src="src/assets/brand/orcha-writer-about-logo.png" alt="Orcha Writer" width="420" />
  </picture>
</p>

# Orcha Writer

Orcha Writer（Orcha 写作）是一款本地优先的跨平台 Markdown 写作与文档管理工具，面向产品文档、技术文档、本地知识整理和文档交付场景。

项目由 Orcha AI 团队出品，基于 Tauri、React、TypeScript 和 CodeMirror 6 构建。

## 产品定位

Orcha Writer 第一阶段聚焦轻量、稳定、专业的本地 Markdown 写作体验：

- 本地 Markdown 文档编辑与保存
- 文件夹工作区管理
- 多标签文档编辑
- 编辑、预览、双栏三种视图模式
- Markdown 实时预览与滚动同步
- 粘贴图片本地化保存
- PDF / HTML 导出
- 主题、编辑器、预览、导出、快捷键等设置

## 适用场景

- 产品说明、需求文档、交互说明
- README、API 文档、部署文档、架构说明
- 本地笔记、会议纪要、学习记录
- Markdown 文档转 PDF / HTML 后对外交付

## 当前功能

- 编辑器：语法高亮、行号、自动换行、Tab 宽度、拼写检查、自动补全、粘贴图片
- 预览：GFM / CommonMark、Front Matter、表格、Callout、代码高亮、TOC、外链确认
- 文件：打开文件、打开文件夹、最近文件、自动保存、文件树管理
- 导出：HTML、PDF、默认导出目录、覆盖策略、导出后打开
- 通用：启动行为、自动检查更新、最近文件数量、关闭窗口行为
- 快捷键：核心快捷键可在设置页修改并即时生效
- 桌面能力：macOS 文件关联、拖拽打开、系统菜单、单实例打开转发

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Vite
- CodeMirror 6
- Ant Design
- markdown-it

## 开发环境

需要安装：

- Node.js LTS
- pnpm
- Rust stable
- Tauri 2 所需系统依赖

安装依赖：

```bash
pnpm install
```

启动前端开发服务：

```bash
pnpm dev
```

启动 Tauri 开发模式：

```bash
pnpm tauri:dev
```

## 构建

前端构建：

```bash
pnpm build
```

桌面应用打包：

```bash
pnpm tauri:build
```

macOS 本地构建产物通常位于：

```text
src-tauri/target/release/bundle/
```

## 自动发版

仓库已配置 GitHub Actions 自动发版。推送 `v*` tag 后会构建 Release 并上传安装包：

```bash
git tag v0.1.0
git push origin v0.1.0
```

当前 Release workflow 会构建：

- macOS Intel：`.app` / `.dmg`
- macOS Apple Silicon：`.app` / `.dmg`
- Windows x64：NSIS 安装包
- Linux x64：AppImage / deb

## 仓库地址

https://github.com/orcha-ai/orcha-writer

## 开源协议

本项目采用 MIT 开源协议，详见 [LICENSE](LICENSE)。

版权与贡献：Orcha AI 团队出品。
