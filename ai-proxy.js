#!/usr/bin/env node
/*
  开发者工作台 · 本地 AI 中转
  ------------------------------------------------------------
  作用：有些 AI 服务商不允许网页直接调用（跨域限制），用这个小程序在你自己电脑上转一下。
  要求：电脑上装好 Node.js 16 或以上，不需要安装任何依赖。

  用法：
    node ai-proxy.js                 # 默认端口 8787
    PORT=9000 node ai-proxy.js       # 换端口（Windows PowerShell：$env:PORT=9000; node ai-proxy.js）

  然后在工作台「设置 → AI 接口 → 接口地址」里，把原地址前面加上 http://127.0.0.1:8787/
    例如：http://127.0.0.1:8787/https://api.deepseek.com

  安全说明：
    · 只监听本机 127.0.0.1，局域网里的其他设备访问不到；
    · 只转发到公网地址，默认拒绝转发到 localhost / 局域网地址（如确实需要，设置 ALLOW_LAN=1）；
    · 不保存、不记录任何请求内容和 API Key。

  许可：个人使用免费，商业使用需授权，详见 LICENSE。
  Developed by @赛博老爸
*/
'use strict';
const http = require('http');
const https = require('https');
const PORT = parseInt(process.env.PORT, 10) || 8787;
const ALLOW_LAN = process.env.ALLOW_LAN === '1';

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function fail(res, code, msg) {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { message: msg } }));
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const raw = req.url.slice(1).replace(/^(https?):\/+/i, '$1://');
  if (!raw) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('开发者工作台 AI 中转正在运行。\n把接口地址改成 http://127.0.0.1:' + PORT + '/ 加原地址即可，例如 http://127.0.0.1:' + PORT + '/https://api.deepseek.com\n\nDeveloped by @赛博老爸\n');
    return;
  }

  let target;
  try { target = new URL(raw); } catch (e) { fail(res, 400, '地址格式不对：' + raw); return; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') { fail(res, 400, '只支持 http / https 地址'); return; }
  if (!ALLOW_LAN && isPrivateHost(target.hostname)) { fail(res, 403, '默认不转发到本机或局域网地址；如确实需要，请用 ALLOW_LAN=1 启动'); return; }

  const headers = Object.assign({}, req.headers);
  ['host', 'origin', 'referer', 'connection', 'content-length'].forEach((k) => delete headers[k]);
  Object.keys(headers).forEach((k) => { if (k.startsWith('sec-')) delete headers[k]; });
  headers.host = target.host;

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length) headers['content-length'] = body.length;
    const lib = target.protocol === 'https:' ? https : http;
    const up = lib.request(target, { method: req.method, headers, timeout: 120000 }, (ur) => {
      const h = Object.assign({}, ur.headers);
      Object.keys(h).forEach((k) => { if (k.startsWith('access-control-')) delete h[k]; });
      res.writeHead(ur.statusCode || 502, h);
      ur.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('上游响应超时')));
    up.on('error', (e) => fail(res, 502, '中转请求失败：' + e.message));
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    up.end(body);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('端口 ' + PORT + ' 已被占用，可以换一个：PORT=9000 node ai-proxy.js');
  else console.error(e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  开发者工作台 · AI 中转已启动');
  console.log('  接口地址填：http://127.0.0.1:' + PORT + '/ + 原地址');
  console.log('  例如：      http://127.0.0.1:' + PORT + '/https://api.deepseek.com');
  console.log('  按 Ctrl + C 停止');
  console.log('');
  console.log('  Developed by @赛博老爸');
  console.log('');
});
