const onoff = require('onoff'); //include onoff to interact with the GPIO
const { bcmToGlobal } = require('./gpioUtils');

class InGPIO {
  /**
   * @param {number} GPIONumber
   * @param {function} callback
   */
  constructor(GPIONumber, callback) {
    this.GPIONumber = GPIONumber;
    this.callback = callback;
    this.available = false;
    this.oldValue = 0;
    this.init();
  }

  async delay(timeInMs) {
    return new Promise(async (kept, broken) => {
      setTimeout(async () => {
        return kept("tick");
      }, timeInMs);
    });
  }

  async test() {
    if (onoff.Gpio.accessible) {
      console.log(`Test starting`);
      let count = 0;
      this.gpio = new onoff.Gpio(this.GPIONumber, 'in', 'both', { debounceTimeout: 5 });
      while (true) {
        await this.delay(500);
        console.log(`Value:${this.gpio.readSync()} ${count}`);
        count++;
      }
    }
  }

  init() {
    console.log(`Initialising input GPIO ${this.GPIONumber}`);
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
        this.gpio = new onoff.Gpio(pin, 'in', 'both', { debounceTimeout: 5 });
        this.oldValue = this.gpio.readSync();
        this.available = true;
        // Watch the input for changes
        this.gpio.watch((error, value) => {
          if (error) {
            console.log(`GPIO ${this.GPIONumber} error ${error}`);
          } else {
            if (this.oldValue !== value) {
              // send the result to the callback
              this.callback(value);
            }
            this.oldValue = value;
          }
        });
      } else {
        console.log("GPIO not accessible");
        this.available = false;
      }
    } catch (err) {
      console.error(`Failed to init input GPIO ${this.GPIONumber}: ${err.message}`);
      this.available = false;
    }
  }

  getValue() {
    return this.oldValue;
  }
}

module.exports = InGPIO;