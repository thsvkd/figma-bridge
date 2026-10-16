import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BridgeApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: BridgeApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  turnOn: () => ipcRenderer.invoke(IPC.turnOn),
  turnOff: () => ipcRenderer.invoke(IPC.turnOff),
  attachPlugin: () => ipcRenderer.invoke(IPC.attachPlugin),
  onState: (cb) => subscribe(IPC.state, cb),
  update: {
    getState: () => ipcRenderer.invoke(IPC.updateGet),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    onState: (cb) => subscribe(IPC.updateState, cb),
  },
  doctor: {
    run: (fix) => ipcRenderer.invoke(IPC.doctorRun, fix),
    ai: () => ipcRenderer.invoke(IPC.doctorAi),
  },
  harness: {
    install: (id) => ipcRenderer.invoke(IPC.harnessInstall, id),
    login: (id) => ipcRenderer.invoke(IPC.harnessLogin, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },
}

contextBridge.exposeInMainWorld('bridge', api)
