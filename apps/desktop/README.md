# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The installed Windows desktop application for DeepSeek Harness. It starts the existing `dsh web` service and presents it in one Electron window, so opening the desktop shortcut does not require a terminal.

## Installed application behavior

The formal release is the NSIS installer `DeepSeek Harness Setup <version>.exe`. It supports a custom installation directory, including a D-drive directory, and creates Desktop and Start Menu shortcuts. The installer is the only supported release artifact; a portable EXE has no update path and is not published.

Opening the application immediately shows a local loading page in its final window while the bundled standard Node runtime starts `dsh web --port 0`. When the loopback service is ready, that same window navigates to the service. The shell stays in `app.asar`; the real Node executable and complete production backend live under `resources/node` and `resources/backend` so the installed application does not need Node on `PATH`.

After the service and renderer are healthy, the tray icon is available. Closing the window hides it and leaves the service available from the tray. Use **Show** to restore the window, **Check for Updates** to start a manual update check, **Export Diagnostics** to create a privacy-scoped support archive, and **Quit** to stop the backend before the application exits. If the tray cannot be created, closing exits normally.

## Updates and trust

Installed applications check the GitHub Releases attached to this fork's `desktop-v<version>` tags. Background checks only report availability; downloading and restarting require an explicit menu action. Development mode and `DSH_DESKTOP_DISABLE_UPDATES=1` disable all update requests. Each public release contains only the installer, its `.blockmap`, and `latest.yml` metadata.

GitHub Releases are trustworthy only when Windows code-signing secrets are configured for the release workflow. A release without them is labelled an unsigned personal test build and Windows may show a trust warning.

## Diagnostics and recovery

Desktop logs rotate at 10 MiB, expire after seven days, and retain at most 200 MiB. Diagnostic export contains only release metadata, bounded desktop logs, and launch-health records. It excludes credentials, environment variables, prompts, sessions, backend output after readiness, and arbitrary user files.

The startup screen reports a backend failure and records bounded evidence. It never resets profiles, plugins, sessions, settings, or source files.

## Development and release verification

From the repository root, build the source before packaging:

```sh
pnpm run build
pnpm run desktop:dist
```

`desktop:dist` fetches the pinned Windows Node runtime, deploys the production backend closure, produces the NSIS installer, verifies the packaged runtime, performs a real backend HTTP smoke, measures the footprint, and removes every temporary or portable output. Its final `release/` directory contains only the installer, blockmap, and `latest.yml`. The GitHub workflow repeats this sequence before it creates a release.
