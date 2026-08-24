# DeepSeek Harness Desktop Productization Design

English | [中文](2026-08-24-desktop-productization-design.zh.md)

## Scope

This design covers `apps/desktop`, the desktop release workflow, and the minimum root configuration needed to include the CLI and Web application in the desktop installer. The CLI's product behavior, the Web product interface, and the independent Node backend process model remain outside the change.

## Goals

- A Windows user installs the NSIS build once, then checks, downloads, and restarts to apply later updates inside the application.
- The GitHub fork builds, verifies, and publishes from a desktop version tag without a maintainer packaging on a local machine.
- Electron displays real startup state immediately and transitions the same window to the main interface when the backend becomes ready.
- A formal release contains only the installer and update metadata, not the single-file portable build, unpacked directory, or build diagnostics.
- The installed size and file count decrease without changing the independent Node runtime, terminal, native-module, or subprocess behavior.
- Desktop-specific changes stay in `apps/desktop` to reduce conflicts when synchronizing upstream CLI and Web changes.

## Non-goals

- Do not migrate the backend to Electron's Node runtime.
- Do not rewrite the existing Web interface or add a desktop update component to a Web page.
- Do not implement in-place updates for the portable build.
- Do not promise to remove SmartScreen warnings without a Windows code-signing certificate.
- Do not change the persistence location or format of sessions, user settings, or credentials.

## Components

### Desktop main process

The desktop main process continues to own the single-instance lock, window, backend process, and shutdown ordering. As soon as Electron is ready, the main process creates the main window and loads a local startup page while starting the backend. After the backend prints its ready URL, the main process loads that URL in the same window. The window keeps context isolation enabled, Node integration disabled, and the renderer sandbox enabled.

### Startup page

The startup page and its icon enter `app.asar` as desktop-shell static resources. The page shows the version and real stage text, not a percentage unsupported by actual progress. Stages include at least "Starting local service" and "Loading interface." If the backend exits, rejects startup, or is not ready within 90 seconds, the main process offers retry, open log directory, and exit actions.

### Backend launcher

The backend launcher continues to use the standard Node executable shipped with the installer and executes the built `@deepseek-ai/dsh` CLI. Packaging materializes the backend dependency closure under `resources/backend` so standard Node never reads `app.asar`. The desktop shell runs from `app.asar`, while the backend runs from the real filesystem; a packaged startup test verifies that the CLI entry, Web static resources, and native modules all resolve.

### Update manager

The update manager wraps `electron-updater` and runs only in an installed production build. The main application menu exposes Help > Check for Updates, and a background check runs after the main interface is ready. A failed background check writes a log entry only; a failed manual check displays a retryable error.

Update states progress through checking, available, downloading, downloaded, and failed. When a version is available, a native dialog offers "Download Update" and "Later"; download progress appears in the Windows taskbar. After the download completes, a dialog offers "Restart to Update" and "Later." Before restarting for installation, the application stops the backend normally and then asks the updater to quit and install. A verification or installation-preparation failure leaves the current runnable installation unchanged.

### Logging

The desktop main process and backend startup output go to Electron's user log directory. Logs record the version, startup stages, backend exit details, and update state, but not environment variables, credentials, user input, or session content. The failure interface opens that directory through the system file manager.

## Startup and shutdown flow

1. Acquire the single-instance lock; a second instance only restores and focuses the existing window.
2. After Electron becomes ready, set the Windows AppUserModelID, icon, and application menu.
3. Create and show the window with the local startup page.
4. Start the independent Node backend and write its standard output and standard error to the log.
5. Load the loopback URL in the same window after backend readiness.
6. Run one background update check after the main interface becomes ready.
7. On user exit or update restart, request normal backend shutdown before force-stopping it after the existing grace period.

## Publishing and versioning

The desktop application uses an independent semantic version, and Git tags use `desktop-v<version>`. The workflow verifies that the tag version matches `apps/desktop/package.json` and refuses to publish on a mismatch. An upstream project version may change independently and does not directly trigger a desktop client upgrade.

