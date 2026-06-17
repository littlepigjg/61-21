const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  CHANNEL_ADMIN: 'channel_admin',
  DJ: 'dj'
};

const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    'channels:create',
    'channels:delete',
    'channels:edit_all',
    'channels:playlist_all',
    'channels:blacklist_all',
    'channels:control_all',
    'users:manage',
    'logs:view',
    'system:config'
  ],
  [ROLES.CHANNEL_ADMIN]: [
    'channels:edit_own',
    'channels:playlist_own',
    'channels:blacklist_own',
    'channels:control_own'
  ],
  [ROLES.DJ]: [
    'channels:control_all'
  ]
};

class UserManager {
  constructor(config, dataDir) {
    this.config = config;
    this.dataDir = dataDir;
    this.usersFile = path.join(dataDir, 'users.json');
    this.users = new Map();
    this.userVersion = 0;
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.usersFile)) {
      this.loadUsers();
    } else {
      this.createDefaultUsers();
    }
  }

  loadUsers() {
    try {
      const data = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      this.users.clear();
      for (const user of data.users) {
        this.users.set(user.username, user);
      }
      this.userVersion = data.version || Date.now();
    } catch (e) {
      console.error('Failed to load users:', e);
      this.createDefaultUsers();
    }
  }

  saveUsers() {
    this.userVersion = Date.now();
    const data = {
      version: this.userVersion,
      users: Array.from(this.users.values())
    };
    fs.writeFileSync(this.usersFile, JSON.stringify(data, null, 2));
  }

  createDefaultUsers() {
    const defaultUsers = this.config.defaultUsers || [
      {
        username: 'admin',
        password: 'admin123',
        role: ROLES.SUPER_ADMIN,
        name: '超级管理员'
      }
    ];

    for (const user of defaultUsers) {
      this.createUser(user.username, user.password, user.role, user.name);
    }
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  verifyPassword(password, hash) {
    return this.hashPassword(password) === hash;
  }

  createUser(username, password, role, name) {
    if (!Object.values(ROLES).includes(role)) {
      throw new Error('Invalid role');
    }
    if (this.users.has(username)) {
      throw new Error('User already exists');
    }

    const user = {
      username,
      passwordHash: this.hashPassword(password),
      role,
      name: name || username,
      createdAt: Date.now(),
      managedChannels: role === ROLES.CHANNEL_ADMIN ? [] : undefined
    };

    this.users.set(username, user);
    this.saveUsers();
    return this.sanitizeUser(user);
  }

  updateUser(username, updates) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error('User not found');
    }

    if (updates.password) {
      user.passwordHash = this.hashPassword(updates.password);
    }
    if (updates.role && Object.values(ROLES).includes(updates.role)) {
      user.role = updates.role;
      if (updates.role === ROLES.CHANNEL_ADMIN) {
        user.managedChannels = user.managedChannels || [];
      } else {
        delete user.managedChannels;
      }
    }
    if (updates.name) {
      user.name = updates.name;
    }
    if (updates.managedChannels !== undefined && user.role === ROLES.CHANNEL_ADMIN) {
      user.managedChannels = updates.managedChannels;
    }

    this.saveUsers();
    return this.sanitizeUser(user);
  }

  deleteUser(username) {
    if (!this.users.has(username)) {
      throw new Error('User not found');
    }
    this.users.delete(username);
    this.saveUsers();
  }

  getUser(username) {
    const user = this.users.get(username);
    return user ? this.sanitizeUser(user) : null;
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(u => this.sanitizeUser(u));
  }

  authenticate(username, password) {
    const user = this.users.get(username);
    if (!user) return null;
    if (!this.verifyPassword(password, user.passwordHash)) return null;
    return this.sanitizeUser(user);
  }

  sanitizeUser(user) {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }

  getPermissions(role) {
    return PERMISSIONS[role] || [];
  }

  hasPermission(username, permission) {
    const user = this.users.get(username);
    if (!user) return false;
    const permissions = this.getPermissions(user.role);
    return permissions.includes(permission);
  }

  canManageChannel(username, channelId) {
    const user = this.users.get(username);
    if (!user) return false;

    if (user.role === ROLES.SUPER_ADMIN) return true;
    if (user.role === ROLES.CHANNEL_ADMIN) {
      return user.managedChannels && user.managedChannels.includes(channelId);
    }
    if (user.role === ROLES.DJ) return true;

    return false;
  }

  getUserVersion() {
    return this.userVersion;
  }
}

module.exports = {
  UserManager,
  ROLES,
  PERMISSIONS
};
