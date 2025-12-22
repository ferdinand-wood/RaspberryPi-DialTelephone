/**
 * Simple config persistence helper.
 * Stores configuration in a JSON file next to the project root and
 * exposes get/set/save helpers for runtime use.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.resolve(__dirname, '..', 'config.json');

/**
 * Load configuration from disk.
 * Reads the JSON config file and parses it.
 * Any read/parse error is caught and an empty object is returned.
 *
 * @returns {Object} The parsed configuration object, or an empty object on error.
 */
function load(){
  try{
    if (fs.existsSync(CONFIG_FILE)){
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err){
    console.warn(`Failed to load config: ${err}`);
  }
  return {};
}

let cfg = load();

module.exports = {
  /**
   * Get a configuration value by key.
   * @param {string} key - The configuration key to read.
   * @returns {any} The value, or undefined if not set.
   */
  get(key){ return cfg[key]; },

  /**
   * Set a configuration value in memory. Call save() to persist.
   * @param {string} key - The configuration key to set.
   * @param {any} value - The value to set for the key.
   */
  set(key, value){ cfg[key] = value; },

  /**
   * Persist the in-memory configuration to disk.
   * Errors during write are logged to the console.
   */
  save(){
    try{
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (err){
      console.error(`Failed to save config: ${err}`);
    }
  },

  /**
   * Return a shallow copy of the current config object.
   * @returns {Object}
   */
  all(){ return Object.assign({}, cfg); }
};
