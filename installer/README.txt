SlotForge per-user file-copy installer

The scripts place a private copy of the app and Node runtime in the user's own
application-data directory. They do not register a service, change PATH, install
npm packages or require administrator access. The launcher opens the system's
browser and runs a loopback-only storage helper. The helper knows its data folder;
the browser never receives general filesystem access.

Application versions are copied under app/<version>-<content-hash>. The active
pointer is switched only after all package file hashes and the copied app have
been checked. data/ is outside those versioned directories and is never replaced
by the installer. Re-running setup retains prior versions and data.

Official runtime: Node.js v24.22.2. node-runtimes.json lists exact download URLs
and SHA-256 hashes for Windows, macOS and Linux x64/arm64. The scripts check the
hash before running the downloaded binary. Runtime licenses are retained. The
private executable is versioned so an older Windows process does not lock the
new runtime during an update.

Offline setup: place the matching official Node archive in
installer/runtime-archives/ before running setup. Its pinned hash must match.
Otherwise setup downloads it from nodejs.org on the first install.

Optional environment settings:
 SLOTFORGE_HOME            Dedicated installation folder (not a drive/home root).
 SLOTFORGE_NO_OPEN=1       Install without launching a browser/local process.
 SLOTFORGE_NO_SHORTCUTS=1  Skip the Windows desktop shortcut.
The last two settings support unattended installation tests.

With an existing Node runtime, after extracting a complete package you can run:
 node installer/install.cjs --home "a dedicated folder" --no-open --no-shortcuts
This takes a private copy of that executable. Normal users should use the
platform bootstrap to obtain the verified official version instead.

The launcher reuses an already-running instance only when its installation data
path, app version and installed content build match. If another app or old preview uses the preferred
port, the launcher chooses a different local port. The saved files stay the same.

Storage: data/workspace.sqlite, using SQLite bundled with the Node runtime.
Existing JSON workspaces migrate automatically after exact content verification;
workspace.json and backups/ remain unchanged migration-time recovery copies.
Do not run an older app version against a migrated data folder.

Limits: 5,000 saved tracks and 200 MiB live record payload. Transactions keep
up to 20 previous change sets (50 MiB history budget) and 20 deleted tracks.
Track pack limits remain 100 custom packs and 500 pieces overall. Individual
layout files retain the 5 MiB limit; workspace transfers allow up to 256 MiB.

Use Storage > Download workspace backup for an independent portable JSON copy.
Storage > Download previous save recovers the preceding committed workspace
without changing live data. This history is inside SQLite, not a separate backup.
Stop all local helpers before copying the complete data folder. A corrupt or
missing migrated database is never silently replaced with an empty workspace
or the stale JSON copy. See app/SQLITE-STORAGE.txt for migration and recovery.

Native macOS/Linux installation testing remains outstanding. No signed installer,
Gatekeeper bypass, Linux service or Windows registry installation is included.

Windows launcher (v0.3.2): the desktop shortcut targets Windows Script Host
and Start SlotForge.vbs, encoded as UTF-16LE for non-ASCII installation paths.
It checks runtime / launcher files and starts the helper hidden. The helper
uses Windows ShellExecute via PowerShell Start-Process for the default browser,
awaits the result, and logs startup / browser handoff to data/launcher.log.
A browser-opening failure leaves the loopback helper running and shows its URL.
Fatal startup failures also produce a log and visible Windows message.

macOS/Linux launcher review (v0.3.2): repeat starts append to the launch log.
Shell starters check the private runtime and report the log location. Linux
desktop entries invoke the same shell starter with escaped special characters.
xdg-open may legitimately stay attached to a browser; a live opener after the
initial grace period is not reported as a timeout failure. Immediate missing
command and nonzero-exit errors are still reported in the launch log.
Cross-platform process and script tests pass on Windows; native macOS/Linux
desktop validation still requires those operating systems.
