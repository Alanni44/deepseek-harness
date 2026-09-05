# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 的 Windows 安装版桌面应用。它启动现有的 `dsh web` 服务并在一个 Electron 窗口中呈现，因此从桌面快捷方式打开时无需终端。

## 安装版行为

正式发布物是 NSIS 安装包 `DeepSeek Harness Setup <version>.exe`。它支持自定义安装目录，包括 D 盘目录，并创建桌面与开始菜单快捷方式。安装包是唯一受支持的发布物；便携 EXE 没有更新路径，也不会被发布。

打开应用后，最终窗口会立刻显示本地加载页，同时随附的标准 Node 运行时启动 `dsh web --port 0`。回环服务就绪后，同一窗口会跳转至服务。桌面外壳位于 `app.asar`；真实 Node 可执行文件和完整生产后端分别位于 `resources/node` 与 `resources/backend`，所以安装版不需要 PATH 中存在 Node。

服务与渲染器健康后，托盘图标才会出现。关闭窗口会隐藏窗口，并从托盘保持服务可用。使用 **Show** 恢复窗口，使用 **Check for Updates** 手动检查更新，使用 **Export Diagnostics** 创建受隐私范围约束的支持档案，使用 **Quit** 在应用退出前停止后端。若托盘无法创建，关闭窗口会正常退出。

## 更新与信任

安装版会检查此 fork 的 GitHub Releases 中 `desktop-v<version>` 标签对应的发布。后台检查只报告可用版本；下载与重启需要明确的菜单操作。开发模式和 `DSH_DESKTOP_DISABLE_UPDATES=1` 会禁用所有更新请求。每个公开发布只包含安装包、对应的 `.blockmap` 和 `latest.yml` 元数据。

只有在发布工作流配置 Windows 代码签名密钥时，GitHub Release 才具有可信签名。没有这些密钥的发布会标为未签名个人测试版本，Windows 可能显示信任警告。

## 诊断与恢复

桌面日志按 10 MiB 轮转，保留七天，且总量最多 200 MiB。诊断导出只包含发布元数据、受限的桌面日志和启动健康记录；不包含凭据、环境变量、提示词、会话、就绪后的后端输出或任意用户文件。

启动页会报告后端失败并记录受限证据；它不会重置 profile、插件、会话、设置或源码文件。

## 开发与发布验证

在仓库根目录先构建源码，再打包：

```sh
pnpm run build
pnpm run desktop:dist
```

`desktop:dist` 会获取固定版本的 Windows Node 运行时、部署生产后端闭包、生成 NSIS 安装包、验证打包运行时、执行真实后端 HTTP 冒烟测试、测量体积，并清理所有临时或便携输出。最终 `release/` 目录只包含安装包、blockmap 和 `latest.yml`。GitHub 工作流会在创建 Release 前重复这一序列。
