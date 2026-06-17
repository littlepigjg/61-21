const crypto = require('crypto');

class SessionManager {
  constructor(userManager) {
    this.userManager = userManager;
    this.sessions = new Map();
    this.sessionTimeout = 24 * 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60 * 60 * 1000);
  }

  createSession(user) {
    const token = crypto.randomUUID();
    const session = {
      token,
      username: user.username,
      user,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTimeout,
      userVersion: this.userManager.getUserVersion()
    };
    this.sessions.set(token, session);
    return session;
  }

  getSession(token) {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    if (session.userVersion !== this.userManager.getUserVersion()) {
      const updatedUser = this.userManager.getUser(session.username);
      if (!updatedUser) {
        this.sessions.delete(token);
        return null;
      }
      session.user = updatedUser;
      session.userVersion = this.userManager.getUserVersion();
      session.needsReauth = true;
    }

    session.expiresAt = Date.now() + this.sessionTimeout;
    return session;
  }

  validateSession(token) {
    const session = this.getSession(token);
    if (!session) return { valid: false };
    if (session.needsReauth) {
      return { valid: false, needsReauth: true, message: '权限已变更，请重新登录' };
    }
    return { valid: true, session };
  }

  destroySession(token) {
    return this.sessions.delete(token);
  }

  destroyUserSessions(username) {
    let count = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.username === username) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }

  invalidateAllSessions() {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(token);
      }
    }
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).map(s => ({
      token: s.token.substring(0, 8) + '...',
      username: s.username,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt
    }));
  }

  shutdown() {
    clearInterval(this.cleanupInterval);
  }
}

module.exports = SessionManager;
