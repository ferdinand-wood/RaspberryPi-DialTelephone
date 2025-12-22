const express = require('express');

const app = express();
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

const Phone = require('./phone');
const config = require('./helpers/config');

let phone = new Phone();

app.get('/', (req, res) => {

  res.render("index.ejs", {message:''});
});

app.get('/ring', (req, res) => {
  phone.startRinging();
  res.render("index.ejs", {message:'Phone ringing'});
});

app.get('/stopRing', (req, res) => {
  phone.stopRinging();
  res.render("index.ejs", {message:'Ringing stopped'});
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
      phone.startWebRecording(filename, { device });
    } else {
      phone.startWebRecording(filename);
    }
    res.json({ ok: true, filename, device: device || null });
  } catch (err) {
    console.error(`Start recording failed: ${err}`);
    res.status(500).json({ ok: false, err: err.message || String(err) });
  }
});

// Stop a recording (returns JSON with length)
app.post('/stopRecording', (req, res) => {
  try {
    const lengthInMs = phone.stopWebRecording();
    res.json({ ok: true, lengthInMs });
  } catch (err) {
    console.error(`Stop recording failed: ${err}`);
    res.status(500).json({ ok: false, err: err.message || String(err) });
  }
});