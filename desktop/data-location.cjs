'use strict';
// Decides where the desktop app keeps its saved work.
//
// Installed copies (Windows Setup, macOS /Applications, Linux .deb) share the
// same data folder as the earlier browser-based installer, so an existing
// Track Library opens straight away:
//   Windows  %LOCALAPPDATA%\SlotForgeTrackBuilder\data
//   macOS    ~/Library/Application Support/SlotForgeTrackBuilder/data
//   Linux    $XDG_DATA_HOME (or ~/.local/share)/SlotForgeTrackBuilder/data
//
// Portable copies keep everything in a "SlotForge Circuit Data" folder beside
// the program, so the whole app can live on a USB stick:
//   Windows  folder containing the portable .exe
//   Linux    folder containing the .AppImage
//   macOS    folder containing SlotForge Circuit.app (outside Applications)
const path = require('node:path');
const os = require('node:os');

const PORTABLE_FOLDER = 'SlotForge Circuit Data';

function legacyHome({ platform = process.platform, env = process.env, user = os.homedir() } = {}) {
  if (env.SLOTFORGE_HOME) return path.resolve(env.SLOTFORGE_HOME);
  if (platform === 'win32')
    return path.win32.join(env.LOCALAPPDATA || path.win32.join(user, 'AppData', 'Local'), 'SlotForgeTrackBuilder');
  if (platform === 'darwin') return path.posix.join(user, 'Library', 'Application Support', 'SlotForgeTrackBuilder');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(user, '.local', 'share'), 'SlotForgeTrackBuilder');
}

// The .app bundle that contains the running executable, if any.
function macBundle(execPath) {
  const marker = '.app/Contents/MacOS/';
  const index = execPath.indexOf(marker);
  return index < 0 ? null : execPath.slice(0, index + 4);
}

function argument(argv, name) {
  const prefix = `--${name}=`;
  const found = argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

/**
 * Returns {mode, root, workspace, profile, log, problem}.
 *  workspace: folder given to the SQLite DiskStore
 *  profile:   Electron's own browser profile (null = Electron default)
 *  problem:   a message to show instead of starting, or null
 */
function resolve({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  execPath = process.execPath,
  user = os.homedir(),
  packaged = true,
} = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const portable = root => ({
    mode: 'portable',
    root,
    workspace: p.join(root, 'workspace'),
    profile: p.join(root, 'app-profile'),
    log: p.join(root, 'desktop.log'),
    problem: null,
  });
  const installed = () => {
    const home = legacyHome({ platform, env, user });
    return {
      mode: 'installed',
      root: home,
      workspace: p.join(home, 'data'),
      profile: null,
      log: p.join(home, 'data', 'desktop.log'),
      problem: null,
    };
  };

  // Explicit choices (tests, advanced users) win over detection.
  const explicitPortable = argument(argv, 'portable-data-dir');
  if (explicitPortable) return portable(p.resolve(explicitPortable));
  if (env.SLOTFORGE_DATA_DIR) {
    const workspace = p.resolve(env.SLOTFORGE_DATA_DIR);
    return {
      mode: 'custom',
      root: workspace,
      workspace,
      profile: p.join(workspace, 'app-profile'),
      log: p.join(workspace, 'desktop.log'),
      problem: null,
    };
  }
  if (!packaged) return installed();

  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_DIR)
    return portable(p.join(env.PORTABLE_EXECUTABLE_DIR, PORTABLE_FOLDER));
  if (platform === 'linux' && env.APPIMAGE) return portable(p.join(p.dirname(env.APPIMAGE), PORTABLE_FOLDER));
  if (platform === 'darwin') {
    const bundle = macBundle(execPath);
    if (!bundle) return installed();
    const applications = [p.join('/Applications') + '/', p.join(user, 'Applications') + '/'];
    if (applications.some(prefix => bundle.startsWith(prefix))) return installed();
    const result = portable(p.join(p.dirname(bundle), PORTABLE_FOLDER));
    if (bundle.includes('/AppTranslocation/')) {
      result.problem =
        'macOS is running SlotForge Circuit from a temporary read-only copy.\n\n' +
        'To install it: drag SlotForge Circuit into your Applications folder.\n' +
        'To use it portably: move the folder that contains SlotForge Circuit to another place with Finder (for example Documents or a USB drive), then open it again.';
    } else if (bundle.startsWith('/Volumes/') && bundle.split('/').length <= 4) {
      result.problem =
        'SlotForge Circuit is running directly from its disk image.\n\n' +
        'Drag SlotForge Circuit into your Applications folder, eject the disk image, and open it from Applications.';
    }
    return result;
  }
  return installed();
}

module.exports = { resolve, legacyHome, macBundle, PORTABLE_FOLDER };
