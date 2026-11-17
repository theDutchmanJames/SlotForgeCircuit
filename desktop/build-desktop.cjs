'use strict';
// Builds the SlotForge Circuit desktop downloads for the current operating system.
//   Windows: Setup .exe (installer) + Portable .exe
//   macOS:   .dmg (installer)        + .zip (portable .app)
//   Linux:   .deb (installer)        + .AppImage (portable)
// Never reads or changes saved track data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const PLATFORMS = { win32: 'win', darwin: 'mac', linux: 'linux' };
const NAMES = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

function options(args) {
  const platform = PLATFORMS[process.platform];
  const result = { platform, quick: false, help: false, arch: platform === 'mac' ? 'universal' : process.arch };
  while (args.length) {
    const arg = args.shift();
    if (arg === '--quick') result.quick = true;
    else if (arg === '--no-pause') {
    } else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--arch') result.arch = args.shift();
    else throw Error(`Unknown option: ${arg}. Use --help for instructions.`);
  }
  const allowed = platform === 'mac' ? ['universal', 'x64', 'arm64'] : ['x64', 'arm64'];
  if (!result.help && !allowed.includes(result.arch))
    throw Error(`Unsupported architecture. Use --arch ${allowed.join(' or ')}.`);
  return result;
}

function run(command, args, extra = {}) {
  // npm is a .cmd script on Windows and needs a shell; its arguments here are fixed words.
  const shell = process.platform === 'win32' && command === 'npm';
  const result = shell
    ? spawnSync(['npm', ...args].join(' '), { cwd: root, stdio: 'inherit', env: process.env, shell: true, ...extra })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env, ...extra });
  if (result.error) throw Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw Error(`${command} ${args.join(' ')} failed (exit ${result.status}). No successful build is reported.`);
}

// electron-builder names Linux files with each format's own architecture label.
function artifacts(platform, version, arch) {
  if (platform === 'win')
    return [`SlotForgeCircuit-${version}-Setup-${arch}.exe`, `SlotForgeCircuit-${version}-Portable-${arch}.exe`];
  if (platform === 'mac')
    return [`SlotForgeCircuit-${version}-mac-${arch}.dmg`, `SlotForgeCircuit-${version}-mac-${arch}.zip`];
  return [
    `SlotForgeCircuit-${version}-linux-${arch === 'x64' ? 'amd64' : arch}.deb`,
    `SlotForgeCircuit-${version}-linux-${arch === 'x64' ? 'x86_64' : arch}.AppImage`,
  ];
}

function build(config) {
  const { platform, arch, quick } = config;
  if (!platform) throw Error(`Unsupported operating system: ${process.platform}.`);
  if (config.help) {
    console.log(`SlotForge Circuit ${NAMES[platform]} builder
Builds the installer and portable app for this operating system.
Needs Node.js 24 or newer and an internet connection for the first build.
  --quick       Reuse installed build tools and skip the automated tests.
  --arch ARCH   ${platform === 'mac' ? 'universal (default), x64 or arm64' : 'x64 or arm64 (default: this machine)'}.
  --no-pause    Do not wait for Enter at the end.
Files are written to dist/desktop/v<version>/.`);
    return;
  }
  if (process.getuid?.() === 0) throw Error('Run the builder as your normal user, without sudo.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node.js 24 or newer is required.');
  // VERSION in app/integration.js is the only place the version is set.
  const synced = require('./sync-version.cjs').sync();
  if (synced.changed) console.log(`package.json version updated ${synced.previous} → ${synced.version}.`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  console.log(`Building SlotForge Circuit ${pkg.version} for ${NAMES[platform]} (${arch}).`);

  const binary = path.join(
    root,
    'node_modules/electron/dist',
    platform === 'mac' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win' ? 'electron.exe' : 'electron'
  );
  const tools = fs.existsSync(binary) && fs.existsSync(path.join(root, 'node_modules/electron-builder/cli.js'));
  if (!quick || !tools) {
    console.log('Installing build tools from package-lock.json...');
    run('npm', ['ci', '--no-audit', '--no-fund']);
  }
  if (!fs.existsSync(binary)) run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]);
  if (!fs.existsSync(binary)) throw Error('Electron was not installed for this operating system.');

  if (quick) console.log('Quick build: automated tests are skipped.');
  else {
    run(process.execPath, [path.join(__dirname, 'run-tests.cjs')]);
    // Interface tests open a window, so they need a display (always there on Windows and macOS).
    if (platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
      run(process.execPath, [path.join(__dirname, 'ui-test-runner.cjs')]);
  }

  const output = path.join(root, 'dist', 'desktop', `v${pkg.version}`);
  const files = artifacts(platform, pkg.version, arch);
  for (const file of files) fs.rmSync(path.join(output, file), { force: true });
  const started = Date.now();
  run(process.execPath, [
    path.join(root, 'node_modules/electron-builder/cli.js'),
    `--${platform}`,
    `--${arch}`,
    '--publish',
    'never',
  ]);
  for (const file of files) {
    let stat = null;
    try {
      stat = fs.statSync(path.join(output, file));
    } catch {}
    if (!stat?.isFile() || stat.size === 0 || stat.mtimeMs < started - 2000)
      throw Error(`Missing download after build: ${file}`);
  }

  // Start the freshly built app once to prove it opens and connects to its storage.
  const unpacked = {
    win: `win${arch === 'arm64' ? '-arm64' : ''}-unpacked/SlotForgeCircuit.exe`,
    mac: `mac${arch === 'x64' ? '' : '-' + arch}/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit`,
    linux: `linux${arch === 'arm64' ? '-arm64' : ''}-unpacked/SlotForgeCircuit`,
  }[platform];
  const canRun = arch === process.arch || (platform === 'mac' && arch === 'universal');
  if (
    !quick &&
    canRun &&
    fs.existsSync(path.join(output, unpacked)) &&
    (platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  ) {
    run(process.execPath, [path.join(__dirname, 'smoke.cjs'), path.join(output, unpacked)]);
  } else console.log('Skipping the start-up check (quick build, other architecture, or no display).');

  const sums =
    files
      .map(
        file =>
          `${crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(output, file)))
            .digest('hex')}  ${file}`
      )
      .join('\n') + '\n';
  const sumsFile = `SHA256SUMS-${platform}-${arch}.txt`;
  fs.writeFileSync(path.join(output, sumsFile), sums);
  console.log(`\nReady in ${output}:\n  Installer: ${files[0]}\n  Portable:  ${files[1]}\n  ${sumsFile}`);
}

if (require.main === module) {
  let config;
  try {
    config = options(process.argv.slice(2));
    build(config);
  } catch (error) {
    console.error(`\nBuild stopped: ${error.message}`);
    process.exitCode = 1;
  }
  if (!process.argv.includes('--no-pause') && !config?.help && process.stdin.isTTY && process.stdout.isTTY) {
    const readline = require('node:readline').createInterface({ input: process.stdin, output: process.stdout });
    readline.question('\nPress Enter to close. ', () => readline.close());
  }
}

module.exports = { options, artifacts };
