import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The renderer gets no Node access. Everything that touches the filesystem or
 * spawns a process goes through here.
 *
 * webUtils.getPathForFile is not a convenience: Electron 32 removed File.path,
 * so an OS drag-and-drop hands the renderer a File object with no filesystem
 * path at all. This is the only way to recover one.
 */
const api = {
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  openPdfs: (multi: boolean) => ipcRenderer.invoke('dialog:openPdfs', multi),
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  saveAs: (suggestedName: string) => ipcRenderer.invoke('dialog:saveAs', suggestedName),

  readFile: (p: string) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p: string, bytes: Uint8Array) => ipcRenderer.invoke('fs:writeFile', p, bytes),
  existsIn: (dir: string, name: string) => ipcRenderer.invoke('fs:existsIn', dir, name),

  inspect: (p: string) => ipcRenderer.invoke('pdf:inspect', p),
  editPages: (req: unknown) => ipcRenderer.invoke('pdf:editPages', req),
  merge: (req: unknown) => ipcRenderer.invoke('pdf:merge', req),
  split: (req: unknown) => ipcRenderer.invoke('pdf:split', req),
  compress: (req: unknown) => ipcRenderer.invoke('pdf:compress', req),

  revealInFolder: (p: string) => ipcRenderer.invoke('shell:reveal', p),
  openFile: (p: string) => ipcRenderer.invoke('shell:open', p),
  versions: () => ipcRenderer.invoke('app:versions'),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
