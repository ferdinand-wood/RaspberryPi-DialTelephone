const onoff = require('onoff'); //include onoff to interact with the GPIO
const { bcmToGlobal } = require('./gpioUtils');

class OutGPIO {
  constructor(GPIONumber) {
    this.GPIONumber = GPIONumber;
    this.available = false;
    this.gpio = null;
  }

  init() {
    try {
      let pin = this.GPIONumber;
      if (typeof pin === 'number' && pin >= 0 && pin < 100) {
        const mapped = bcmToGlobal(pin);
        if (mapped !== null) {
          console.log(`Mapping BCM ${pin} -> global ${mapped}`);
          pin = mapped;
        } else {
          console.log(`Could not map BCM ${pin}; continuing with ${pin}`);
        }
      }

      if (onoff.Gpio.accessible) {
        this.gpio = new onoff.Gpio(pin, 'out');
        this.available = true;
      } else {
        console.log('GPIO not accessible');
        this.available = false;
      }
    } catch (err) {
      console.error(`Failed to init GPIO ${this.GPIONumber}: ${err.message}`);
      this.gpio = null;
      this.available = false;
    }
  }

  on() {
    if (this.available && this.gpio) {
      try {
        this.gpio.writeSync(1);
      } catch (err) {
        console.error(`GPIO write error: ${err.message}`);
      }
    } else {
      console.log(`GPIO ${this.GPIONumber} on() skipped (not available)`);
    }
  }

  pulse() {
    this.on();
    setTimeout(() => { this.off(); }, 1000);
  }

  off() {
    if (this.available && this.gpio) {
      try {
        this.gpio.writeSync(0);
      } catch (err) {
        console.error(`GPIO write error: ${err.message}`);
      }
    } else {
      console.log(`GPIO ${this.GPIONumber} off() skipped (not available)`);
    }
  }
}

module.exports = OutGPIO;