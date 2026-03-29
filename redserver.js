const express = require('express');

const app = express();
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

const phoneLogs = [];
const maxPhoneLogs = 300;

function addPhoneLog(level, ...args) {
  const ts = new Date().toISOString();
  const text = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  const line = `[${ts}] ${level.toUpperCase()}: ${text}`;
  phoneLogs.push(line);
  if (phoneLogs.length > maxPhoneLogs) phoneLogs.shift();
}

const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => {
  addPhoneLog('log', ...args);
  originalLog(...args);
};
console.error = (...args) => {
  addPhoneLog('error', ...args);
  originalError(...args);
};

const fs = require('fs');
const Phone = require('./phone');
const config = require('./helpers/config');

let phone = new Phone();

app.get('/', (req, res) => {

  res.render("index.ejs", {message:''});
});

var message = null;

app.post('/sendMessage', (req, res) => {
  let message = req.body.message
  phone.acceptMessage(message);
  res.render("index.ejs", {message:`Message "${message}" sent. The phone will ring immediately with the message.`});
});

app.post('/sendQuestion', (req, res) => {
  let question = req.body.question;
  phone.acceptQuestion(question);
  res.render("index.ejs", {message:`Question "${question}" sent. The phone will ring later with the answer.`});
});

app.set('view-engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

const port = 3000;
console.log(`Server listening on:${port}`);

phone.ding();

app.listen(port, () => console.log("Server started"));


// Return available capture devices (uses arecord -l if available)
app.get('/devices', (req, res) => {
  const { exec } = require('child_process');
  exec('arecord -l', (err, stdout, stderr) => {
    if (err){
      console.warn(`arecord not available or failed: ${err}`);
      return res.json([]);
    }
    const devices = [];
    const lines = stdout.split('\n');
    // Parse lines like: card 3: Device [USB Audio Device], device 0: USB Audio [USB Audio]
    for (const line of lines){
      const m = line.match(/card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*(.+)$/i);
      if (m){
        const card = m[1];
        const cardName = m[2].trim();
        const deviceNum = m[3];
        const deviceName = m[4].trim();
        const id = `plughw:${card},${deviceNum}`;
        const label = `card ${card}: ${cardName} - device ${deviceNum}: ${deviceName}`;
        devices.push({ id, label });
      }
    }
    res.json(devices);
  });
});

// Return current saved config (useful for UI)
app.get('/config', (req, res) => {
  res.json(config.all());
});

// Save default device
app.post('/config/device', (req, res) => {
  const device = req.body.device;
  if (!device || typeof device !== 'string'){
    return res.status(400).json({ ok: false, err: 'device required' });
  }
  config.set('soundDevice', device);
  config.save();
  res.json({ ok: true, device });
});

// Start a recording (returns JSON)
app.post('/startRecording', (req, res) => {
  const filename = req.body.filename || `./recordings/web_recording_${Date.now()}.wav`;
  // Priority: explicit request -> saved config -> env var
  const device = req.body.device || config.get('soundDevice') || process.env.SOUND_DEVICE;
  try {
    if (device) {
      phone.startRecording(filename, { device });
    } else {
      phone.startRecording(filename);
    }
    res.json({ ok: true, filename, device: device || null });
  } catch (err) {
    console.error(`Start recording failed: ${err}`);
    res.status(500).json({ ok: false, err: err.message || String(err) });
  }
});

// Stop a recording (returns JSON with length)
app.post('/stopRecording', async (req, res) => {
  try {
    const lengthInMs = await phone.stopRecording();
    res.json({ ok: true, lengthInMs });
  } catch (err) {
    console.error(`Stop recording failed: ${err}`);
    res.status(500).json({ ok: false, err: err.message || String(err) });
  }
});

// Get current phone status
app.get('/status', (req, res) => {
  res.json({
    state: phone.getState(),
    recording: phone.recording,
    handsetRest: phone.handsetSwitch.handsetOnPhone()
  });
});

// Get recent phone console logs (including phone.js internal logs)
app.get('/phoneLogs', (req, res) => {
  res.json(phoneLogs.slice(-maxPhoneLogs));
});

// Get recordings file list
app.get('/recordings', (req, res) => {
  const dir = './recordings';
  fs.readdir(dir, { withFileTypes: true }, (err, files) => {
    if (err) {
      console.error(`Failed to read recordings directory: ${err}`);
      return res.status(500).json([]);
    }
    const items = files
      .filter(f => f.isFile())
      .map(f => {
        const stat = fs.statSync(`${dir}/${f.name}`);
        return { name: f.name, size: stat.size };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json(items);
  });
});

// Get free disk space
app.get('/diskSpace', (req, res) => {
  const { exec } = require('child_process');
  exec('df -k .', (err, stdout, stderr) => {
    if (err) {
      console.error(`Failed to get disk space: ${err}`);
      return res.status(500).json({ ok: false, err: String(err) });
    }
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) {
      return res.status(500).json({ ok: false, err: 'Unexpected df output' });
    }
    const parts = lines[1].trim().split(/\s+/);
    // df output: Filesystem 1K-blocks Used Available Use% Mounted on
    const available = Number(parts[3] || 0);
    const total = Number(parts[1] || 0);
    const used = Number(parts[2] || 0);
    const availBytes = available * 1024;
    const totalBytes = total * 1024;
    const usedBytes = used * 1024;
    res.json({ ok: true, available: availBytes, used: usedBytes, total: totalBytes });
  });
});
});

// Download a recording file
app.get('/recordings/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Invalid filename');
  }
  const filePath = `${__dirname}/recordings/${filename}`;
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error(`Error downloading file ${filePath}: ${err}`);
      if (!res.headersSent) {
        res.status(404).send('File not found');
      }
    }
  });
});