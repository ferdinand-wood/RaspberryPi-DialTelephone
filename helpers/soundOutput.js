var player = require('play-sound')(opts = {})
const { getAudioDurationInSeconds } = require('get-audio-duration');
const { execSync } = require('child_process');


class SoundOutput {
    constructor(owner) {
      this.playing = false;
      this.audio = null;
    }

    /**
     * Set the headset volume using amixer
     * @param {number} percentage - Volume percentage (0-100)
     * @param {string} control - ALSA control name (default: 'Headset')
     * @returns {boolean} - true if successful, false otherwise
     */
    setVolume(percentage, control = 'Headset') {
      try {
        if (percentage < 0 || percentage > 100) {
          console.error(`Invalid volume percentage: ${percentage}. Must be between 0 and 100.`);
          return false;
        }
        const command = `amixer set ${control} ${percentage}%`;
        execSync(command, { stdio: 'ignore' });
        console.log(`Volume set to ${percentage}% on ${control}`);
        return true;
      } catch (err) {
        console.error(`Failed to set volume: ${err.message}`);
        return false;
      }
    }

    /**
     * Get the current volume level
     * @param {string} control - ALSA control name (default: 'Headset')
     * @returns {number|null} - Current volume percentage or null if failed
     */
    getVolume(control = 'Headset') {
      try {
        const output = execSync(`amixer get ${control}`, { encoding: 'utf8' });
        const match = output.match(/\[(\d+)%\]/);
        if (match) {
          const volume = parseInt(match[1]);
          console.log(`Current ${control} volume: ${volume}%`);
          return volume;
        }
        return null;
      } catch (err) {
        console.error(`Failed to get volume: ${err.message}`);
        return null;
      }
    }

    async getDuration(filename) {
      const durationInSeconds = await getAudioDurationInSeconds(filename);
      return Math.round(durationInSeconds * 1000);
    }

    playFile(filename){
        if(!this.playing){
            this.playing = true;
            console.log(`Playing file: ${filename}`);
            this.audio = player.play(filename, {aplay:[]},(err)=>{console.log(`Play failed:${err}`)});
        }
    }

    stopPlayback(){
      if(this.playing){
        this.audio.kill();
        this.audio=null;
        this.playing=false;
      }
    }
}

module.exports = SoundOutput;