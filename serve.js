// سينما همام — home-network server.
//   http://<this PC's IP>/                 download page (remote-friendly)
//   http://<this PC's IP>/app/             the TV app in the browser
//   http://<this PC's IP>/CinemaHumam.apk  direct APK download  (also /apk)
// Usage: node serve.js [port]   (default 80, so no port is needed in the link)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

const port = +process.argv[2] || 80;
const SITE = path.join(__dirname, 'site');
const APP = path.join(__dirname, 'www');
const APK = path.join(__dirname, 'downloads', 'CinemaHumam.apk');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon'
};

function sendFile(res, file, extraHeaders) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
    res.writeHead(200, Object.assign({
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache'
    }, extraHeaders || {}));
    fs.createReadStream(file).pipe(res);
  });
}

function inside(root, rel) {
  const f = path.normalize(path.join(root, rel));
  return f.startsWith(root) ? f : null;
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  console.log(new Date().toLocaleTimeString(), req.socket.remoteAddress, p);

  if (p === '/' || p === '/index.html') return sendFile(res, path.join(SITE, 'index.html'));
  if (p === '/CinemaHumam.apk' || p === '/apk') {
    return sendFile(res, APK, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="CinemaHumam.apk"'
    });
  }
  if (p === '/apk-info') {
    return fs.stat(APK, (err, st) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(err ? {} : { size: st.size, date: st.mtime.toISOString().slice(0, 10) }));
    });
  }
  if (p === '/app') { res.writeHead(301, { Location: '/app/' }); return res.end(); }
  if (p.startsWith('/app/')) {
    const f = inside(APP, p.slice(5) || 'index.html');
    if (!f) { res.writeHead(403); return res.end(); }
    return sendFile(res, f);
  }
  res.writeHead(302, { Location: '/' });
  res.end();
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('\n  المنفذ ' + port + ' مستخدم من برنامج ثاني. سكّره أو شغّل: node serve.js 8080\n');
  else if (e.code === 'EACCES') console.error('\n  ما عندي صلاحية على المنفذ ' + port + '. جرّب تشغيل الملف كمسؤول (Run as administrator).\n');
  else console.error(e);
  process.exit(1);
}).listen(port, '0.0.0.0', () => {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((a) => {
    if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254')) ips.push(a.address);
  }));
  const suffix = port === 80 ? '' : ':' + port;
  console.log('\n  سينما همام شغّال ✓\n');
  ips.forEach((ip) => {
    console.log('  صفحة التحميل : http://' + ip + suffix);
    console.log('  رابط مباشر   : http://' + ip + suffix + '/apk');
    console.log('  التطبيق      : http://' + ip + suffix + '/app\n');
  });
  if (!fs.existsSync(APK)) console.log('  ⚠ ملف الـ APK غير موجود بعد — شغّل update-apk.bat\n');
  console.log('  خلّي هذه النافذة مفتوحة. للإيقاف: Ctrl+C\n');
});
