// Preload script - runs in renderer process with Node.js access
// contextBridge can be used here to expose APIs to renderer
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform
});
