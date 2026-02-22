"use strict";
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mime = require('mime-types');
const { exec } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

function sanitizeDirName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
}

function compareVersions(v1, v2) {
    if (!v1) return -1; if (!v2) return 1;
    const a = v1.toString().split('.').map(Number);
    const b = v2.toString().split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0)) return 1;
        if ((a[i] || 0) < (b[i] || 0)) return -1;
    }
    return 0;
}

function findBestConnection(connections, projectId) {
    return connections.sort((a, b) => {
        const vComp = compareVersions(b.syncVersion, a.syncVersion);
        if (vComp !== 0) return vComp;
        if (a.focused !== b.focused) return b.focused ? 1 : -1;
        if (projectId) {
            const aMatch = a.url && a.url.includes(projectId);
            const bMatch = b.url && b.url.includes(projectId);
            if (aMatch !== bMatch) return bMatch ? 1 : -1;
        }
        return 0;
    })[0];
}

function wakeBrowser() {
    const url = 'https://websim.com';
    const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
    exec(`${start} ${url}`);
}

const SYNC_VERSION = "1.5.2";

async function killPortProcess(port) {
    return new Promise((resolve) => {
        const cmd = process.platform === 'win32'
            ? `netstat -ano | findstr :${port}`
            : `lsof -i tcp:${port} -t`;

        exec(cmd, (err, stdout) => {
            if (err || !stdout) return resolve();
            const lines = stdout.trim().split('\n');
            const pids = new Set();
            lines.forEach(line => {
                if (process.platform === 'win32') {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0' && pid !== process.pid.toString()) pids.add(pid);
                } else {
                    if (line.trim() && line.trim() !== process.pid.toString()) pids.add(line.trim());
                }
            });

            if (pids.size > 0) {
                const pidList = Array.from(pids);
                const killCmd = process.platform === 'win32'
                    ? `taskkill /F /PID ${pidList.join(' /PID ')}`
                    : `kill -9 ${pidList.join(' ')}`;
                exec(killCmd, () => {
                    setTimeout(resolve, 500); // Give OS time to release
                });
            } else resolve();
        });
    });
}

