import { WebContainer } from '@webcontainer/api';

/** @type {import('@webcontainer/api').WebContainer}  */
let webcontainerInstance;

export async function bootWebContainer() {
    if (webcontainerInstance) return webcontainerInstance;

    // Boot the micro-OS
    webcontainerInstance = await WebContainer.boot();
    return webcontainerInstance;
}

export async function writeFilesToWebContainer(filesMap) {
    if (!webcontainerInstance) throw new Error("WebContainer not booted");

    // Transform VibeSim state.files to WebContainer format
    const tree = {};
    for (const [path, fileObj] of Object.entries(filesMap)) {
        if (fileObj.type === 'file') {
            // handle simple flat files first
            const parts = path.split('/');
            let currentLevel = tree;
            for(let i=0; i<parts.length-1; i++) {
                if(!currentLevel[parts[i]]) {
                    currentLevel[parts[i]] = { directory: {} };
                }
                currentLevel = currentLevel[parts[i]].directory;
            }
            const filename = parts[parts.length-1];
            currentLevel[filename] = {
                file: {
                    contents: fileObj.content || ''
                }
            };
        }
    }

    await webcontainerInstance.mount(tree);
}
