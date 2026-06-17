class DJPanel {
  constructor() {
    this.currentChannel = null;
    this.ws = null;
    this.playlist = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isAuthenticated = false;
    this.user = null;

    this.channelList = document.getElementById('channelList');
    this.djChannelName = document.getElementById('djChannelName');
    this.statusBadge = document.getElementById('statusBadge');
    this.nowPlaying = document.getElementById('nowPlaying');
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.channelVolume = document.getElementById('channelVolume');
    this.djListenerCount = document.getElementById('djListenerCount');
    this.playlistCount = document.getElementById('playlistCount');
    this.playlistEl = document.getElementById('playlist');
    this.userInfo = document.getElementById('userInfo');
    this.userName = document.getElementById('userName');
    this.userRoleBadge = document.getElementById('userRoleBadge');
    this.userAvatar = document.getElementById('userAvatar');
    this.logoutBtn = document.getElementById('logoutBtn');
    this.loginRequired = document.getElementById('loginRequired');
    this.mainContent = document.getElementById('mainContent');
    this.navAdmin = document.getElementById('navAdmin');
    this.navChannelMgr = document.getElementById('navChannelMgr');

    this.init();
  }

  async init() {
    if (!await this.checkAuth()) {
      this.showLoginRequired();
      return;
    }

    this.showMainContent();
    this.setupUserInfo();
    this.setupNavigation();
    await this.loadChannels();
    this.bindEvents();
  }

  async checkAuth() {
    const token = localStorage.getItem('auth_token');
    const storedUser = API.getCurrentUser();

    if (!token || !storedUser) {
      return false;
    }

    try {
      const result = await API.auth.me();
      this.user = result.user;
      this.isAuthenticated = true;
      return true;
    } catch (e) {
      API.clearAuth();
      return false;
    }
  }

  showLoginRequired() {
    this.loginRequired.style.display = 'block';
    this.mainContent.style.display = 'none';
    this.userInfo.style.display = 'none';
  }

  showMainContent() {
    this.loginRequired.style.display = 'none';
    this.mainContent.style.display = 'flex';
    this.userInfo.style.display = 'flex';
  }

  setupUserInfo() {
    if (!this.user) return;

    this.userName.textContent = this.user.name || this.user.username;
    this.userRoleBadge.textContent = API.getRoleName(this.user.role);
    this.userRoleBadge.className = `role-badge role-${this.user.role}`;
    this.userAvatar.textContent = (this.user.name || this.user.username).charAt(0).toUpperCase();
  }

  setupNavigation() {
    if (this.user.role === 'super_admin') {
      this.navAdmin.style.display = 'inline-block';
      this.navChannelMgr.style.display = 'inline-block';
    } else if (this.user.role === 'channel_admin') {
      this.navChannelMgr.style.display = 'inline-block';
    }
  }

  async loadChannels() {
    try {
      const channels = await API.channels.list();
      this.renderChannels(channels);
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  }

  renderChannels(channels) {
    let filteredChannels = channels;
    if (this.user.role === 'channel_admin' && this.user.managedChannels) {
      filteredChannels = channels.filter(ch => this.user.managedChannels.includes(ch.id));
    }

    this.channelList.innerHTML = filteredChannels.map(ch => `
      <div class="channel-item ${this.currentChannel === ch.id ? 'active' : ''}" data-id="${ch.id}">
        <h3><span class="channel-status ${ch.isPlaying ? 'playing' : ''}"></span>${ch.name}</h3>
        <p>${ch.description}</p>
        <div class="channel-meta">
          <span>👥 ${ch.listeners} 人在线</span>
          <span>${ch.isPlaying ? '播放中' : '已停止'}</span>
        </div>
      </div>
    `).join('');

    this.channelList.querySelectorAll('.channel-item').forEach(item => {
      item.addEventListener('click', () => {
        const channelId = item.dataset.id;
        if (this.user.role === 'channel_admin' && !API.canManageChannel(channelId)) {
          alert('您无权管理该频道');
          return;
        }
        this.selectChannel(channelId);
      });
    });
  }

  selectChannel(channelId) {
    if (this.currentChannel === channelId) return;

    if (this.ws) {
      this.ws.close();
    }

    this.currentChannel = channelId;
    this.connectWebSocket(channelId);
    this.loadPlaylist(channelId);
    this.loadChannels();
  }

  connectWebSocket(channelId) {
    const token = localStorage.getItem('auth_token');
    this.ws = new WebSocket(CONFIG.WS_URL);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        action: 'authenticate',
        token: token
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };

    this.ws.onclose = () => {
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'authSuccess':
        this.ws.send(JSON.stringify({
          action: 'join',
          channelId: this.currentChannel
        }));
        break;
      case 'authError':
        alert(data.error || '认证失败，请重新登录');
        API.clearAuth();
        window.location.href = 'login.html';
        break;
      case 'error':
        alert(data.error);
        break;
      case 'status':
        this.handleStatus(data);
        break;
      case 'trackChange':
        this.handleTrackChange(data);
        break;
      case 'statusChange':
        this.handleStatusChange(data);
        break;
      case 'listenersChange':
        this.handleListenersChange(data);
        break;
      case 'volumeChange':
        this.handleVolumeChange(data);
        break;
      case 'playlistUpdated':
        this.loadPlaylist(data.channelId);
        break;
    }
  }

  handleStatus(data) {
    this.djChannelName.textContent = data.name;
    this.isPlaying = data.isPlaying;
    this.currentIndex = data.currentIndex || -1;

    if (data.currentTrack) {
      this.nowPlaying.textContent = data.currentTrack.title;
    } else {
      this.nowPlaying.textContent = '--';
    }

    this.djListenerCount.textContent = data.listeners;

    if (data.playlist) {
      this.playlist = data.playlist;
      this.playlistCount.textContent = data.playlist.length;
      this.renderPlaylist();
    }

    this.updatePlayPauseButton();
    this.updateStatusBadge();
    this.channelVolume.value = Math.round((data.volume || 1) * 100);
  }

  handleTrackChange(data) {
    if (data.track) {
      this.nowPlaying.textContent = data.track.title;
      const idx = this.playlist.findIndex(t => t.filename === data.track.filename);
      if (idx >= 0) {
        this.currentIndex = idx;
      }
    }
    this.isPlaying = data.isPlaying;
    this.updatePlayPauseButton();
    this.updateStatusBadge();
    this.renderPlaylist();
  }

  handleStatusChange(data) {
    this.isPlaying = data.isPlaying;
    this.updatePlayPauseButton();
    this.updateStatusBadge();
  }

  handleListenersChange(data) {
    this.djListenerCount.textContent = data.listeners;
    this.loadChannels();
  }

  handleVolumeChange(data) {
    this.channelVolume.value = Math.round(data.volume * 100);
  }

  updatePlayPauseButton() {
    if (this.isPlaying) {
      this.playPauseBtn.textContent = '⏸';
    } else {
      this.playPauseBtn.textContent = '▶';
    }
  }

  updateStatusBadge() {
    this.statusBadge.classList.remove('playing', 'paused', 'stopped');
    if (this.isPlaying) {
      this.statusBadge.textContent = '播放中';
      this.statusBadge.classList.add('playing');
    } else if (this.currentIndex >= 0) {
      this.statusBadge.textContent = '已暂停';
      this.statusBadge.classList.add('paused');
    } else {
      this.statusBadge.textContent = '已停止';
      this.statusBadge.classList.add('stopped');
    }
  }

  async loadPlaylist(channelId) {
    try {
      const playlist = await API.channels.getPlaylist(channelId);
      this.playlist = playlist;
      this.playlistCount.textContent = playlist.length;
      this.renderPlaylist();
    } catch (err) {
      console.error('Failed to load playlist:', err);
    }
  }

  renderPlaylist() {
    if (this.playlist.length === 0) {
      this.playlistEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">播放列表为空</div>';
      return;
    }

    this.playlistEl.innerHTML = this.playlist.map(track => `
      <div class="playlist-item ${track.index === this.currentIndex ? 'current' : ''}" data-index="${track.index}">
        <span class="track-index">${track.index === this.currentIndex ? '♪' : track.index + 1}</span>
        <span class="track-title">${track.title}</span>
      </div>
    `).join('');

    this.playlistEl.querySelectorAll('.playlist-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        this.playTrack(index);
      });
    });
  }

  sendControl(command, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      action: 'control',
      channelId: this.currentChannel,
      command: command,
      params: params
    }));
  }

  playTrack(index) {
    this.sendControl('play', { index });
    this.currentIndex = index;
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.sendControl('pause');
    } else {
      if (this.currentIndex >= 0) {
        this.sendControl('resume');
      } else {
        this.sendControl('play');
      }
    }
  }

  nextTrack() {
    this.sendControl('next');
  }

  prevTrack() {
    this.sendControl('prev');
  }

  setVolume(value) {
    this.sendControl('volume', { volume: value / 100 });
  }

  async logout() {
    try {
      await API.auth.logout();
    } catch (e) {
      console.error('Logout error:', e);
    }
    API.clearAuth();
    if (this.ws) {
      this.ws.close();
    }
    window.location.href = 'login.html';
  }

  bindEvents() {
    this.playPauseBtn.addEventListener('click', () => {
      if (!this.currentChannel) return;
      this.togglePlayPause();
    });

    this.nextBtn.addEventListener('click', () => {
      if (!this.currentChannel) return;
      this.nextTrack();
    });

    this.prevBtn.addEventListener('click', () => {
      if (!this.currentChannel) return;
      this.prevTrack();
    });

    this.channelVolume.addEventListener('input', (e) => {
      if (!this.currentChannel) return;
      this.setVolume(parseInt(e.target.value));
    });

    this.logoutBtn.addEventListener('click', () => {
      if (confirm('确定要退出登录吗？')) {
        this.logout();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DJPanel();
});
