// Service Worker Code - sw.js

const DB_NAME_SW = 'VirtualFileSystemDB';
const STORE_NAME_SW = 'files';
let dbSW;

// 動態計算 VFS 的路徑前綴
// self.location.pathname 會是像 /WebpageStorage/sw.js 這樣的路徑
const swPath = self.location.pathname;
// 我們取到最後一個 '/' 之前的部分，得到 /WebpageStorage/
const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1);
// 完整的虛擬檔案系統前綴
const VFS_PREFIX = basePath + 'vfs/';

console.log(`Service Worker 啟動，虛擬檔案系統前綴為: ${VFS_PREFIX}`);

/**
 * 在 Service Worker 中初始化 IndexedDB
 * @returns {Promise<void>}
 */
function initDB_SW() {
    return new Promise((resolve, reject) => {
        if (dbSW) { resolve(); return; }
        const request = indexedDB.open(DB_NAME_SW, 1);
        request.onerror = (event) => reject(event.target.error);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME_SW)) {
                db.createObjectStore(STORE_NAME_SW, { keyPath: 'name' });
            }
        };
        request.onsuccess = (event) => {
            dbSW = event.target.result;
            console.log('Service Worker: 資料庫連接成功');
            resolve();
        };
    });
}

// 監聽來自客戶端的訊息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'INIT_DB') {
        initDB_SW().then(() => {
            if (event.ports[0]) {
                event.ports[0].postMessage({ status: 'DB_READY' });
            }
        }).catch(error => console.error("Service Worker DB 初始化失敗:", error));
    }
});

/**
 * 【修正後】: 監聽 fetch 事件，使用動態計算的前綴來攔截請求。
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 只攔截來自同源且路徑符合我們虛擬檔案系統前綴的請求
    if (url.origin === self.location.origin && url.pathname.startsWith(VFS_PREFIX)) {
        
        // 從路徑中提取檔案名稱
        const filename = decodeURIComponent(url.pathname.substring(VFS_PREFIX.length));
        
        console.log(`Service Worker 攔截到請求: ${url.pathname}, 檔案名: ${filename}`);

        event.respondWith(
            (async () => {
                try {
                    // 確保 DB 已初始化
                    if (!dbSW) {
                        await initDB_SW();
                    }

                    const transaction = dbSW.transaction([STORE_NAME_SW], 'readonly');
                    const objectStore = transaction.objectStore(STORE_NAME_SW);
                    const request = objectStore.get(filename);

                    const file = await new Promise((resolve, reject) => {
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });

                    if (file) {
                        // 如果在資料庫中找到檔案，則回傳檔案內容
                        return new Response(file.content, {
                            status: 200,
                            headers: { 'Content-Type': file.mimeType }
                        });
                    } else {
                        // 如果在資料庫中找不到檔案，直接回傳 404
                        console.warn(`Service Worker: 虛擬檔案系統中找不到檔案: ${filename}`);
                        return new Response(`File not found in virtual FS: ${filename}`, {
                            status: 404,
                            headers: { 'Content-Type': 'text/plain' }
                        });
                    }
                } catch (error) {
                    console.error('Service Worker fetch 處理中發生錯誤:', error);
                    return new Response('Service Worker internal error', { status: 500 });
                }
            })()
        );
    }
});

// 確保 Service Worker 在安裝後立即啟用
self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

// 確保 Service Worker 啟用後立即控制頁面
self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});