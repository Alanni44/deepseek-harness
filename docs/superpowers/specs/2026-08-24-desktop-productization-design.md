# DeepSeek Harness Desktop Productization Design

English | [中文](2026-08-24-desktop-productization-design.zh.md)

## Scope

This design covers `apps/desktop`, the desktop release workflow, the upstream synchronization record, and the minimum root configuration needed to include the CLI and Web application in the desktop installer. The CLI's product behavior, the Web product interface, and the independent Node backend process model remain outside the change.

## Goals

- A Windows user installs the NSIS build once, then checks, downloads, and restarts to apply later updates inside the application.
- The GitHub fork builds, verifies, and publishes from a desktop version tag without a maintainer packaging on a local machine.
- Electron displays real startup state immediately and transitions the same window to the main interface when the backend becomes ready.
- Closing the main window hides it while the tray keeps the backend running; an explicit Quit command stops the backend and exits the application.
- A formal release contains only the installer and update metadata, not the single-file portable build, unpacked directory, or build diagnostics.
- The installed size and file count decrease without changing the independent Node runtime, terminal, native-module, or subprocess behavior.
- The packaged application proves its complete production runtime inventory and applies one approved icon identity to every Windows integration point.
- Every desktop release records the exact official upstream commit and source version synchronized into the fork without changing the fork's source-based dependency model.
- Desktop-specific changes stay in `apps/desktop` to reduce conflicts when synchronizing upstream CLI and Web changes.

## Non-goals

- Do not migrate the backend to Electron's Node runtime, host it in Electron's main process, or replace the separate Node executable with Electron `runAsNode`.
- Do not rewrite the existing Web interface or add a desktop update component to a Web page.
- Do not implement in-place updates for the portable build.
- Do not promise to remove SmartScreen warnings without a Windows code-signing certificate.
- Do not change the persistence location or format of sessions, user settings, or credentials.
- Do not introduce a Git submodule or replace `workspace:^` dependencies with published `@deepseek-ai/dsh-*` runtime packages.
- Do not add profile switching, last-known-good profile rollback, or automatic mutation or rollback of source, profiles, plugins, or user data.
- Do not add a plugin marketplace, community integration layer, or mobile remote control.
- Do not launch automatically at Windows sign-in.
- Do not add background-task completion notifications in the first release.
- Do not add a separate update website or update API; the fork's GitHub Releases and `electron-updater` remain the update source.

## Components

### Desktop main process

The desktop main process continues to own the single-instance lock, window, tray, backend process, and shutdown ordering. As soon as Electron is ready, the main process creates the main window and loads a local startup page while starting the backend. After the backend prints its ready URL, the main process loads that URL in the same window. The window keeps context isolation enabled, Node integration disabled, and the renderer sandbox enabled.

### Startup page

The startup page and its icon enter `app.asar` as desktop-shell static resources. The page shows the version and real stage text, not a percentage unsupported by actual progress. Stages include at least "Starting local service" and "Loading interface." If the backend exits, rejects startup, or is not ready within 90 seconds, the main process offers retry, export diagnostics, open log directory, and exit actions.

### Backend launcher

The backend launcher continues to use the standard Node executable shipped with the installer and executes the built `@deepseek-ai/dsh` CLI. Packaging materializes the backend dependency closure under `resources/backend` so standard Node never reads `app.asar`. The desktop shell runs from `app.asar`, while the backend runs from the real filesystem.

Packaged runtime closure verification inventories the CLI entry, Web static resources, independent Node executable, Windows x64 native binaries, update module and configuration, startup page, tray assets, application icon assets, production dependency closure, and production license notices. The release workflow rejects missing, unexpected-platform, or source-only runtime dependencies before it publishes an installer.

### Tray and window lifecycle

The tray is created only after the backend is ready and the main renderer finishes loading. Once the tray exists, closing the main window prevents the default close and hides the same window without stopping the backend. A tray left-click restores and focuses it; starting a second instance restores and focuses it as well.

The tray menu contains Show, Check for Updates, Export Diagnostics, and Quit, and its tooltip contains the product name and desktop version. Quit from the tray or application menu and Restart to Update set `isQuitting` before orderly backend shutdown. Windows shutdown and ordinary application quit also exit normally. If tray creation fails, the application remains usable, closing the window exits instead of hiding it, and File > Quit with a Ctrl+Q accelerator remains available from the application menu.

### Update manager

The update manager wraps `electron-updater` and runs only in an installed production build. The main application menu and tray expose Check for Updates, and a background check runs after the main interface and tray are ready. A failed background check writes a log entry only; a failed manual check displays a retryable error.

Update states progress through checking, available, downloading, downloaded, and failed. When a version is available, a native dialog offers "Download Update" and "Later"; download progress appears in the Windows taskbar. After the download completes, a dialog offers "Restart to Update" and "Later." Before restarting for installation, the application stops the backend normally and then asks the updater to quit and install. A verification or installation-preparation failure leaves the current runnable installation unchanged.

