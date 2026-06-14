import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, 'logs');
const PUBLIC_DB = path.resolve(__dirname, 'public/hk_portfolio_db.db');
const DOWNLOADS_DIR = path.resolve(__dirname, 'downloads');
const HKEX_FILE = path.resolve(DOWNLOADS_DIR, 'hkex_list.xlsx');

// Custom plugin to handle API routes before Vite's internal handlers
function apiMiddleware(): Plugin {
  return {
    name: 'api-middleware',
    configureServer(server) {
      // Return a middleware function that runs BEFORE Vite internals
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        // /api/log — write log line to file
        if (url === '/api/log' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const { line } = JSON.parse(Buffer.concat(chunks).toString());
              const date = new Date().toISOString().slice(0, 10);
              const logFile = path.join(LOG_DIR, `server-${date}.log`);
              if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
              fs.appendFileSync(logFile, line + '\n');
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('ok');
            } catch (e: any) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('error: ' + e.message);
            }
          });
          return;
        }

        // /api/log/clear — truncate today's log
        if (url === '/api/log/clear' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const { date } = JSON.parse(Buffer.concat(chunks).toString());
              const logFile = path.join(LOG_DIR, `server-${date}.log`);
              if (fs.existsSync(logFile)) fs.truncateSync(logFile, 0);
              res.writeHead(200); res.end('ok');
            } catch (e: any) {
              res.writeHead(400); res.end('error: ' + e.message);
            }
          });
          return;
        }

        // /api/log/read — read today's log file
        if (url === '/api/log/read') {
          const date = new Date().toISOString().slice(0, 10);
          const logFile = path.join(LOG_DIR, `server-${date}.log`);
          if (fs.existsSync(logFile)) {
            const content = fs.readFileSync(logFile, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(content);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('(no logs for today)');
          }
          return;
        }

        // /api/save-hkex — save downloaded xlsx to project directory
        if (url === '/api/save-hkex' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
              fs.writeFileSync(HKEX_FILE, Buffer.concat(chunks));
              const size = fs.statSync(HKEX_FILE).size;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, path: HKEX_FILE, size }));
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
          return;
        }

        // /api/read-hkex — read saved xlsx file from disk
        if (url === '/api/read-hkex') {
          try {
            if (!fs.existsSync(HKEX_FILE)) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: '文件不存在，请先下载' }));
            } else {
              const buffer = fs.readFileSync(HKEX_FILE);
              res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Length': buffer.length,
              });
              res.end(buffer);
            }
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
          return;
        }

        // /api/check-hkex — check if saved xlsx exists
        if (url === '/api/check-hkex') {
          if (fs.existsSync(HKEX_FILE)) {
            const stat = fs.statSync(HKEX_FILE);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: true, size: stat.size, mtime: stat.mtime.toISOString() }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: false }));
          }
          return;
        }

        // /api/save-db — save sql.js snapshot
        if (url === '/api/save-db' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const buffer = Buffer.concat(chunks);
              fs.writeFileSync(PUBLIC_DB, buffer);
              res.writeHead(200); res.end('ok');
            } catch (e: any) {
              res.writeHead(500); res.end('error: ' + e.message);
            }
          });
          return;
        }

        // /api/yahoo/* — proxy to Yahoo Finance
        if (url.startsWith('/api/yahoo/')) {
          try {
            const targetUrl = 'https://query1.finance.yahoo.com' + url.replace('/api/yahoo', '');
            const response = await fetch(targetUrl);
            const text = await response.text();
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(text);
          } catch (e: any) {
            res.writeHead(502); res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }

        // /api/hkex/* — proxy to HKEX
        if (url.startsWith('/api/hkex/')) {
          try {
            const targetUrl = 'https://www.hkex.com.hk' + url.replace('/api/hkex', '');
            const response = await fetch(targetUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            res.writeHead(response.status, { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' });
            res.end(buffer);
          } catch (e: any) {
            res.writeHead(502); res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }

        // Not an API route — let Vite handle it
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), apiMiddleware()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173, strictPort: true },
});
