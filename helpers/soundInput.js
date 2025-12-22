const fs = require('fs');
const mic = require('mic');

class SoundInput {

    startRecording(filename, opts = {}){

      if(this.mic){
        console.log("already recording");
        return;
      }

      console.log(`Recording to ${filename}`);

      const path = require('path');
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
      }

      // Allow selecting device via options or environment
      const device = opts.device || process.env.SOUND_DEVICE;
      const micConfig = {
        rate: '48000',
        channels: '1',
        debug: false,
        exitOnSilence: 6
      };
      if (device) {
        micConfig.device = device;
        console.log(`Using sound device: ${device}`);
      }

      this.mic = mic(micConfig);

      this.micInputStream = this.mic.getAudioStream();

      // Track bytes received from the mic
      this.bytesWritten = 0;
      this._dataEventCount = 0;

      this.micInputStream.on('data', (chunk) => {
        try {
          this.bytesWritten += chunk.length;
          this._dataEventCount += 1;
          // Log first few events quickly then periodically
          if (this._dataEventCount <= 10 || this._dataEventCount % 100 === 0) {
            console.log(`Mic data events: ${this._dataEventCount}, bytes written so far: ${this.bytesWritten}`);
          }
        } catch (err) {
          console.error(`Error processing data chunk: ${err}`);
        }
      });

      // Warn if no data arrives within a short time (useful for debugging device issues)
      if (this._noDataTimer) clearTimeout(this._noDataTimer);
      this._noDataTimer = setTimeout(() => {
        if ((this.bytesWritten || 0) === 0) {
          console.warn('No audio data received from mic stream yet. If your device does not appear, try setting SOUND_DEVICE environment variable (e.g. SOUND_DEVICE=plughw:3,0) to select a specific hardware device.');
        }
      }, 1200);

      this.micInputStream.on('startComplete', () => {
        console.log('Mic start complete');
      });
      this.micInputStream.on('stopComplete', () => {
        console.log('Mic stop complete');
      });
      this.micInputStream.on('processExitComplete', (code) => {
        console.log(`Mic process exit complete with code ${code}`);
      });

      this.outputFileStream = fs.createWriteStream(filename);
      this.outputFileStream.on('error', (err) => {
        console.error(`Output file stream error: ${err}`);
      });
      this.outputFileStream.on('finish', () => {
        try {
          const stats = fs.statSync(filename);
          console.log(`Finished writing ${filename} (${stats.size} bytes)`);
        } catch (err) {
          console.log(`Finished writing ${filename}`);
        }
      });

      this.micInputStream.on('error', (err) => {
        console.error(`Mic input stream error: ${err}`);
      });

      this.micInputStream.pipe(this.outputFileStream);
      this.filename = filename;
      this.recordingLength = null;
      this.recordingStartDate = new Date();
      this.mic.start();
    }

    stopRecording(){

      if(!this.mic){
        console.log("***** Stop recording called before start recording");
        return;
      }

      let currentDate = new Date();

      this.recordingLengthInMillis = currentDate - this.recordingStartDate;

      console.log(`Recording to ${this.filename} complete ${this.recordingLengthInMillis} milliseconds long`);
      console.log(`Total bytes captured from mic (so far): ${this.bytesWritten ?? 0}`);

      // Stop the mic input
      try { this.mic.stop(); } catch (err) { console.error(`Error stopping mic: ${err}`); }

      // Cancel the no-data timer
      if (this._noDataTimer) { clearTimeout(this._noDataTimer); this._noDataTimer = null; }

      // Unpipe the mic stream from the output and ensure the file stream is ended so data is flushed
      try {
        if (this.micInputStream && this.outputFileStream){
          this.micInputStream.unpipe(this.outputFileStream);
        }
      } catch (err){ console.error(`Error unpiping streams: ${err}`); }

      try {
        if (this.outputFileStream){
          this.outputFileStream.end();
        }
      } catch (err) { console.error(`Error ending output stream: ${err}`); }

      // Destroy mic input stream and clear references
      try { if (this.micInputStream) this.micInputStream.destroy(); } catch (err) {}
      this.micInputStream = null;
      this.mic = null;

      // After a short delay print final file size if available
      setTimeout(() => {
        try {
          if (this.filename && fs.existsSync(this.filename)){
            const stats = fs.statSync(this.filename);
            console.log(`Final file size for ${this.filename}: ${stats.size} bytes`);
          }
        } catch (err) {
          // ignore
        }
      }, 250);

      this.outputFileStream = null;
      this.filename = null;
    }

    getRecordingLengthInMillis(){
      return this.recordingLengthInMillis;
    }

    getBytesWritten(){
      return this.bytesWritten || 0;
    }

    constructor(owner) {
      this.mic = null;
      this.micInputStream = null;
      this.outputFileStream = null;
      this.filename = null;
      this.recordingLengthInMillis = null;
      this.recordingStartDate = null;
      this.bytesWritten = 0;
      this._dataEventCount = 0;
    }
}

module.exports = SoundInput;