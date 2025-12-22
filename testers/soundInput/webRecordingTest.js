const fs = require('fs');
const SoundInput = require('../../helpers/soundInput');

async function runTest(){
  const si = new SoundInput();
  const filename = './recordings/test_web_recording.wav';

  // Ensure no previous file
  try { fs.unlinkSync(filename); } catch(e){}

  si.startRecording(filename);

  // If a file stream exists, write multiple chunks to simulate captured audio
  const CHUNK_SIZE = 1024;
  const CHUNKS = 10; // write for ~CHUNKS * 200ms

  if (si.outputFileStream && !si.outputFileStream.destroyed){
    for (let i=0;i<CHUNKS;i++){
      si.outputFileStream.write(Buffer.alloc(CHUNK_SIZE, i % 256));
      console.log(`Wrote chunk ${i+1}/${CHUNKS} to output stream`);
      await new Promise((r) => setTimeout(r, 200));
    }
  } else if (si.micInputStream){
    // If the mic stream exists, emit data events to simulate mic input
    for (let i=0;i<CHUNKS;i++){
      si.micInputStream.emit('data', Buffer.alloc(CHUNK_SIZE, i % 256));
      console.log(`Emitted data chunk ${i+1}/${CHUNKS} to mic input stream`);
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    console.log('No output or mic input stream available; startRecording may have failed in this environment');
    await new Promise((r) => setTimeout(r, 2000));
  }

  si.stopRecording();

  // Wait a moment to let stream finish
  await new Promise((r) => setTimeout(r, 500));

  // Report file size and captured bytes
  try {
    const stats = fs.statSync(filename);
    console.log(`Recorded file size: ${stats.size} bytes`);
  } catch (err) {
    console.error(`Recorded file not found: ${err}`);
  }

  console.log(`BytesWritten reported by SoundInput: ${si.getBytesWritten()}`);

  // Optional: if RUN_ARECORD is set, record with arecord to verify hardware device directly
  if (process.env.RUN_ARECORD){
    const { spawnSync } = require('child_process');
    const arecordFile = './recordings/test_arecord.wav';
    try { fs.unlinkSync(arecordFile); } catch(e){}
    const device = process.env.SOUND_DEVICE || 'plughw:3,0';
    console.log(`Running arecord to verify device (${device})`);
    const res = spawnSync('arecord', ['-D', device, '-d', '3', '-f', 'cd', arecordFile], { stdio: 'inherit' });
    if (res.error){
      console.error(`Error running arecord: ${res.error}`);
    } else {
      try {
        const st = fs.statSync(arecordFile);
        console.log(`arecord produced file ${arecordFile} size ${st.size} bytes`);
      } catch (e){
        console.error(`arecord did not produce file: ${e}`);
      }
    }
  }
}

runTest().catch((err) => console.error(err));

runTest().catch((err) => console.error(err));
