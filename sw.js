// Service Worker 的程式碼
// 【註】: 此檔案必須與 index.html 放在同一個伺服器目錄下

const DB_NAME_SW = 'VirtualFileSystemDB';
const STORE_NAME_SW = 'files';
let dbSW; // Service Worker 自己的 IndexedDB 連接實例

/**
 * 在 Service Worker 中初始化 IndexedDB
 * @returns {Promise<void>}
 */
function initDB_SW() {
    // 使用 Promise 來處理非同步操作
    return new Promise((resolve, reject) => {
        if (dbSW) { // 如果已經初始化過，則直接成功
            console.log('Service Worker: IndexedDB 已初始化。');
            resolve();
            return;
        }
        const request = indexedDB.open(DB_NAME_SW, 1);

        request.onerror = (event) => {
            console.error('Service Worker: 資料庫開啟失敗:', event.target.errorCode);
            reject(event.target.error);
        };

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

// 監聽來自客戶端 (主頁面) 的訊息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'INIT_DB') {
        // 收到主線程的初始化請求後，開始連接 DB
        initDB_SW().then(() => {
            // 連接成功後，通知主線程已準備好
            if (event.ports[0]) {
                 event.ports[0].postMessage({ status: 'DB_READY' });
            }
        }).catch(error => {
            console.error("Service Worker DB 初始化失敗:", error);
        });
    }
});

// 監聽 fetch 事件，攔截 iframe 內部的網路請求
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 我們只攔截來自於 `/vfs/` 路徑的請求，這些是我們虛擬檔案系統中的檔案
    // 並確保只處理同源請求
    if (url.origin === self.location.origin && url.pathname.startsWith('/vfs/')) {
        const filename = decodeURIComponent(url.pathname.substring(5)); // 從 /vfs/ 之後取檔案名並解碼
        
        event.respondWith(
            (async () => {
                try {
                    // 確保 dbSW 已準備好，如果還沒好就等待初始化完成
                    if (!dbSW) {
                        await initDB_SW();
                    }

                    const transaction = dbSW.transaction([STORE_NAME_SW], 'readonly');
                    const objectStore = transaction.objectStore(STORE_NAME_SW);
                    const request = objectStore.get(filename);

                    // 將 IndexedDB 的回呼轉換為 Promise
                    const file = await new Promise((resolve, reject) => {
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });

                    if (file) {
                        // 如果在資料庫中找到檔案，則回傳檔案內容
                        console.log(`Service Worker 找到檔案: ${file.name}, MIME: ${file.mimeType}`);
                        return new Response(file.content, {
                            status: 200,
                            headers: { 'Content-Type': file.mimeType }
                        });
                    } else {
                        // 【改進】: 如果在資料庫中找不到檔案，直接回傳 404
                        console.warn(`Service Worker: 虛擬檔案系統中找不到檔案: ${filename}`);
                        return new Response(`File not found in virtual file system: ${filename}`, {
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

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});