The Windows release workflow runs for `desktop-v*` tags with the minimum `contents: write` permission. On a Windows runner, it installs locked dependencies, builds the CLI, Web application, and desktop shell, runs focused tests and the packaged backend startup test, and then builds the NSIS installer. After all verification passes, the workflow creates a GitHub Release and uploads the installer, `latest.yml`, and the installer `.blockmap`. The update provider derives its identity from the workflow repository, so the fork owner and repository name are not hard-coded in source files.

An existing build without an updater requires one manual installation of the first productized installer. Later installers retain the same appId, installation identity, and user-data location, and the updater upgrades the existing installation in place. The workflow accepts electron-builder's standard code-signing environment variables: when signing secrets exist, it signs automatically; otherwise, it produces an unsigned personal build suitable for functional testing.

## Packaging and footprint

electron-builder configures only the NSIS target. `win-unpacked` may remain as an intermediate build directory for tests but is not uploaded to a Release; the portable target, old portable executable, and public build-diagnostic files leave the release flow.

The desktop shell enters `app.asar`, while independent Node and the backend dependency closure enter `extraResources`. The first pruning pass excludes source maps, TypeScript build information, test assets, example assets, and native binaries outside Windows x64. It does not globally remove `.ts` files; a narrower exclusion may follow only when the packaging inventory proves those files are outside runtime resolution paths and the packaged test covers their consumers.

The build produces a footprint report with installer size, unpacked size, file count, and the largest runtime directories. Relative to the current baseline, the unpacked installation must shrink by at least 50 MiB and the installer by at least 5 MiB. If either threshold is missed, the release check fails and retains the report; it must not meet the target by removing an unverified runtime dependency.

## Error handling and security

- Automatic updates accept only the version, path, and SHA-512 that match electron-builder metadata; a failed download can be retried.
- Development mode disables updates by default, and an environment variable can explicitly disable production checks for offline use and diagnosis.
- External navigation continues in the system browser; navigation outside the loopback URL does not enter the application window.
- Update downloads receive neither Web-page credentials nor Node privileges; update control remains in the Electron main process.
- Code signing is required for a trusted public release but not for local functional verification. An unsigned build is explicitly identified as a personal test build.
- Build diagnostics contain build-machine paths and are not uploaded to a public Release.

## Testing

Unit tests cover startup URL parsing, backend readiness and failure, duplicate-settlement protection, update-state transitions, different error behavior for background and manual checks, menu commands, and shutdown ordering for an update. Startup-page tests verify real status text and failure actions without depending on artificial timing.

The packaged test uses the shipped Node executable to start the shipped CLI, waits for the Web ready line, requests the loopback URL, and then verifies normal shutdown. It also verifies that Web static resources and current Windows x64 native modules exist, preventing a pruning rule from producing a package that runs from source but lacks installed files.

Real update acceptance publishes two consecutive test versions. The old version discovers the new version, downloads it, restarts for installation, and retains user settings, sessions, and the custom installation location in the new version. No-update, network-interruption, download-failure, and defer paths must also leave the current version usable.

## Acceptance criteria

- Double-clicking the installed shortcut immediately shows a loading window with the correct icon and version.
- The same window enters the main interface after backend readiness, while CLI, Web, terminal, file operations, and shutdown behavior remain functional.
- GitHub Actions can build, verify, and publish from a desktop tag without local packaging.
- A GitHub Release contains only the NSIS installer, `latest.yml`, and `.blockmap`.
- The application can check for updates in the background or manually, and the user completes an upgrade through download and restart buttons.
- An update failure does not damage the current installation, and an upgrade retains user data and installation location.
- The portable target and old portable executable are removed, and the unpacked directory remains only as a short-lived test artifact.
- The unpacked installation and installer meet the minimum reductions of 50 MiB and 5 MiB respectively.
- Focused unit tests, type checking, documentation checks, build checks, and the packaged startup test pass.
