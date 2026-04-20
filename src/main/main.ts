import { app, BrowserWindow } from 'electron';
import * as path from 'path';

const BASE_W = 1366;
const BASE_H = 768;

function createWindow(): void {
  const win = new BrowserWindow({
    width:  BASE_W,
    height: BASE_H,
    minWidth:  800,
    minHeight: Math.round(800 * BASE_H / BASE_W),
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: "Texas Hold'em Poker",
    show: false
  });

  // Lock window to 16:9 (1366×768 ratio) — resizing always stays proportional
  win.setAspectRatio(BASE_W / BASE_H);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
