const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ChannelManager extends EventEmitter {
  constructor(config, dataDir) {
    super();
    this.config = config;
    this.dataDir = dataDir;
    this.channelsFile = path.join(dataDir, 'channels.json');
    this.channels = new Map();
    this.musicBaseDir = path.resolve(config.musicBaseDir);
    this.channelVersion = 0;
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.musicBaseDir)) {
      fs.mkdirSync(this.musicBaseDir, { recursive: true });
    }

    if (fs.existsSync(this.channelsFile)) {
      this.loadChannels();
    } else {
      this.loadDefaultChannels();
    }
  }

  loadChannels() {
    try {
      const data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf8'));
      this.channels.clear();
      for (const channelData of data.channels) {
        const channelDir = path.join(this.musicBaseDir, channelData.dir);
        if (!fs.existsSync(channelDir)) {
          fs.mkdirSync(channelDir, { recursive: true });
        }
        const channel = {
          ...channelData,
          dir: channelDir,
          playlist: [],
          currentTrack: null,
          currentIndex: -1,
          isPlaying: false,
          listeners: 0,
          mode: channelData.mode || 'sequential',
          blacklist: channelData.blacklist || []
        };
        this.channels.set(channel.id, channel);
        this.loadPlaylist(channel.id);
      }
      this.channelVersion = data.version || Date.now();
    } catch (e) {
      console.error('Failed to load channels:', e);
      this.loadDefaultChannels();
    }
  }

  loadDefaultChannels() {
    for (const channelConfig of this.config.channels) {
      const channelDir = path.join(this.musicBaseDir, channelConfig.dir);
      if (!fs.existsSync(channelDir)) {
        fs.mkdirSync(channelDir, { recursive: true });
      }

      const channel = {
        id: channelConfig.id,
        name: channelConfig.name,
        description: channelConfig.description,
        dir: channelDir,
        dirName: channelConfig.dir,
        bitrate: channelConfig.bitrate,
        sampleRate: channelConfig.sampleRate,
        playlist: [],
        currentTrack: null,
        currentIndex: -1,
        isPlaying: false,
        volume: 1.0,
        listeners: 0,
        mode: 'sequential',
        blacklist: []
      };

      this.channels.set(channel.id, channel);
      this.loadPlaylist(channel.id);
    }
    this.saveChannels();
  }

  saveChannels() {
    this.channelVersion = Date.now();
    const channelsData = Array.from(this.channels.values()).map(ch => ({
      id: ch.id,
      name: ch.name,
      description: ch.description,
      dir: ch.dirName,
      bitrate: ch.bitrate,
      sampleRate: ch.sampleRate,
      volume: ch.volume,
      mode: ch.mode,
      blacklist: ch.blacklist
    }));
    const data = {
      version: this.channelVersion,
      channels: channelsData
    };
    fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
  }

  getChannel(channelId) {
    return this.channels.get(channelId);
  }

  getAllChannels() {
    return Array.from(this.channels.values()).map(ch => ({
      id: ch.id,
      name: ch.name,
      description: ch.description,
      isPlaying: ch.isPlaying,
      currentTrack: ch.currentTrack,
      listeners: ch.listeners,
      volume: ch.volume
    }));
  }

  getAllChannelsAdmin() {
    return Array.from(this.channels.values()).map(ch => ({
      id: ch.id,
      name: ch.name,
      description: ch.description,
      dirName: ch.dirName,
      bitrate: ch.bitrate,
      sampleRate: ch.sampleRate,
      volume: ch.volume,
      mode: ch.mode,
      isPlaying: ch.isPlaying,
      listeners: ch.listeners,
      playlistCount: ch.playlist.length,
      blacklist: ch.blacklist
    }));
  }

  createChannel(channelData) {
    const id = channelData.id || channelData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (this.channels.has(id)) {
      throw new Error('频道ID已存在');
    }

    const dirName = channelData.dir || id;
    const channelDir = path.join(this.musicBaseDir, dirName);
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const channel = {
      id,
      name: channelData.name,
      description: channelData.description || '',
      dir: channelDir,
      dirName: dirName,
      bitrate: channelData.bitrate || '128k',
      sampleRate: channelData.sampleRate || 44100,
      playlist: [],
      currentTrack: null,
      currentIndex: -1,
      isPlaying: false,
      volume: channelData.volume !== undefined ? channelData.volume : 1.0,
      listeners: 0,
      mode: channelData.mode || 'sequential',
      blacklist: []
    };

    this.channels.set(id, channel);
    this.loadPlaylist(id);
    this.saveChannels();
    this.emit('channelCreated', id);
    return this.getChannelAdmin(id);
  }

  updateChannel(channelId, updates) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error('频道不存在');
    }

    if (updates.name !== undefined) channel.name = updates.name;
    if (updates.description !== undefined) channel.description = updates.description;
    if (updates.bitrate !== undefined) channel.bitrate = updates.bitrate;
    if (updates.sampleRate !== undefined) channel.sampleRate = updates.sampleRate;
    if (updates.volume !== undefined) channel.volume = Math.max(0, Math.min(1, updates.volume));
    if (updates.mode !== undefined) channel.mode = updates.mode;

    this.saveChannels();
    this.emit('channelUpdated', channelId);
    return this.getChannelAdmin(channelId);
  }

  deleteChannel(channelId) {
    if (!this.channels.has(channelId)) {
      throw new Error('频道不存在');
    }
    this.channels.delete(channelId);
    this.saveChannels();
    this.emit('channelDeleted', channelId);
    return true;
  }

  getChannelAdmin(channelId) {
    const ch = this.channels.get(channelId);
    if (!ch) return null;
    return {
      id: ch.id,
      name: ch.name,
      description: ch.description,
      dirName: ch.dirName,
      bitrate: ch.bitrate,
      sampleRate: ch.sampleRate,
      volume: ch.volume,
      mode: ch.mode,
      isPlaying: ch.isPlaying,
      listeners: ch.listeners,
      playlistCount: ch.playlist.length,
      blacklist: ch.blacklist
    };
  }

  loadPlaylist(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return [];

    const audioExtensions = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma'];
    const files = fs.readdirSync(channel.dir)
      .filter(f => audioExtensions.includes(path.extname(f).toLowerCase()))
      .filter(f => !channel.blacklist.includes(f))
      .map(f => ({
        filename: f,
        path: path.join(channel.dir, f),
        title: path.basename(f, path.extname(f))
      }));

    channel.playlist = files;
    return files;
  }

  getPlaylist(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.playlist;
  }

  addToPlaylist(channelId, filePath) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('频道不存在');

    const fileName = path.basename(filePath);
    const destPath = path.join(channel.dir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error('源文件不存在');
    }
    if (fs.existsSync(destPath)) {
      throw new Error('文件已存在');
    }

    fs.copyFileSync(filePath, destPath);
    this.loadPlaylist(channelId);
    this.emit('playlistUpdated', channelId);
    return true;
  }

  removeFromPlaylist(channelId, filename) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('频道不存在');

    const filePath = path.join(channel.dir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.loadPlaylist(channelId);

    if (channel.currentTrack && channel.currentTrack.filename === filename) {
      if (channel.playlist.length > 0) {
        channel.currentIndex = Math.min(channel.currentIndex, channel.playlist.length - 1);
        channel.currentTrack = channel.playlist[channel.currentIndex] || null;
      } else {
        channel.currentIndex = -1;
        channel.currentTrack = null;
        channel.isPlaying = false;
      }
    }

    this.emit('playlistUpdated', channelId);
    return true;
  }

  reorderPlaylist(channelId, newOrder) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('频道不存在');

    const newPlaylist = [];
    for (const filename of newOrder) {
      const track = channel.playlist.find(t => t.filename === filename);
      if (track) {
        newPlaylist.push(track);
      }
    }

    if (newPlaylist.length !== channel.playlist.length) {
      throw new Error('排序数据不完整');
    }

    channel.playlist = newPlaylist;

    if (channel.currentTrack) {
      const newIndex = channel.playlist.findIndex(t => t.filename === channel.currentTrack.filename);
      if (newIndex >= 0) {
        channel.currentIndex = newIndex;
      }
    }

    this.emit('playlistUpdated', channelId);
    return true;
  }

  getBlacklist(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.blacklist;
  }

  addToBlacklist(channelId, filename) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('频道不存在');

    if (!channel.blacklist.includes(filename)) {
      channel.blacklist.push(filename);
      this.loadPlaylist(channelId);

      if (channel.currentTrack && channel.currentTrack.filename === filename) {
        if (channel.playlist.length > 0) {
          channel.currentIndex = 0;
          channel.currentTrack = channel.playlist[0];
        } else {
          channel.currentIndex = -1;
          channel.currentTrack = null;
          channel.isPlaying = false;
        }
      }

      this.saveChannels();
      this.emit('blacklistUpdated', channelId);
    }
    return channel.blacklist;
  }

  removeFromBlacklist(channelId, filename) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('频道不存在');

    const index = channel.blacklist.indexOf(filename);
    if (index >= 0) {
      channel.blacklist.splice(index, 1);
      this.loadPlaylist(channelId);
      this.saveChannels();
      this.emit('blacklistUpdated', channelId);
    }
    return channel.blacklist;
  }

  play(channelId, trackIndex = null) {
    const channel = this.channels.get(channelId);
    if (!channel) return null;

    if (channel.playlist.length === 0) {
      this.loadPlaylist(channelId);
      if (channel.playlist.length === 0) {
        channel.isPlaying = false;
        channel.currentTrack = null;
        return null;
      }
    }

    if (trackIndex !== null) {
      channel.currentIndex = trackIndex;
    } else if (channel.currentIndex < 0 || channel.currentIndex >= channel.playlist.length) {
      channel.currentIndex = 0;
    }

    channel.currentTrack = channel.playlist[channel.currentIndex];
    channel.isPlaying = true;
    this.emit('play', channelId, channel.currentTrack);
    return channel.currentTrack;
  }

  pause(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    channel.isPlaying = false;
    this.emit('pause', channelId);
    return true;
  }

  resume(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    if (channel.currentTrack) {
      channel.isPlaying = true;
      this.emit('resume', channelId);
      return true;
    }
    return false;
  }

  next(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel || channel.playlist.length === 0) return null;

    channel.currentIndex = (channel.currentIndex + 1) % channel.playlist.length;
    channel.currentTrack = channel.playlist[channel.currentIndex];
    channel.isPlaying = true;
    this.emit('play', channelId, channel.currentTrack);
    return channel.currentTrack;
  }

  prev(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel || channel.playlist.length === 0) return null;

    channel.currentIndex = (channel.currentIndex - 1 + channel.playlist.length) % channel.playlist.length;
    channel.currentTrack = channel.playlist[channel.currentIndex];
    channel.isPlaying = true;
    this.emit('play', channelId, channel.currentTrack);
    return channel.currentTrack;
  }

  setVolume(channelId, volume) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    channel.volume = Math.max(0, Math.min(1, volume));
    this.saveChannels();
    this.emit('volume', channelId, channel.volume);
    return true;
  }

  addListener(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return -1;

    channel.listeners++;
    this.emit('listeners', channelId, channel.listeners);
    return channel.listeners;
  }

  removeListener(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return -1;

    channel.listeners = Math.max(0, channel.listeners - 1);
    this.emit('listeners', channelId, channel.listeners);
    return channel.listeners;
  }

  getCurrentTrack(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    return channel.currentTrack;
  }

  getChannelVersion() {
    return this.channelVersion;
  }

  getAllFilesInDirectory(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return [];

    const audioExtensions = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma'];
    return fs.readdirSync(channel.dir)
      .filter(f => audioExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => ({
        filename: f,
        title: path.basename(f, path.extname(f)),
        isBlacklisted: channel.blacklist.includes(f),
        inPlaylist: !channel.blacklist.includes(f)
      }));
  }
}

module.exports = ChannelManager;
