'use strict';
// Renders app/icon.svg to desktop/build/icon-1024.png for macOS and Linux
// packages (electron-builder needs at least 512 px). Run: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const size = 1024;
const svg = fs.readFileSync(path.join(__dirname, '..', 'app', 'icon.svg'), 'utf8');
const output = path.join(__dirname, 'build', 'icon-1024.png');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent"><img style="width:${size}px;height:${size}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise(r => setTimeout(r, 300));
  const image = (await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).resize({
    width: size,
    height: size,
    quality: 'best',
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
  console.log(`Wrote ${output} (${image.getSize().width}x${image.getSize().height})`);
  app.quit();
});
