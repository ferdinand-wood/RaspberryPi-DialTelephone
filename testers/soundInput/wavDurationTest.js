const fs = require('fs');

function getWavDurationMs(filePath){
  const HEADER_READ = 64 * 1024; // 64KB
  const fd = fs.openSync(filePath, 'r');
  try{
    const buf = Buffer.alloc(HEADER_READ);
    const bytes = fs.readSync(fd, buf, 0, HEADER_READ, 0);
    if (bytes < 44) throw new Error('WAV file too small');

    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE'){
      throw new Error('Not a WAV file');
    }

    let offset = 12;
    let sampleRate = null;
    let numChannels = null;
    let bitsPerSample = null;
    let dataSize = null;

    while (offset + 8 <= bytes){
      const chunkId = buf.toString('ascii', offset, offset+4);
      const chunkSize = buf.readUInt32LE(offset+4);
      offset += 8;
      if (chunkId === 'fmt '){
        if (offset + 16 <= bytes){
          numChannels = buf.readUInt16LE(offset + 2);
          sampleRate = buf.readUInt32LE(offset + 4);
          bitsPerSample = buf.readUInt16LE(offset + 14);
        }
      } else if (chunkId === 'data'){
        dataSize = chunkSize;
        break;
      }
      offset += chunkSize;
    }

    if (sampleRate && dataSize && numChannels && bitsPerSample){
      const bytesPerSample = bitsPerSample / 8;
      const totalSamples = dataSize / (numChannels * bytesPerSample);
      const durMs = Math.ceil((totalSamples / sampleRate) * 1000);
      return durMs;
    }

    throw new Error('Could not parse WAV header');
  } finally {
    fs.closeSync(fd);
  }
}

(async function main(){
  const filePath = process.argv[2] || './sounds/mailbox_intro.wav';
  console.log(`Probing WAV file: ${filePath}`);
  try{
    if (!fs.existsSync(filePath)){
      console.error('File not found');
      process.exit(2);
    }
    const dur = getWavDurationMs(filePath);
    console.log(`Computed duration: ${dur} ms`);
    process.exit(0);
  } catch (err){
    console.error(`Error: ${err}`);
    process.exit(1);
  }
})();