async function handleClone(pId, rev) {
    const id = pId || await ask('Project ID/URL: ');
    if (!id) return;

    // 1. Pre-resolve project node-side (public info)
    const cleanId = id.includes('websim.com') ? (id.includes('@') ? (id.split('@')[1].includes('/') ? id.split('@')[1] : id.split('/').pop().split('?')[0]) : id.split('/').pop().split('?')[0]) : id;
    let projectId = cleanId;
    let version = rev || 'latest';
    let title = 'Project';

    try {
        let res;
        if (cleanId.includes('/')) {
            const [user, slugParts] = cleanId.split('/');
            const slug = slugParts.split('?')[0];
            res = await fetch(`https://websim.com/api/v1/projects/${slug}?username=${user}`);
        } else {
            res = await fetch(`https://websim.com/api/v1/projects/${projectId}`);
        }
        if (res.ok) {
            const data = await res.json();
            projectId = data.project.id;
            title = data.project.title;
            if (version === 'latest') version = data.project.current_version || (data.project_revision && data.project_revision.version) || 1;
        }
    } catch (e) { }

    process.stdout.write(`Cloning ${title} (${projectId}) via Browser Proxy...\n`);
    await killPortProcess(38383);

    return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 38383 });
        let connections = [];
        let isCloning = false;
        let wakeTimeout = setTimeout(() => { if (connections.length === 0) wakeBrowser(); }, 3000);
        let timeout = setTimeout(() => { if (connections.length === 0) { wss.close(); resolve(); } }, 60000);

        wss.on('connection', (ws) => {
            ws.send(JSON.stringify({ type: 'hello', syncVersion: SYNC_VERSION }));
            ws.on('message', async (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.type === 'hello') {
                    connections.push({ ws, syncVersion: data.syncVersion, focused: data.focused, url: data.url, projectState: data.projectState });

                    // Wait a bit to see if a better bridge connects
                    setTimeout(async () => {
                        if (isCloning) return;
                        const best = findBestConnection(connections, projectId);
                        if (!best) return;

                        isCloning = true;
                        clearTimeout(timeout);
                        clearTimeout(wakeTimeout);

                        process.stdout.write(`Bridge Connected! (Using v${best.syncVersion} from ${new URL(best.url).hostname})\n`);
                        if (compareVersions(best.syncVersion, SYNC_VERSION) < 0) {
                            process.stdout.write(`\r\x1b[33mWarning: Using an older bridge (v${best.syncVersion}). Recommended: v${SYNC_VERSION}\x1b[0m\n`);
                        }

                        process.stdout.write('Requesting asset list...\n');
                        best.ws.send(JSON.stringify({
                            type: 'pull-assets-list',
                            payload: { projectId, version }
                        }));

                        best.ws.on('message', (assetMsg) => {
                            const aData = JSON.parse(assetMsg.toString());
                            if (aData.type === 'assets-list') {
                                handleAssetList(aData, best.ws);
                            }
                        });
                    }, 500);
                }

                if (data.type === 'status' && data.message === 'error' && !isCloning) {
                    process.stdout.write(`\n\x1b[31mFailed to retrieve project info via bridge: ${data.error}\x1b[0m\n`);
                    wss.close(); resolve();
                }
            });
        });

        const handleAssetList = (data, ws) => {
            if (isCloning) return; // Should already be true, but for safety
            isCloning = true;

            const assets = data.assets || [];
            const folderName = sanitizeDirName(title || projectId);
            let finalDir = path.resolve(process.cwd(), folderName);
            let counter = 1;
            while (fs.existsSync(finalDir)) { finalDir = path.resolve(process.cwd(), `${folderName}_${counter++}`); }

            fs.mkdirSync(finalDir, { recursive: true });
            process.stdout.write(`Created folder: ${path.basename(finalDir)}\nBulk Pulling ${assets.length} files...\n`);

            let downloaded = 0;
            const total = assets.length;
            const concurrency = 5;
            let assetIndex = 0;

            const pullAsset = (index) => {
                if (index >= total) return;
                const asset = assets[index];
                ws.send(JSON.stringify({
                    type: 'pull-asset',
                    payload: { projectId, version, path: asset.path }
                }));
            };

            ws.on('message', (assetMsg) => {
                const aData = JSON.parse(assetMsg.toString());
                if (aData.type === 'asset-data') {
                    const dest = path.join(finalDir, aData.path);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest, Buffer.from(aData.content, 'base64'));
                    downloaded++;
                    const percent = Math.round((downloaded / total) * 100);
                    const barWidth = 25;
                    const filled = Math.round((downloaded / total) * barWidth);
                    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
                    process.stdout.write(`\r\x1b[36m${bar}\x1b[0m ${percent}% | ${downloaded}/${total} | ${path.basename(aData.path)}`.padEnd(100));

                    if (downloaded >= total) {
                        const config = { projectId, version, title, downloadedAt: new Date().toISOString() };
                        fs.writeFileSync(path.join(finalDir, '.websimconf'), JSON.stringify(config, null, 2));
                        process.stdout.write(`\n\x1b[32mSUCCESS! Cloned to ${path.basename(finalDir)}\x1b[0m\n`);
                        wss.close(); resolve();
                    } else {
                        pullAsset(assetIndex++);
                    }
                }
            });

            // Start initial batch
            for (let i = 0; i < Math.min(concurrency, total); i++) {
                pullAsset(assetIndex++);
            }
        };
    });
}

