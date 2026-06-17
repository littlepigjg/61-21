const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config.json');
const ChannelManager = require('./channel-manager');
const AudioStreamer = require('./audio-streamer');
const WebSocketServer = require('./ws-server');
const { UserManager, ROLES } = require('./user-manager');
const SessionManager = require('./session-manager');
const createAuthMiddleware = require('./auth-middleware');
const { LogManager, LOG_TYPES } = require('./log-manager');

const dataDir = path.join(__dirname, '../data');

let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version 2>nul', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch (e) {}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
app.use(cors());
app.use(cookieParser());

app.use((req, res, next) => {
  let userId = null;
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)listener_uid=([^;]+)/);
    if (match) {
      userId = match[1];
    }
  }
  if (!userId) {
    userId = crypto.randomUUID();
    res.cookie('listener_uid', userId, {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax'
    });
  }
  req.listenerUid = userId;
  next();
});

const rawBodyBuffer = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

app.use(express.json({ verify: rawBodyBuffer }));

const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

const channelManager = new ChannelManager(config, dataDir);
channelManager.init();

const userManager = new UserManager(config, dataDir);
const sessionManager = new SessionManager(userManager);
const logManager = new LogManager(dataDir);
const auth = createAuthMiddleware(sessionManager, userManager);

const audioStreamer = new AudioStreamer(channelManager);

const wsServer = new WebSocketServer(config.wsPort, channelManager, ffmpegAvailable, userManager, sessionManager);
wsServer.start();

logManager.logSystem('服务启动');

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    logManager.logAuth('login_attempt', username, false, { reason: '缺少用户名或密码' });
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = userManager.authenticate(username, password);
  if (!user) {
    logManager.logAuth('login_failure', username, false, { reason: '用户名或密码错误' });
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const session = sessionManager.createSession(user);
  logManager.logAuth('login_success', username, true);

  res.cookie('auth_token', session.token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    token: session.token,
    user: user,
    permissions: userManager.getPermissions(user.role)
  });
});

app.post('/api/auth/logout', auth.requireAuth, (req, res) => {
  const token = req.authToken;
  const username = req.user.username;
  sessionManager.destroySession(token);
  res.clearCookie('auth_token');
  logManager.logAuth('logout', username, true);
  res.json({ success: true });
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({
    user: req.user,
    permissions: userManager.getPermissions(req.user.role)
  });
});

app.get('/api/users', auth.requireAuth, auth.requirePermission('users:manage'), (req, res) => {
  const users = userManager.getAllUsers();
  logManager.logUser('view_users', req.user);
  res.json(users);
});

