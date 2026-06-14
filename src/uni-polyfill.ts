/**
 * uni-app API polyfill for H5 development mode.
 * In HBuilder X (App mode), the real uni APIs are available globally.
 * This file provides simple equivalents for browser development.
 */

// Simple router for H5 mode
let currentPage = 'index';
const pageStack: string[] = ['index'];

function navigateTo(url: string) {
  const pageName = url.replace('/pages/', '').replace('/index', '').replace(/\?.*/, '').replace(/\//g, '');
  currentPage = pageName || 'index';
  pageStack.push(currentPage);
  // In H5, trigger a custom event that the app shell listens to
  window.dispatchEvent(new CustomEvent('navigate', { detail: { page: currentPage, url } }));
}

function navigateBack() {
  if (pageStack.length > 1) {
    pageStack.pop();
    currentPage = pageStack[pageStack.length - 1];
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page: currentPage, url: '' } }));
  }
}

function showToast(opts: { title: string; icon?: string }) {
  // Simple toast
  const el = document.createElement('div');
  el.textContent = opts.title;
  el.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:12px 24px;border-radius:8px;z-index:9999;font-size:14px;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function showLoading(opts: { title: string }) {
  const el = document.createElement('div');
  el.id = 'uni-loading';
  el.textContent = opts.title;
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;padding:20px 30px;border-radius:8px;z-index:9999;font-size:14px;';
  document.body.appendChild(el);
}

function hideLoading() {
  const el = document.getElementById('uni-loading');
  if (el) el.remove();
}

function showModal(opts: { title?: string; content: string; confirmText?: string; cancelText?: string; confirmColor?: string; success?: (res: { confirm: boolean }) => void }): void {
  const ok = window.confirm(`${opts.title || ''}\n${opts.content}`);
  opts.success?.({ confirm: ok });
}

function showActionSheet(opts: { itemList: string[]; success?: (res: { tapIndex: number }) => void }) {
  const choice = prompt(opts.itemList.map((item, i) => `${i}: ${item}`).join('\n'));
  if (choice !== null) {
    opts.success?.({ tapIndex: parseInt(choice) });
  }
}

function stopPullDownRefresh() { /* no-op in H5 */ }

function chooseFile(opts: { count: number; type: string; extension: string[]; success: (res: any) => void }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = opts.extension.map(e => e).join(',');
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      opts.success({ tempFiles: [{ path: URL.createObjectURL(file), name: file.name }] });
    }
  };
  input.click();
}

function getFileSystemManager() {
  return {
    readFileSync(filePath: string) {
      // Return from fetch
      const xhr = new XMLHttpRequest();
      xhr.open('GET', filePath, false);
      xhr.responseType = 'arraybuffer';
      xhr.send();
      return new Uint8Array(xhr.response);
    },
  };
}

// Install globally
if (typeof (globalThis as any).uni === 'undefined') {
  (globalThis as any).uni = {
    navigateTo: (opts: { url: string }) => navigateTo(opts.url),
    navigateBack,
    showToast,
    showLoading,
    hideLoading,
    showModal,
    showActionSheet,
    stopPullDownRefresh,
    chooseFile,
    getFileSystemManager,
  };
}

// Also export for direct use
export { navigateTo, navigateBack, showToast, showLoading, hideLoading, showModal };
