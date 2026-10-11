import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DraytekConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  knownHostsPath?: string;
}

const MORE_PATTERN = /--- MORE ---.*---\s*$/;

export class DraytekClient {
  private config: DraytekConfig;
  private conn: Client | null = null;
  private shell: ClientChannel | null = null;
  private buffer = "";
  private promptPattern = /\r?\n?[\w.-]+>\s*$/;

  constructor(config: DraytekConfig) {
    this.config = { port: 22, ...config };
  }

  async connect(): Promise<void> {
    if (this.shell) return;

    const conn = new Client();
    this.conn = conn;

    await new Promise<void>((resolve, reject) => {
      let hostMismatchMsg = "";

      conn.on("ready", () => {
        conn.shell({ term: "dumb", rows: 1000, cols: 200 }, (err, stream) => {
          if (err) return reject(err);
          this.shell = stream;
          this.buffer = "";

          stream.on("data", (data: Buffer) => {
            this.buffer += data.toString("utf-8");
          });

          stream.on("close", () => {
            this.shell = null;
            this.conn = null;
          });

          this.waitForPrompt(10_000)
            .then(async () => {
              this.buffer = "";
              this.shell!.write("sys admin drayteker\r\n");
              await this.waitForPrompt(5_000);
              resolve();
            })
            .catch(reject);
        });
      });

      conn.on("error", (err) => {
        this.conn = null;
        if (hostMismatchMsg) {
          reject(new Error(hostMismatchMsg));
        } else {
          reject(err);
        }
      });

      const sshConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: 10_000,
        hostVerifier: (key: Buffer) => {
          const fingerprint = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          const hostKey = `${this.config.host}:${this.config.port ?? 22}`;
          const knownHostsFile = this.config.knownHostsPath ??
            join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "draytek-mcp", "known_hosts");

          let stored: Record<string, string> = {};
          if (existsSync(knownHostsFile)) {
            try {
              const raw = readFileSync(knownHostsFile, "utf-8");
              const parsed = JSON.parse(raw);
              if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                throw new Error("not a JSON object");
              }
              stored = parsed;
            } catch {
              hostMismatchMsg = `Known hosts file is corrupt: ${knownHostsFile}\nDelete or fix the file to continue.`;
              return false;
            }
          }

          if (stored[hostKey]) {
            if (stored[hostKey] === fingerprint) {
              return true;
            }
            hostMismatchMsg =
              `HOST KEY MISMATCH for ${hostKey}!\n` +
              `Expected: ${stored[hostKey]}\n` +
              `Received: ${fingerprint}\n` +
              `Known hosts file: ${knownHostsFile}\n` +
              `If the router was factory-reset or its firmware regenerated the key, delete that entry from the file.`;
            return false;
          }

          try {
            const dir = knownHostsFile.substring(0, knownHostsFile.lastIndexOf("/"));
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            stored[hostKey] = fingerprint;
            writeFileSync(knownHostsFile, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
            process.stderr.write(`[draytek-mcp] Pinned host key for ${hostKey}: ${fingerprint}\n`);
          } catch {
            process.stderr.write(`[draytek-mcp] WARNING: Could not save host key to ${knownHostsFile} — continuing without pinning\n`);
          }
          return true;
        },
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group-exchange-sha256",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1",
          ],
          cipher: [
            "aes256-ctr",
            "aes192-ctr",
            "aes128-ctr",
            "aes128-gcm",
            "aes128-gcm@openssh.com",
            "aes256-gcm",
            "aes256-gcm@openssh.com",
            "aes256-cbc",
            "aes128-cbc",
          ],
          serverHostKey: [
            "rsa-sha2-256",
            "rsa-sha2-512",
            "ecdsa-sha2-nistp256",
            "ecdsa-sha2-nistp384",
            "ecdsa-sha2-nistp521",
            "ssh-ed25519",
            "ssh-rsa",
          ],
          hmac: [
            "hmac-sha2-256",
            "hmac-sha2-512",
            "hmac-sha1",
          ],
        },
      };

      conn.connect(sshConfig);
    });
  }

  private waitForPrompt(timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      const startLen = this.buffer.length;
      const timer = setTimeout(() => {
        resolve(this.buffer.substring(startLen));
      }, timeoutMs);

      const check = () => {
        const current = this.buffer;

        if (MORE_PATTERN.test(current)) {
          clearTimeout(timer);
          if (this.shell) this.shell.write(" ");
          setTimeout(check, 200);
          return;
        }

        if (this.promptPattern.test(current)) {
          clearTimeout(timer);
          resolve(current.substring(startLen));
          return;
        }

        setTimeout(check, 100);
      };
      check();
    });
  }

  async execute(command: string, timeoutMs = 15_000): Promise<string> {
    if (/[\x00-\x1f\x7f]/.test(command)) {
      throw new Error("Command contains illegal control characters");
    }
    await this.connect();
    if (!this.shell) throw new Error("No shell available");

    this.buffer = "";
    this.shell.write(command + "\r\n");

    const raw = await this.waitForPrompt(timeoutMs);
    return this.cleanOutput(raw, command);
  }

  private cleanOutput(raw: string, command: string): string {
    let text = raw.replace(/--- MORE ---[^\n]*---\s*/g, "");

    const lines = text.split(/\r?\n/);

    if (lines.length > 0 && lines[0].trim() === command.trim()) {
      lines.shift();
    }

    while (lines.length > 0 && this.promptPattern.test(lines[lines.length - 1])) {
      lines.pop();
    }

    return lines.join("\n").trim();
  }

  async disconnect(): Promise<void> {
    if (this.shell) {
      this.shell.end();
      this.shell = null;
    }
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }

  async listCommands(): Promise<string[]> {
    const output = await this.execute("?");
    const cleaned = output.replace(/% Valid commands are:\s*/, "");
    return cleaned.split(/\s+/).filter((s) => s.length > 0);
  }
}
