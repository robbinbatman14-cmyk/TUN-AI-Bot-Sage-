// ============================================================
// Permission Engine
// Deny-by-default (Section 102). Every level below can see its
// own visibility tier and everything less restrictive than it.
// Levels are mapped to Discord role IDs via /ai permissions,
// stored in the role_permissions table.
// ============================================================
const db = require('../config/db');
const securityMonitor = require('../security/securityMonitor');

const LEVELS = ['member', 'ministry', 'government', 'high_government', 'secgen', 'owner'];

// Which document visibility tiers each permission level may read.
const VISIBILITY_ACCESS = {
  public: ['member', 'ministry', 'government', 'high_government', 'secgen', 'owner'],
  members_only: ['member', 'ministry', 'government', 'high_government', 'secgen', 'owner'],
  government: ['government', 'high_government', 'secgen', 'owner'],
  ministry: ['ministry', 'government', 'high_government', 'secgen', 'owner'],
  owner: ['owner']
};

function setRoleLevel(roleId, level) {
  if (!LEVELS.includes(level)) throw new Error(`Unknown permission level: ${level}`);
  db.prepare(
    'INSERT INTO role_permissions (role_id, level) VALUES (?, ?) ON CONFLICT(role_id) DO UPDATE SET level = excluded.level'
  ).run(roleId, level);
}

function removeRoleLevel(roleId) {
  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
}

function listRoleLevels() {
  return db.prepare('SELECT role_id, level FROM role_permissions').all();
}

/**
 * Determine a guild member's highest permission level.
 * Falls back to "member" if they hold no mapped role and are not
 * a Discord Administrator. Discord Administrators are always treated
 * as "owner" so alliance leadership always has full control.
 */
function getMemberLevel(guildMember) {
  if (!guildMember) return 'member';
  if (guildMember.permissions?.has?.('Administrator')) return 'owner';

  const mapped = listRoleLevels();
  if (mapped.length === 0) return 'member';

  let best = 'member';
  let bestRank = 0;
  for (const { role_id, level } of mapped) {
    if (guildMember.roles.cache.has(role_id)) {
      const rank = LEVELS.indexOf(level);
      if (rank > bestRank) {
        bestRank = rank;
        best = level;
      }
    }
  }
  return best;
}

function canAccessVisibility(level, visibility) {
  const allowed = VISIBILITY_ACCESS[visibility] || VISIBILITY_ACCESS.members_only;
  return allowed.includes(level);
}

// Minimum level required to run admin/config commands.
function isAdminLevel(level) {
  return ['high_government', 'secgen', 'owner'].includes(level);
}

/**
 * Shared admin gate for command handlers. Replies with a denial message
 * and logs a security event (Section 100) if the user isn't authorized;
 * returns true/false so the caller can `if (!requireAdmin(interaction)) return;`.
 */
function requireAdmin(interaction) {
  const level = getMemberLevel(interaction.member);
  if (!isAdminLevel(level)) {
    securityMonitor.logSecurityEvent('permission_denied', {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      detail: `/${interaction.commandName} — level: ${level}`
    });
    interaction.reply({ content: "You don't have permission to do that. This requires High Government level or above.", ephemeral: true });
    return false;
  }
  return true;
}

module.exports = {
  LEVELS,
  setRoleLevel,
  removeRoleLevel,
  listRoleLevels,
  getMemberLevel,
  canAccessVisibility,
  isAdminLevel,
  requireAdmin
};
