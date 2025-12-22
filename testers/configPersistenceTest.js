// Simple integration test for config persistence endpoints.
// Assumes server is running on localhost:3000

const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: data }); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const deviceToSet = 'plughw:99,0';

    console.log('Posting /config/device =>', deviceToSet);
    let r = await request({
      hostname: '127.0.0.1', port: 3000, path: '/config/device', method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ device: deviceToSet }));
    console.log('Status:', r.statusCode, 'Body:', r.body);
    const j1 = JSON.parse(r.body);
    if (!j1.ok) throw new Error('Failed to set device');

    console.log('Calling POST /startRecording without device to check saved device is used');
    r = await request({ hostname: '127.0.0.1', port: 3000, path: '/startRecording', method: 'POST', headers: { 'Content-Type': 'application/json' } }, null);
    console.log('Status:', r.statusCode, 'Body:', r.body);
    const j2 = JSON.parse(r.body);
    if (!j2.ok) throw new Error('Failed to start recording');
    if (j2.device !== deviceToSet) throw new Error(`Expected device ${deviceToSet} but got ${j2.device}`);

    console.log('Stopping recording');
    r = await request({ hostname: '127.0.0.1', port: 3000, path: '/stopRecording', method: 'POST' });
    console.log('Status:', r.statusCode, 'Body:', r.body);
    const j3 = JSON.parse(r.body);
    if (!j3.ok) throw new Error('Failed to stop recording');

    console.log('\n✅ Persistence test passed: saved device used by /startRecording');
  } catch (err) {
    console.error('\n❌ Persistence test failed:', err);
    process.exit(2);
  }
})();