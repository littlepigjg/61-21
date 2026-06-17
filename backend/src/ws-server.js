const WebSocket = require('ws');
const { ROLES } = require('./user-manager');

class WebSocketServer {
  constructor(port, channelManager, ffmpegAvailable = false, userManager = null, sessionManager = null) {
    this.port = port;
    this.channelManager = channelManager;
    this.ffmpegAvailable = ffmpegAvailable;
    this.userManager = userManager;
    this.sessionManager = sessionManager;
    this.wss = null;
    this.clients = new Map();
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      let clientChannel = null;
      let clientUser = null;
      let isAuthenticated = false;

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);

          if (data.action === 'authenticate') {
            const result = this.handleAuthenticate(ws, data.token);
            if (result.valid) {
              clientUser = result.user;
              isAuthenticated = true;
              ws._user = clientUser;
              ws.send(JSON.stringify({
                type: 'authSuccess',
                user: clientUser
              }));
            } else {
              ws.send(JSON.stringify({
                type: 'authError',
                error: result.error
              }));
              ws.close();
            }
            return;
          }

          switch (data.action) {
            case 'join':
              clientChannel = data.channelId;
              ws._channelId = clientChannel;
              this.sendChannelStatus(ws, clientChannel);
              break;

            case 'leave':
              clientChannel = null;
              ws._channelId = null;
              break;

            case 'control':
              if (!isAuthenticated) {
                ws.send(JSON.stringify({
                  type: 'error',
                  error: '未授权，请先登录'
                }));
                return;
              }
              if (!this.canControlChannel(clientUser, data.channelId)) {
                ws.send(JSON.stringify({
                  type: 'error',
                  error: '无权管理该频道'
                }));
                return;
              }
              this.handleControl(ws, data, clientUser);
              break;

            case 'getStatus':
              this.sendChannelStatus(ws, data.channelId || clientChannel);
              break;
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      });

      ws.on('close', () => {
      });
    });

    this.channelManager.on('play', (channelId, track) => {
      this.broadcastToChannel(channelId, {
        type: 'trackChange',
        channelId,
        track: { title: track.title, filename: track.filename },
        isPlaying: true
      });
    });

    this.channelManager.on('pause', (channelId) => {
      this.broadcastToChannel(channelId, {
        type: 'statusChange',
        channelId,
        isPlaying: false
      });
    });

    this.channelManager.on('resume', (channelId) => {
      this.broadcastToChannel(channelId, {
        type: 'statusChange',
        channelId,
        isPlaying: true
      });
    });

    this.channelManager.on('volume', (channelId, volume) => {
      this.broadcastToChannel(channelId, {
        type: 'volumeChange',
        channelId,
        volume
      });
    });

    this.channelManager.on('listeners', (channelId, listeners) => {
      this.broadcastToChannel(channelId, {
        type: 'listenersChange',
        channelId,
        listeners
      });
    });

    this.channelManager.on('channelCreated', (channelId) => {
      this.broadcastAll({
        type: 'channelCreated',
        channelId
      });
    });

    this.channelManager.on('channelUpdated', (channelId) => {
      this.broadcastAll({
        type: 'channelUpdated',
        channelId
      });
    });

    this.channelManager.on('channelDeleted', (channelId) => {
      this.broadcastAll({
        type: 'channelDeleted',
        channelId
      });
    });

    this.channelManager.on('playlistUpdated', (channelId) => {
      this.broadcastToChannel(channelId, {
        type: 'playlistUpdated',
        channelId
      });
    });

    this.channelManager.on('blacklistUpdated', (channelId) => {
      this.broadcastToChannel(channelId, {
        type: 'blacklistUpdated',
        channelId
      });
    });

    console.log(`WebSocket server running on port ${this.port}`);
  }

  handleAuthenticate(ws, token) {
    if (!this.sessionManager || !this.userManager) {
      return { valid: false, error: '认证服务未就绪' };
    }

    const validation = this.sessionManager.validateSession(token);
    if (!validation.valid) {
      if (validation.needsReauth) {
        return { valid: false, error: validation.message, needsReauth: true };
      }
      return { valid: false, error: '登录已过期，请重新登录' };
    }

    return { valid: true, user: validation.session.user };
  }

  canControlChannel(user, channelId) {
    if (!this.userManager) return true;
    return this.userManager.canManageChannel(user.username, channelId);
  }

  handleControl(ws, data, user) {
    const { channelId, command, params } = data;

    if (user.role === ROLES.DJ) {
      if (!['play', 'pause', 'resume', 'next', 'prev', 'volume'].includes(command)) {
        ws.send(JSON.stringify({
          type: 'error',
          error: '普通DJ仅可控制播放'
        }));
        return;
      }
    }

    switch (command) {
      case 'play':
        this.channelManager.play(channelId, params?.index);
        break;
      case 'pause':
        this.channelManager.pause(channelId);
        break;
      case 'resume':
        this.channelManager.resume(channelId);
        break;
      case 'next':
        this.channelManager.next(channelId);
        break;
      case 'prev':
        this.channelManager.prev(channelId);
        break;
      case 'volume':
        this.channelManager.setVolume(channelId, params?.volume);
        break;
    }
  }

  broadcastToChannel(channelId, message) {
    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client._channelId === channelId) {
        client.send(data);
      }
    });
  }

  broadcastAll(message) {
    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  sendChannelStatus(ws, channelId) {
    const channel = this.channelManager.getChannel(channelId);
    if (!channel) return;

    ws.send(JSON.stringify({
      type: 'status',
      channelId,
      name: channel.name,
      isPlaying: channel.isPlaying,
      currentTrack: channel.currentTrack ? {
        title: channel.currentTrack.title,
        filename: channel.currentTrack.filename
      } : null,
      volume: channel.volume,
      listeners: channel.listeners,
      playlist: channel.playlist.map((t, i) => ({
        index: i,
        title: t.title,
        filename: t.filename
      })),
      currentIndex: channel.currentIndex,
      ffmpegAvailable: this.ffmpegAvailable
    }));
  }

  stop() {
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = WebSocketServer;
