const fs = require('fs');
const path = require('path');

const LOG_TYPES = {
  AUTH: 'auth',
  USER: 'user',
  CHANNEL: 'channel',
  PLAYLIST: 'playlist',
  PLAYBACK: 'playback',
  SYSTEM: 'system'
};

class LogManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.logsFile = path.join(dataDir, 'system-logs.json');
    this.logs = [];
    this.maxLogs = 1000;
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.logsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.logsFile, 'utf8'));
        this.logs = data.logs || [];
      } catch (e) {
        console.error('Failed to load logs:', e);
        this.logs = [];
      }
    }
  }

  saveLogs() {
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    fs.writeFileSync(this.logsFile, JSON.stringify({ logs: this.logs }, null, 2));
  }

  log(type, action, details = {}, user = null) {
    const logEntry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      type,
      action,
      details,
      user: user ? { username: user.username, role: user.role, name: user.name } : null
    };

    this.logs.push(logEntry);
    this.saveLogs();

    const logStr = `[${new Date(logEntry.timestamp).toLocaleString()}] [${type}] ${action}` +
      (user ? ` - User: ${user.username}` : '') +
      (Object.keys(details).length > 0 ? ` - ${JSON.stringify(details)}` : '');
    console.log(logStr);
  }

  getLogs(filters = {}) {
    let result = [...this.logs];

    if (filters.type) {
      result = result.filter(l => l.type === filters.type);
    }
    if (filters.action) {
      result = result.filter(l => l.action === filters.action);
    }
    if (filters.username) {
      result = result.filter(l => l.user && l.user.username === filters.username);
    }
    if (filters.startTime) {
      result = result.filter(l => l.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      result = result.filter(l => l.timestamp <= filters.endTime);
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  clearLogs() {
    this.logs = [];
    this.saveLogs();
  }

  logAuth(action, username, success, details = {}) {
    this.log(LOG_TYPES.AUTH, action, { ...details, success }, { username, role: 'unknown', name: username });
  }

  logUser(action, user, details = {}) {
    this.log(LOG_TYPES.USER, action, details, user);
  }

  logChannel(action, user, channelId, details = {}) {
    this.log(LOG_TYPES.CHANNEL, action, { channelId, ...details }, user);
  }

  logPlaylist(action, user, channelId, details = {}) {
    this.log(LOG_TYPES.PLAYLIST, action, { channelId, ...details }, user);
  }

  logPlayback(action, user, channelId, details = {}) {
    this.log(LOG_TYPES.PLAYBACK, action, { channelId, ...details }, user);
  }

  logSystem(action, details = {}) {
    this.log(LOG_TYPES.SYSTEM, action, details);
  }
}

module.exports = { LogManager, LOG_TYPES };