async function handleUpdate(rev) {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.websimconf')));
    } catch (e) {
        process.stdout.write('\x1b[31mError: No .websimconf found. Navigate to a synced project folder first.\x1b[0m\n');
        return;
    }

    const projectId = config.projectId;
    let version = rev || 'latest';
    let title = config.title || 'Project';

    process.stdout.write(`Updating ${title} (${projectId}) to ${version}...\n`);
    await killPortProcess(38383);

    return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 38383 });
        let connections = [];
        let isUpdating = false;
        let wakeTimeout = setTimeout(() => { if (connections.length === 0) wakeBrowser(); }, 3000);
        let timeout = setTimeout(() => { if (connections.length === 0) { wss.close(); resolve(); } }, 60000);

        wss.on('connection', (ws) => {
            ws.send(JSON.stringify({ type: 'hello', syncVersion: SYNC_VERSION }));
            ws.on('message', async (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.type === 'hello') {
                    connections.push({ ws, syncVersion: data.syncVersion, focused: data.focused, url: data.url, projectState: data.projectState });

                    setTimeout(async () => {
                        if (isUpdating) return;
                        const best = findBestConnection(connections, projectId);
                        if (!best) return;

                        isUpdating = true;
                        clearTimeout(timeout);
                        clearTimeout(wakeTimeout);

                        process.stdout.write(`Bridge Connected! Requesting assets for v${version}...\n`);
                        best.ws.send(JSON.stringify({
                            type: 'pull-assets-list',
                            payload: { projectId, version }
                        }));

                        best.ws.on('message', (assetMsg) => {
                            const aData = JSON.parse(assetMsg.toString());
                            if (aData.type === 'assets-list') {
                                handleAssetDownload(aData, best.ws);
                            }
                        });
                    }, 500);
                }

                if (data.type === 'status' && data.message === 'error' && !isUpdating) {
                    process.stdout.write(`\n\x1b[31mFailed to retrieve project info: ${data.error}\x1b[0m\n`);
                    wss.close(); resolve();
                }
            });
        });

        const handleAssetDownload = (data, ws) => {
            const assets = data.assets || [];
            const targetDir = process.cwd();
            const actualVersion = data.version || version;

            process.stdout.write(`Overwriting ${assets.length} files with v${actualVersion} data...\n`);

            let downloaded = 0;
            const total = assets.length;
            const concurrency = 5;
            let assetIndex = 0;

            const pullAsset = (index) => {
                if (index >= total) return;
                const asset = assets[index];
                ws.send(JSON.stringify({
                    type: 'pull-asset',
                    payload: { projectId, version: actualVersion, path: asset.path }
                }));
            };

            ws.on('message', (assetMsg) => {
                const aData = JSON.parse(assetMsg.toString());
                if (aData.type === 'asset-data') {
                    const dest = path.join(targetDir, aData.path);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest, Buffer.from(aData.content, 'base64'));
                    downloaded++;

                    const percent = Math.round((downloaded / total) * 100);
                    process.stdout.write(`\r\x1b[36mProgress:\x1b[0m ${percent}% | ${downloaded}/${total} | ${path.basename(aData.path)}`.padEnd(100));

                    if (downloaded >= total) {
                        config.version = parseInt(actualVersion);
                        config.updatedAt = new Date().toISOString();
                        fs.writeFileSync(path.join(targetDir, '.websimconf'), JSON.stringify(config, null, 2));
                        process.stdout.write(`\n\x1b[32mSUCCESS! Local files updated to v${actualVersion}\x1b[0m\n`);
                        wss.close(); resolve();
                    } else {
                        pullAsset(assetIndex++);
                    }
                }
            });

            for (let i = 0; i < Math.min(concurrency, total); i++) {
                pullAsset(assetIndex++);
            }
        };
    });
}

