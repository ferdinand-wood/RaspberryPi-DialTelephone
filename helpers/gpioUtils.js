const fs = require('fs');

function bcmToGlobal(bcm) {
  try {
    const entries = fs.readdirSync('/sys/class/gpio').filter(n => n.startsWith('gpiochip'));
    if (!entries.length) return null;

    // Prefer chips with pinctrl/bcm/raspberrypi in the label
    for (const chip of entries) {
      try {
        const label = fs.readFileSync(`/sys/class/gpio/${chip}/label`, 'utf8').trim();
        const base = parseInt(fs.readFileSync(`/sys/class/gpio/${chip}/base`, 'utf8'), 10);
        const ngpio = parseInt(fs.readFileSync(`/sys/class/gpio/${chip}/ngpio`, 'utf8'), 10);
        if (/pinctrl|bcm|raspberrypi/i.test(label)) {
          if (bcm >= 0 && bcm < ngpio) return base + bcm;
        }
      } catch (e) {
        // ignore this chip if reads fail
      }
    }

    // Fallback: use first chip
    const chip = entries[0];
    const base = parseInt(fs.readFileSync(`/sys/class/gpio/${chip}/base`, 'utf8'), 10);
    return base + bcm;
  } catch (err) {
    return null;
  }
}

module.exports = { bcmToGlobal };