const fs = require('fs');

function createConfigStore(configPath) {
  function readConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to read config', e);
    }
    return {};
  }

  function writeConfig(cfg) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.warn('Failed to write config', e);
      return false;
    }
  }

  return {
    readConfig,
    writeConfig,
  };
}

module.exports = {
  createConfigStore,
};