### Upstream synchronization baseline

`apps/desktop/upstream.json` records the official repository URL, the 40-character upstream commit last synchronized into the fork, the upstream source version, and the desktop version as `repository`, `commit`, `sourceVersion`, and `desktopVersion`. The recorded commit is the official upstream commit merged into the fork, not the fork's current `HEAD`.

The release workflow requires `desktopVersion` to equal `apps/desktop/package.json`, `sourceVersion` to equal the fork root's product version, and `commit` to exist and be an ancestor of the release commit. Official source continues to enter through normal synchronization or merge into the fork; CLI, Web, and desktop builds continue to use the fork workspace source and `workspace:^` dependencies.

### Icon asset pipeline

One licensed or otherwise approved product icon source generates the Windows ICO, window PNG, and tray variants. The build verifies that the generated identity is assigned to the main executable, NSIS installer, installed shortcut, BrowserWindow, startup page, and tray. A public fork uses upstream branding only when its license and branding rules permit it and does not imply official endorsement.

### Logging and diagnostics

The desktop main process and backend startup output go to Electron's user log directory. Logs rotate at 10 MiB per file, files older than seven days are removed at startup, and the application removes the oldest rotated files to keep its owned logs at or below 200 MiB. Logs record the desktop version, upstream synchronization baseline, startup stages, backend exit details, update state, and tray lifecycle, but never environment variables, credentials, user input, prompts, or session content.

Export Diagnostics is available from the tray and startup-failure interface. A native privacy warning appears before a save dialog creates a ZIP containing only recent owned logs, the startup marker, desktop and upstream versions, and OS, Electron, and Node version information. The archive excludes credentials and session content, and the dialog tells the user to review it before sharing.

### Startup health and recovery

At launch, the application reads any prior active-run marker before replacing it with a small marker containing the version, upstream baseline, and startup stage. It marks the run healthy only after the backend is ready and the main renderer finishes loading, then records a last-healthy desktop version, upstream baseline, and timestamp. An orderly shutdown deletes the marker only for a run that reached healthy state; a prior abandoned marker or a startup that fails twice in the current launch opens recovery actions for retry, export diagnostics, open logs, and exit.

Recovery never changes profiles, plugins, sessions, credentials, user data, or synchronized source. The last-healthy record supplies diagnostic evidence only; it is not a profile checkpoint or an automatic rollback mechanism.

## Startup and shutdown flow

1. Acquire the single-instance lock; a second instance restores and focuses the existing window, including when it is hidden.
2. After Electron becomes ready, set the Windows AppUserModelID, approved icon, and application menu, then create the active-run marker.
3. Create and show the window with the local startup page.
4. Start the independent Node backend and write its standard output and standard error to the rotating log.
5. Load the loopback URL in the same window after backend readiness.
6. After the main renderer finishes loading, mark the run healthy, update the last-healthy record, and create the tray.
7. Run one background update check after the tray is ready.
8. While the tray is available, closing the main window hides it and leaves the backend running.
9. Explicit Quit, Windows shutdown, or update restart sets the quitting state, requests normal backend shutdown, and force-stops it only after the existing grace period.
10. An orderly exit from a healthy run deletes the active-run marker before the application exits or relaunches.

## Publishing and versioning

The desktop application uses an independent semantic version, and Git tags use `desktop-v<version>`. The workflow verifies that the tag version matches `apps/desktop/package.json` and `apps/desktop/upstream.json` and refuses to publish on a mismatch. An upstream source version may change independently and does not directly trigger a desktop client upgrade.

Official source synchronization remains `deepseek-ai/deepseek-harness` to the user's GitHub fork, followed by the fork's retained `apps/desktop` build. Upstream preparation updates `apps/desktop/upstream.json` to the last official commit included by that synchronization. The record adds release traceability; it neither downloads source nor prevents later synchronization.

The Windows release workflow runs for `desktop-v*` tags with the minimum `contents: write` permission. On a Windows runner, it installs locked dependencies, validates the tag and upstream record, builds the CLI, Web application, and desktop shell, runs focused tests and packaged runtime closure verification, and then builds the NSIS installer. After all verification passes, the workflow creates a GitHub Release and uploads the installer, `latest.yml`, and the installer `.blockmap`. The update provider derives its identity from the workflow repository, so the fork owner and repository name are not hard-coded in source files.

An existing build without an updater requires one manual installation of the first productized installer. Later installers retain the same appId, installation identity, and user-data location, and the updater upgrades the existing installation in place. The workflow accepts electron-builder's standard code-signing environment variables: when signing secrets exist, it signs automatically; otherwise, it produces an unsigned personal build suitable for functional testing.

## Packaging and footprint