async function handleCopy(pId) {
    const id = pId || await ask('Project ID/URL: ');
    if (!id) return;
    const cleanId = id.includes('websim.com') ? (id.includes('@') ? id.split('@')[1] : id.split('/').pop()) : id;

    process.stdout.write(`Resolving ${cleanId}...\n`);

    let projectId = cleanId;
    let version = 1;

    if (cleanId.includes('/')) {
        const [user, slugParts] = cleanId.split('/');
        const slug = slugParts.split('?')[0];
        try {
            const res = await fetch(`https://websim.com/api/v1/projects/${slug}?username=${user}`);
            const data = await res.json();
            projectId = data.project.id;
            version = data.project.current_version || 1;
        } catch (e) {
            console.error("Resolve failed, assuming direct ID.");
        }
    }

    process.stdout.write(`Fetching metadata for ${projectId}...\n`);
    const downloadPromise = (async () => {
        const res = await fetch(`https://websim.com/api/v1/projects/${projectId}/revisions/${version}/assets`);
        const data = await res.json();
        const files = [];
        for (const asset of data.assets) {
            const aRes = await fetch(`https://websim.com/api/v1/projects/${projectId}/revisions/${version}/assets/${asset.path}`);
            if (!aRes.ok) {
                process.stdout.write(`\n\x1b[31mFailed to download asset: ${asset.path} (Status: ${aRes.status})\x1b[0m\n`);
                continue;
            }
            const buffer = await aRes.arrayBuffer();
            files.push({ path: asset.path, content: Buffer.from(buffer).toString('base64'), contentType: asset.content_type, size: asset.size });
        }
        return files;
    })();

    process.stdout.write('Simultaneous copy and assets download starting...\n');
    await killPortProcess(38383);

    return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 38383 });
        let isInitialized = false;
        let copyInitialized = false;
        let wakeTimeout = setTimeout(() => { if (!isInitialized) wakeBrowser(); }, 3000);
        let timeout = setTimeout(() => { if (!isInitialized) { wss.close(); resolve(); } }, 45000);

        wss.on('connection', (ws) => {
            if (copyInitialized) return;
            copyInitialized = true;
            isInitialized = true;
            clearTimeout(timeout);
            clearTimeout(wakeTimeout);
            process.stdout.write('Bridge connected! Initializing project on Websim...\n');
            ws.send(JSON.stringify({ type: 'create-init' }));

            ws.on('message', async (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.type === 'assignment') {
                    const filesToPush = await downloadPromise;
                    process.stdout.write('\nDownload complete! Synchronizing Assets...\n');
                    ws.send(JSON.stringify({
                        type: 'create-meta',
                        payload: {
                            projectId: data.projectId,
                            parentVersion: data.version || 1,
                            revisionId: data.revisionId,
                            title: 'Copy of ' + (projectId),
                            slug: 'copy-' + Math.random().toString(36).substring(2, 6),
                            files: filesToPush
                        }
                    }));
                }
                if (data.type === 'status') {
                    if (data.message === 'created') {
                        process.stdout.write(`\n\x1b[32mSUCCESS! Project Copied to Websim!\x1b[0m\n`);
                        process.stdout.write(`URL (ID):   https://websim.com/p/${data.projectId}\n`);
                        process.stdout.write(`URL (Slug): https://websim.com/@${data.username}/${data.slug}\n\n`);

                        const folderName = sanitizeDirName(data.title || data.projectId);
                        let finalDir = path.join(process.cwd(), folderName);
                        let counter = 1;
                        while (fs.existsSync(finalDir)) { finalDir = path.join(process.cwd(), `${folderName}_${counter++}`); }

                        process.stdout.write(`Creating local folder: ${finalDir}...\n`);
                        fs.mkdirSync(finalDir, { recursive: true });

                        const files = await downloadPromise;
                        process.stdout.write(`Writing ${files.length} files...\n`);
                        for (const f of files) {
                            f.skip = false;
                            const dest = path.join(finalDir, f.path);
                            fs.mkdirSync(path.dirname(dest), { recursive: true });
                            fs.writeFileSync(dest, Buffer.from(f.content, 'base64'));
                        }

                        const config = {
                            projectId: data.projectId,
                            version: data.version || 1,
                            title: data.title,
                            downloadedAt: new Date().toISOString()
                        };

                        const configPath = path.join(finalDir, '.websimconf');
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                        process.stdout.write(`\x1b[32mConfig saved to: ${configPath}\x1b[0m\n`);
                        process.stdout.write(`\x1b[36mDone! You can now 'cd ${path.basename(finalDir)}' and start working.\x1b[0m\n`);
                    } else if (data.message !== 'success') {
                        process.stdout.write(`\n\x1b[31mFAILED: ${data.error || 'Unknown Error'}\x1b[0m\n`);
                    }
                    wss.close();
                    resolve();
                }
            });
        });
    });
}

