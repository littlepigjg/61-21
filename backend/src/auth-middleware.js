const { ROLES } = require('./user-manager');

function createAuthMiddleware(sessionManager, userManager) {
  function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    if (req.cookies && req.cookies.auth_token) {
      return req.cookies.auth_token;
    }
    return null;
  }

  function requireAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: '未登录，请先登录' });
    }

    const validation = sessionManager.validateSession(token);
    if (!validation.valid) {
      if (validation.needsReauth) {
        return res.status(401).json({ error: validation.message, needsReauth: true });
      }
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }

    req.user = validation.session.user;
    req.authToken = token;
    next();
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: '未登录' });
      }

      if (!userManager.hasPermission(req.user.username, permission)) {
        return res.status(403).json({ error: '权限不足' });
      }

      next();
    };
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: '未登录' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: '权限不足' });
      }

      next();
    };
  }

  function requireChannelPermission(permissionType) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: '未登录' });
      }

      const channelId = req.params.channelId || req.body.channelId;
      if (!channelId) {
        return res.status(400).json({ error: '缺少频道ID' });
      }

      const { role } = req.user;

      if (role === ROLES.SUPER_ADMIN) {
        return next();
      }

      const canManage = userManager.canManageChannel(req.user.username, channelId);
      if (!canManage) {
        return res.status(403).json({ error: '无权管理该频道' });
      }

      if (role === ROLES.CHANNEL_ADMIN) {
        if (permissionType === 'control') {
          if (!userManager.hasPermission(req.user.username, 'channels:control_own')) {
            return res.status(403).json({ error: '权限不足' });
          }
        } else if (permissionType === 'edit') {
          if (!userManager.hasPermission(req.user.username, 'channels:edit_own')) {
            return res.status(403).json({ error: '权限不足' });
          }
        } else if (permissionType === 'playlist') {
          if (!userManager.hasPermission(req.user.username, 'channels:playlist_own')) {
            return res.status(403).json({ error: '权限不足' });
          }
        } else if (permissionType === 'blacklist') {
          if (!userManager.hasPermission(req.user.username, 'channels:blacklist_own')) {
            return res.status(403).json({ error: '权限不足' });
          }
        }
      } else if (role === ROLES.DJ) {
        if (permissionType !== 'control') {
          return res.status(403).json({ error: '普通DJ仅可控制播放' });
        }
        if (!userManager.hasPermission(req.user.username, 'channels:control_all')) {
          return res.status(403).json({ error: '权限不足' });
        }
      }

      next();
    };
  }

  return {
    requireAuth,
    requirePermission,
    requireRole,
    requireChannelPermission,
    extractToken
  };
}

module.exports = createAuthMiddleware;
