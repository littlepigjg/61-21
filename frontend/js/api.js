const API = {
  BASE: window.location.origin,

  async request(path, options = {}) {
    const url = `${this.BASE}${path}`;
    const token = localStorage.getItem('auth_token');
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      if (data.needsReauth) {
        alert('权限已变更，请重新登录');
      }
      localStorage.removeItem('auth_token');
      localStorage.removeItem('current_user');
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
      throw new Error(data.error || '未授权');
    }

    if (!response.ok) {
      throw new Error(data.error || `请求失败: ${response.status}`);
    }

    return data;
  },

  get(path) {
    return this.request(path, { method: 'GET' });
  },

  post(path, body) {
    return this.request(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
  },

  put(path, body) {
    return this.request(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    });
  },

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  },

  auth: {
    login(username, password) {
      return API.post('/api/auth/login', { username, password });
    },

    logout() {
      return API.post('/api/auth/logout');
    },

    me() {
      return API.get('/api/auth/me');
    }
  },

  users: {
    list() {
      return API.get('/api/users');
    },

    create(user) {
      return API.post('/api/users', user);
    },

    update(username, updates) {
      return API.put(`/api/users/${username}`, updates);
    },

    delete(username) {
      return API.delete(`/api/users/${username}`);
    }
  },

  channels: {
    list() {
      return API.get('/api/channels');
    },

    listAdmin() {
      return API.get('/api/channels/admin');
    },

    get(channelId) {
      return API.get(`/api/channels/${channelId}`);
    },

    create(channel) {
      return API.post('/api/channels', channel);
    },

    update(channelId, updates) {
      return API.put(`/api/channels/${channelId}`, updates);
    },

    delete(channelId) {
      return API.delete(`/api/channels/${channelId}`);
    },

    getPlaylist(channelId) {
      return API.get(`/api/channels/${channelId}/playlist`);
    },

    getFiles(channelId) {
      return API.get(`/api/channels/${channelId}/files`);
    },

    reorderPlaylist(channelId, order) {
      return API.post(`/api/channels/${channelId}/playlist/reorder`, { order });
    },

    removeFromPlaylist(channelId, filename) {
      return API.delete(`/api/channels/${channelId}/playlist/${encodeURIComponent(filename)}`);
    },

    getBlacklist(channelId) {
      return API.get(`/api/channels/${channelId}/blacklist`);
    },

    addToBlacklist(channelId, filename) {
      return API.post(`/api/channels/${channelId}/blacklist`, { filename });
    },

    removeFromBlacklist(channelId, filename) {
      return API.delete(`/api/channels/${channelId}/blacklist/${encodeURIComponent(filename)}`);
    },

    play(channelId, index) {
      return API.post(`/api/channels/${channelId}/play`, { index });
    },

    pause(channelId) {
      return API.post(`/api/channels/${channelId}/pause`);
    },

    resume(channelId) {
      return API.post(`/api/channels/${channelId}/resume`);
    },

    next(channelId) {
      return API.post(`/api/channels/${channelId}/next`);
    },

    prev(channelId) {
      return API.post(`/api/channels/${channelId}/prev`);
    },

    setVolume(channelId, volume) {
      return API.post(`/api/channels/${channelId}/volume`, { volume });
    }
  },

  logs: {
    list(filters = {}) {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          params.append(k, v);
        }
      });
      const query = params.toString() ? `?${params.toString()}` : '';
      return API.get(`/api/logs${query}`);
    },

    clear() {
      return API.delete('/api/logs');
    }
  },

  sessions: {
    list() {
      return API.get('/api/sessions');
    }
  },

  getCurrentUser() {
    try {
      const userStr = localStorage.getItem('current_user');
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser(user, token) {
    localStorage.setItem('current_user', JSON.stringify(user));
    if (token) {
      localStorage.setItem('auth_token', token);
    }
  },

  clearAuth() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('current_user');
  },

  hasPermission(permission) {
    const user = this.getCurrentUser();
    if (!user) return false;
    const permissions = {
      super_admin: [
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
      channel_admin: [
        'channels:edit_own',
        'channels:playlist_own',
        'channels:blacklist_own',
        'channels:control_own'
      ],
      dj: [
        'channels:control_all'
      ]
    };
    const userPermissions = permissions[user.role] || [];
    return userPermissions.includes(permission);
  },

  canManageChannel(channelId) {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'dj') return true;
    if (user.role === 'channel_admin') {
      return user.managedChannels && user.managedChannels.includes(channelId);
    }
    return false;
  },

  getRoleName(role) {
    const names = {
      super_admin: '超级管理员',
      channel_admin: '频道管理员',
      dj: '普通DJ'
    };
    return names[role] || role;
  }
};