async function handlePush() {
    let config;
    try { config = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.websimconf'))); } catch (e) {
        process.stdout.write('Enter Project ID or URL: ');
        const id = await ask('');
        if (!id) return;
        config = { projectId: id.includes('websim.com') ? id.split('/').pop().split('?')[0] : id, version: 1 };
    }

    process.stdout.write(`Connecting to browser bridge for ${config.projectId}...\n`);
    await killPortProcess(38383);

    return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 38383 });
        let connections = [];

        let timeout = setTimeout(() => { if (connections.length === 0) { wss.close(); resolve(); } }, 30000);

        let pushTriggered = false;
        const startPushWithBest = async () => {
            if (pushTriggered) return;
            const best = findBestConnection(connections, config.projectId);
            if (!best) return;

            pushTriggered = true;
            clearTimeout(timeout);

            process.stdout.write(`Bridge Connected! (Using v${best.syncVersion || 'Unknown'})\n`);
            if (compareVersions(best.syncVersion, SYNC_VERSION) < 0) {
                process.stdout.write(`\r\x1b[33mWarning: Bridge is outdated (v${best.syncVersion}). Update recommended.\x1b[0m\n`);
            }

            const files = [];
            const walk = (pDir) => {
                fs.readdirSync(pDir).forEach(file => {
                    if (['.websimconf', 'node_modules', '.git', 'package-lock.json', '.DS_Store', 'dist', 'build'].includes(file)) return;
                    const fullPath = path.join(pDir, file);
                    const rel = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
                    if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
                    else {
                        const content = fs.readFileSync(fullPath);
                        files.push({ path: rel, content: content.toString('base64'), contentType: mime.lookup(fullPath), size: content.length, skip: false });
                    }
                });
            };
            walk(process.cwd());

            best.ws.send(JSON.stringify({
                type: 'push',
                payload: { projectId: config.projectId, parentVersion: config.version, files }
            }));

            best.ws.on('message', (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.type === 'status') {
                    if (data.message === 'success') {
                        process.stdout.write(`\r\x1b[32mPush Successful! Project updated to v${data.version}\x1b[0m\n`);
                        if (data.username && data.slug) {
                            process.stdout.write(`URL (ID):   https://websim.com/p/${data.projectId}\n`);
                            process.stdout.write(`URL (Slug): https://websim.com/@${data.username}/${data.slug}\n\n`);
                        }
                        config.version = data.version;
                        fs.writeFileSync(path.join(process.cwd(), '.websimconf'), JSON.stringify(config, null, 2));
                    } else console.error(`\rPush Failed: ${data.error}\n`);
                    wss.close(); resolve();
                }
                if (data.type === 'progress') {
                    const bars = ['[=---]', '[-=--]', '[--=-]', '[---=]'];
                    process.stdout.write(`\r[Phase ${data.step}/4] ${data.label} ${bars[data.step % 4]}   `);
                }
            });
        };

        wss.on('connection', (ws) => {
            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg.toString());
                    if (data.type === 'hello') {
                        connections.push({ ws, syncVersion: data.syncVersion, focused: data.focused, url: data.url, projectState: data.projectState });
                        setTimeout(startPushWithBest, 500);
                    }
                } catch (e) { }
            });
        });
    });
}