app.post('/api/users', auth.requireAuth, auth.requirePermission('users:manage'), (req, res) => {
  const { username, password, role, name, managedChannels } = req.body;
  try {
    const user = userManager.createUser(username, password, role, name);
    if (role === ROLES.CHANNEL_ADMIN && managedChannels) {
      userManager.updateUser(username, { managedChannels });
    }
    const destroyed = sessionManager.destroyUserSessions(username);
    logManager.logUser('create_user', req.user, { targetUser: username, role, sessionsInvalidated: destroyed });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/users/:username', auth.requireAuth, auth.requirePermission('users:manage'), (req, res) => {
  const { username } = req.params;
  const { password, role, name, managedChannels } = req.body;
  try {
    const updates = {};
    if (password) updates.password = password;
    if (role) updates.role = role;
    if (name) updates.name = name;
    if (managedChannels !== undefined) updates.managedChannels = managedChannels;

    const user = userManager.updateUser(username, updates);
    const destroyed = sessionManager.destroyUserSessions(username);
    logManager.logUser('update_user', req.user, { targetUser: username, updates: Object.keys(updates), sessionsInvalidated: destroyed });
    res.json({ success: true, user, sessionsInvalidated: destroyed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/users/:username', auth.requireAuth, auth.requirePermission('users:manage'), (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  try {
    userManager.deleteUser(username);
    const destroyed = sessionManager.destroyUserSessions(username);
    logManager.logUser('delete_user', req.user, { targetUser: username, sessionsInvalidated: destroyed });
    res.json({ success: true, sessionsInvalidated: destroyed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/channels', (req, res) => {
  const channels = channelManager.getAllChannels();
  res.json(channels);
});

app.get('/api/channels/admin', auth.requireAuth, (req, res) => {
  const user = req.user;
  let channels = channelManager.getAllChannelsAdmin();
  
  if (user.role === ROLES.CHANNEL_ADMIN) {
    channels = channels.filter(ch => user.managedChannels && user.managedChannels.includes(ch.id));
  }
  
  logManager.logChannel('view_channels_admin', user);
  res.json(channels);
});

app.get('/api/channels/:channelId', (req, res) => {
  const channel = channelManager.getChannel(req.params.channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  res.json({
    id: channel.id,
    name: channel.name,
    description: channel.description,
    isPlaying: channel.isPlaying,
    currentTrack: channel.currentTrack ? {
      title: channel.currentTrack.title,
      filename: channel.currentTrack.filename
    } : null,
    listeners: channel.listeners,
    volume: channel.volume,
    currentIndex: channel.currentIndex
  });
});

app.post('/api/channels', auth.requireAuth, auth.requirePermission('channels:create'), (req, res) => {
  try {
    const channel = channelManager.createChannel(req.body);
    logManager.logChannel('create_channel', req.user, channel.id, { name: channel.name });
    res.json({ success: true, channel });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/channels/:channelId', auth.requireAuth, auth.requireChannelPermission('edit'), (req, res) => {
  try {
    const channel = channelManager.updateChannel(req.params.channelId, req.body);
    logManager.logChannel('update_channel', req.user, req.params.channelId, { updates: Object.keys(req.body) });
    res.json({ success: true, channel });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/channels/:channelId', auth.requireAuth, auth.requirePermission('channels:delete'), (req, res) => {
  try {
    channelManager.deleteChannel(req.params.channelId);
    logManager.logChannel('delete_channel', req.user, req.params.channelId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/channels/:channelId/playlist', (req, res) => {
  const channel = channelManager.getChannel(req.params.channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const playlist = channelManager.getPlaylist(req.params.channelId);
  res.json(playlist.map((t, i) => ({
    index: i,
    title: t.title,
    filename: t.filename
  })));
});

app.get('/api/channels/:channelId/files', auth.requireAuth, auth.requireChannelPermission('playlist'), (req, res) => {
  try {
    const files = channelManager.getAllFilesInDirectory(req.params.channelId);
    logManager.logPlaylist('view_files', req.user, req.params.channelId);
    res.json(files);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/channels/:channelId/playlist/reorder', auth.requireAuth, auth.requireChannelPermission('playlist'), (req, res) => {
  try {
    const { order } = req.body;
    channelManager.reorderPlaylist(req.params.channelId, order);
    logManager.logPlaylist('reorder', req.user, req.params.channelId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/channels/:channelId/playlist/:filename', auth.requireAuth, auth.requireChannelPermission('playlist'), (req, res) => {
  try {
    channelManager.removeFromPlaylist(req.params.channelId, req.params.filename);
    logManager.logPlaylist('remove_track', req.user, req.params.channelId, { filename: req.params.filename });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/channels/:channelId/blacklist', auth.requireAuth, auth.requireChannelPermission('blacklist'), (req, res) => {
  try {
    const blacklist = channelManager.getBlacklist(req.params.channelId);
    res.json(blacklist);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/channels/:channelId/blacklist', auth.requireAuth, auth.requireChannelPermission('blacklist'), (req, res) => {
  try {
    const { filename } = req.body;
    const blacklist = channelManager.addToBlacklist(req.params.channelId, filename);
    logManager.logChannel('add_blacklist', req.user, req.params.channelId, { filename });
    res.json({ success: true, blacklist });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/channels/:channelId/blacklist/:filename', auth.requireAuth, auth.requireChannelPermission('blacklist'), (req, res) => {
  try {
    const blacklist = channelManager.removeFromBlacklist(req.params.channelId, req.params.filename);
    logManager.logChannel('remove_blacklist', req.user, req.params.channelId, { filename: req.params.filename });
    res.json({ success: true, blacklist });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/channels/:channelId/play', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const { index } = req.body || {};
  const track = channelManager.play(req.params.channelId, index);
  if (track === null) {
    return res.status(404).json({ error: 'No tracks available' });
  }
  logManager.logPlayback('play', req.user, req.params.channelId, { track: track.title, index });
  res.json({ success: true, track });
});

app.post('/api/channels/:channelId/pause', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const result = channelManager.pause(req.params.channelId);
  logManager.logPlayback('pause', req.user, req.params.channelId);
  res.json({ success: result });
});

app.post('/api/channels/:channelId/resume', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const result = channelManager.resume(req.params.channelId);
  logManager.logPlayback('resume', req.user, req.params.channelId);
  res.json({ success: result });
});

app.post('/api/channels/:channelId/next', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const track = channelManager.next(req.params.channelId);
  if (track) {
    logManager.logPlayback('next', req.user, req.params.channelId, { track: track.title });
  }
  res.json({ success: true, track });
});

app.post('/api/channels/:channelId/prev', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const track = channelManager.prev(req.params.channelId);
  if (track) {
    logManager.logPlayback('prev', req.user, req.params.channelId, { track: track.title });
  }
  res.json({ success: true, track });
});

app.post('/api/channels/:channelId/volume', auth.requireAuth, auth.requireChannelPermission('control'), (req, res) => {
  const { volume } = req.body;
  if (volume === undefined) {
    return res.status(400).json({ error: 'Volume is required' });
  }
  const result = channelManager.setVolume(req.params.channelId, volume);
  logManager.logPlayback('volume', req.user, req.params.channelId, { volume });
  res.json({ success: result, volume: channelManager.getChannel(req.params.channelId)?.volume });
});

app.get('/api/logs', auth.requireAuth, auth.requirePermission('logs:view'), (req, res) => {
  const filters = {
    type: req.query.type,
    action: req.query.action,
    username: req.query.username,
    startTime: req.query.startTime ? parseInt(req.query.startTime) : undefined,
    endTime: req.query.endTime ? parseInt(req.query.endTime) : undefined
  };
  const logs = logManager.getLogs(filters);
  logManager.logUser('view_logs', req.user, { filters });
  res.json(logs);
});

app.delete('/api/logs', auth.requireAuth, auth.requirePermission('logs:view'), (req, res) => {
  logManager.clearLogs();
  logManager.logUser('clear_logs', req.user);
  res.json({ success: true });
});

app.get('/api/sessions', auth.requireAuth, auth.requirePermission('users:manage'), (req, res) => {
  const sessions = sessionManager.getAllSessions();
  res.json(sessions);
});

app.get('/stream/:channelId', (req, res) => {
  const channelId = req.params.channelId;
  const channel = channelManager.getChannel(channelId);
  const userId = req.listenerUid;

  if (!channel) {
    return res.status(404).send('Channel not found');
  }

  let contentType = 'audio/mpeg';
  if (!ffmpegAvailable) {
    const currentTrack = channelManager.getCurrentTrack(channelId);
    if (currentTrack) {
      const ext = currentTrack.filename.split('.').pop().toLowerCase();
      if (ext === 'wav') contentType = 'audio/wav';
      else if (ext === 'ogg') contentType = 'audio/ogg';
      else if (ext === 'flac') contentType = 'audio/flac';
      else if (ext === 'm4a' || ext === 'aac') contentType = 'audio/aac';
    }
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'none');
  res.status(200);

  const result = audioStreamer.createClientStream(channelId, userId, true);
  if (!result) {
    res.end();
    return;
  }

  const { stream: clientStream, connectionId } = result;
  res.setHeader('X-Connection-Id', connectionId);

  clientStream.pipe(res);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      clientStream.unpipe(res);
    } catch (e) {}
    try {
      clientStream.destroy();
    } catch (e) {}
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  clientStream.on('error', cleanup);
});

app.post('/api/listeners/leave', (req, res) => {
  let body = req.body;
  if ((!body || Object.keys(body).length === 0) && req.rawBody) {
    try {
      body = JSON.parse(req.rawBody);
    } catch (e) {}
  }
  const userId = req.listenerUid;
  if (!userId) {
    return res.json({ success: false });
  }
  const affected = audioStreamer.removeAllStreamsForUser(userId);
  res.json({ success: true, affectedChannels: affected, userId });
});

app.post('/api/listeners/heartbeat', (req, res) => {
  const { connectionId, channelId } = req.body || {};
  let success = false;
  if (connectionId) {
    success = audioStreamer.listenerManager.touch(connectionId, channelId);
  }
  res.json({ success });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/config', (req, res) => {
  res.json({
    ffmpegAvailable: ffmpegAvailable,
    port: config.port,
    wsPort: config.wsPort
  });
});

app.use((err, req, res, next) => {
  console.error('API Error:', err);
  logManager.logSystem('api_error', { error: err.message, path: req.path });
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(config.port, () => {
  console.log(`\n=== 内网音频广播服务已启动 ===`);
  console.log(`HTTP 服务端口: ${config.port}`);
  console.log(`WebSocket 端口: ${config.wsPort}`);
  console.log(`音乐目录: ${path.resolve(config.musicBaseDir)}`);
  console.log(`数据目录: ${path.resolve(dataDir)}`);
  console.log(`\n频道列表:`);
  for (const ch of config.channels) {
    console.log(`  [${ch.name}] - /stream/${ch.id}`);
    console.log(`    目录: ${path.join(config.musicBaseDir, ch.dir)}`);
  }
  console.log(`\n前端页面: http://localhost:${config.port}/`);
  console.log(`DJ 控制台: http://localhost:${config.port}/dj.html`);
  console.log(`登录页面: http://localhost:${config.port}/login.html`);
  console.log(`\n默认管理员账号: admin / admin123`);
  console.log(`\n提示: 请确保系统已安装 ffmpeg`);
});

process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  logManager.logSystem('服务关闭');
  audioStreamer.shutdown();
  wsServer.stop();
  sessionManager.shutdown();
  process.exit(0);
});