electron-builder configures only the NSIS target. `win-unpacked` may remain as an intermediate build directory for tests but is not uploaded to a Release; the portable target, old portable executable, and public build-diagnostic files leave the release flow. The installed application starts from its installed files and never performs single-file payload extraction on each launch.

The desktop shell enters `app.asar`, while independent Node and the backend dependency closure enter `extraResources`. The first pruning pass excludes source maps, TypeScript build information, test assets, example assets, and native binaries outside Windows x64. It does not globally remove `.ts` files; a narrower exclusion may follow only when the packaged runtime inventory proves those files are outside runtime resolution paths and the packaged startup test covers their consumers.

The build produces a footprint report with installer size, unpacked size, file count, and the largest runtime directories. Relative to the current baseline, the unpacked installation must shrink by at least 50 MiB and the installer by at least 5 MiB. If either threshold is missed, the release check fails and retains the report; it must not meet the target by removing an unverified runtime dependency.

## Error handling and security

- Automatic updates accept only the version, path, and SHA-512 that match electron-builder metadata; a failed download can be retried.
- Development mode disables updates by default, and an environment variable can explicitly disable production checks for offline use and diagnosis.
- External navigation continues in the system browser; navigation outside the loopback URL does not enter the application window.
- Update downloads receive neither Web-page credentials nor Node privileges; update control remains in the Electron main process.
- Code signing is required for a trusted public release but not for local functional verification. An unsigned build is explicitly identified as a personal test build.
- Build diagnostics contain build-machine paths and are not uploaded to a public Release.
- Diagnostic export uses an explicit content allowlist and a native privacy warning; it never collects credentials, prompts, session content, or arbitrary user files.
- Tray creation failure disables close-to-hide and preserves a visible exit path instead of leaving a hidden application.
- Recovery displays evidence and user actions but never mutates or rolls back profiles, plugins, sessions, user data, or synchronized source.

## Testing

Unit tests cover startup URL parsing, backend readiness and failure, duplicate-settlement protection, update-state transitions, different error behavior for background and manual checks, menu commands, and shutdown ordering for an update. Startup-page tests verify real status text and recovery actions without depending on artificial timing.

Tray lifecycle tests cover menu commands, close-to-hide, left-click restore and focus, second-instance restore, explicit Quit, update restart, backend shutdown, and tray-creation failure fallback.

Diagnostics tests cover log rotation, seven-day retention, the 200 MiB cap, active-run marker transitions, last-healthy recording, unclean-start recovery, the ZIP allowlist, and redaction of credentials, prompts, and session content.

The packaged test uses the shipped Node executable to start the shipped CLI, waits for the Web ready line, requests the loopback URL, and then verifies normal shutdown. It also checks every packaged runtime inventory category, production license notices, the Windows x64 native-module set, and icon assignment to the executable, installer, shortcut, window, startup page, and tray.

Release validation rejects a tag, desktop package version, upstream source version, upstream commit ancestry, or update metadata mismatch. The workflow proves that the installer and update metadata refer to the same installer bytes before publishing the Release.

Real update acceptance publishes two consecutive test versions. The old version discovers the new version, downloads it, restarts for installation, and retains user settings, sessions, and the custom installation location in the new version. No-update, network-interruption, download-failure, and defer paths must also leave the current version usable.

## Acceptance criteria

- Double-clicking the installed shortcut immediately shows a loading window with the correct icon and version.
- The same window enters the main interface after backend readiness, while CLI, Web, terminal, file operations, and shutdown behavior remain functional.
- Closing the main window hides it, the backend remains available, and the tray restores and focuses the same window.
- Explicit Quit from the tray or File > Quit with Ctrl+Q stops the backend and exits; a tray initialization failure still leaves a working exit path.
- The tray provides Show, Check for Updates, Export Diagnostics, and Quit after the main renderer becomes healthy.
- GitHub Actions can build, verify, and publish from a desktop tag without local packaging.
- A GitHub Release contains only the NSIS installer, `latest.yml`, and `.blockmap`.
- The application can check for updates in the background or manually, and the user completes an upgrade through download and restart buttons.
- An update failure does not damage the current installation, and an upgrade retains user data and installation location.
- Export Diagnostics shows a privacy warning, produces the defined allowlist, and excludes credentials, prompts, session content, and arbitrary user files.
- Every Release identifies the official repository, synchronized upstream commit, source version, and desktop version; the workflow rejects inconsistent or non-ancestor records.
- The main executable, NSIS installer, installed shortcut, window, startup page, and tray display the approved product icon variants.
- The portable target and old portable executable are removed, and the unpacked directory remains only as a short-lived test artifact.
- The unpacked installation and installer meet the minimum reductions of 50 MiB and 5 MiB respectively.
- Packaged runtime closure verification accounts for the CLI, Web assets, independent Node, Windows x64 native modules, updater, startup page, tray and icon assets, production dependencies, and license notices.
- Focused unit tests, type checking, documentation checks, build checks, and the packaged startup test pass.