async function handleCreate(options = {}) {
    let projectDir = process.cwd();
    let title = 'Local Project';

    if (options.isExisting) {
        if (!fs.existsSync(path.join(process.cwd(), 'index.html'))) {
            process.stdout.write('\x1b[31mError: index.html not found in current directory.\x1b[0m\n');
            return;
        }
        title = path.basename(process.cwd());
    } else {
        title = await ask('Project Title (Leave blank for "Local Project"): ') || 'Local Project';
    }

    process.stdout.write('Initializing new project on Websim...\n');
    await killPortProcess(38383);

    return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 38383 });
        let initSent = false;
        let createTriggered = false;
        let isInitialized = false;
        let wakeTimeout = setTimeout(() => { if (!isInitialized) wakeBrowser(); }, 3000);
        let timeout = setTimeout(() => { if (!isInitialized) { wss.close(); resolve(); } }, 45000);

        wss.on('connection', (ws) => {
            ws.on('message', async (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.type === 'hello') {
                    if (initSent) return;
                    isInitialized = true;
                    initSent = true;
                    clearTimeout(timeout);
                    clearTimeout(wakeTimeout);
                    ws.send(JSON.stringify({ type: 'create-init' }));
                }

                if (data.type === 'assignment') {
                    if (createTriggered) return;
                    createTriggered = true;

                    const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 6)).substring(0, 50);

                    if (!options.isExisting) {
                        const folderName = sanitizeDirName(title);
                        projectDir = path.join(process.cwd(), folderName);
                        let counter = 1;
                        while (fs.existsSync(projectDir)) { projectDir = path.join(process.cwd(), `${folderName}_${counter++}`); }
                        fs.mkdirSync(projectDir, { recursive: true });
                        fs.writeFileSync(path.join(projectDir, 'index.html'), `<!DOCTYPE html><html><body><h1>${title}</h1></body></html>`);
                    }

                    const files = [];
                    const walk = (pDir) => {
                        fs.readdirSync(pDir).forEach(file => {
                            if (['.websimconf', 'node_modules', '.git', 'package-lock.json', '.DS_Store', 'dist', 'build'].includes(file)) return;
                            const fullPath = path.join(pDir, file);
                            const rel = path.relative(projectDir, fullPath).replace(/\\/g, '/');
                            if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
                            else {
                                const content = fs.readFileSync(fullPath);
                                files.push({ path: rel, content: content.toString('base64'), contentType: mime.lookup(fullPath), size: content.length, skip: false });
                            }
                        });
                    };
                    walk(projectDir);

                    ws.send(JSON.stringify({
                        type: 'create-meta',
                        payload: { projectId: data.projectId, parentVersion: data.version || 1, revisionId: data.revisionId, title, slug, files }
                    }));
                }
                if (data.type === 'status') {
                    if (data.message === 'created') {
                        process.stdout.write(`\n\x1b[32mSUCCESS! Project Created on Websim!\x1b[0m\n`);
                        process.stdout.write(`URL (ID):   https://websim.com/p/${data.projectId}\n`);
                        process.stdout.write(`URL (Slug): https://websim.com/@${data.username}/${data.slug}\n\n`);

                        // Ensure we use the best title available
                        const finalTitle = data.title || title;

                        if (data.files && data.files.length > 0 && !options.isExisting) {
                            process.stdout.write(`Writing ${data.files.length} files to ${projectDir}...\n`);
                            for (const f of data.files) {
                                const dest = path.join(projectDir, f.path);
                                fs.mkdirSync(path.dirname(dest), { recursive: true });
                                fs.writeFileSync(dest, Buffer.from(f.content, 'base64'));
                            }
                        }

                        const config = {
                            projectId: data.projectId,
                            version: data.version || 1,
                            title: finalTitle,
                            downloadedAt: new Date().toISOString()
                        };

                        const configPath = path.join(projectDir, '.websimconf');
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                        process.stdout.write(`\x1b[32mConfig saved to: ${configPath}\x1b[0m\n`);
                        if (!options.isExisting) process.stdout.write(`\x1b[36mDone! You can now 'cd ${path.basename(projectDir)}' and start working.\x1b[0m\n`);
                    } else if (data.message !== 'success') {
                        process.stdout.write(`\n\x1b[31mFAILED: ${data.error || 'Unknown Error'}\x1b[0m\n`);
                    }
                    wss.close(); resolve();
                }
            });
        });
    });
}

async function main() {
    try {
        const args = process.argv.slice(2);
        const isExisting = args.includes('-e');
        const cleanArgs = args.filter(a => a !== '-e');
        let cmd = cleanArgs[0];
        let pId = cleanArgs[1];
        let rev = cleanArgs[2];

        if (cmd && !['clone', 'push', 'create', 'copy', 'help', 'upd', 'update'].includes(cmd)) { pId = cmd; rev = args[1]; cmd = 'clone'; }

        if (cmd === 'clone') await handleClone(pId, rev);
        else if (cmd === 'push' || cmd === 'sync') await handlePush(pId, rev);
        else if (cmd === 'update' || cmd === 'upd') await handleUpdate(pId); // pId is used for revision positional arg here
        else if (cmd === 'create') await handleCreate({ isExisting });
        else if (cmd === 'copy') await handleCopy(pId);
        else {
            console.log('Websim CLI\nCommands: create [-e], copy {id}, clone {id}, update {rev}, push, sync');
            const c = await ask('Choice (1:create, 2:copy, 3:clone, 4:push/sync, 5:update): ');
            if (c === '1') {
                const e = await ask('Import existing directory? (y/n): ');
                await handleCreate({ isExisting: e.toLowerCase() === 'y' });
            } else if (c === '2') await handleCopy(); else if (c === '3') await handleClone(); else if (c === '4') await handlePush();
            else if (c === '5') {
                process.stdout.write('Enter Revision (Leave blank for latest): ');
                const r = await ask('');
                await handleUpdate(r);
            }
        }
    } catch (e) { console.error('CLI Error:', e.message); } finally { rl.close(); process.exit(0); }
}
main();
