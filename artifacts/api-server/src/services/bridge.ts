/**
 * Chat bridge — anti-loop protection.
 * Messages sent by our bot to Minecraft are stored here briefly.
 * When the MC bot sees a chat message, it checks this store first.
 */

interface BridgeMessage {
  content: string;
  expiresAt: number;
}

class BridgeService {
  private sentMessages: Map<string, BridgeMessage> = new Map();
  private readonly TTL_MS = 5000;
  private maintenanceMode = false;
  private syncEnabled = true;

  markSent(content: string): void {
    const key = content.toLowerCase().trim();
    this.sentMessages.set(key, { content, expiresAt: Date.now() + this.TTL_MS });
    // Cleanup old entries
    setTimeout(() => this.sentMessages.delete(key), this.TTL_MS + 100);
  }

  isBotMessage(content: string): boolean {
    const key = content.toLowerCase().trim();
    const entry = this.sentMessages.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.sentMessages.delete(key);
      return false;
    }
    return true;
  }

  setMaintenance(enabled: boolean): void {
    this.maintenanceMode = enabled;
  }

  isMaintenanceMode(): boolean {
    return this.maintenanceMode;
  }

  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
  }

  isSyncEnabled(): boolean {
    return this.syncEnabled && !this.maintenanceMode;
  }
}

export const bridgeService = new BridgeService();
