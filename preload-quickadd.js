const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAdd', {
  // Send anime data to main window
  addAnime: (animeData) => ipcRenderer.invoke('quick-add-anime', animeData),
  // Close this overlay
  close: () => ipcRenderer.invoke('close-quick-add'),
});
