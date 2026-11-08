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

/** Close the SSH session after this long without commands, so other clients can log in. */
const IDLE_DISCONNECT_MS = 10_000;
/** How long to keep retrying while another client holds the router's only SSH slot. */
const BUSY_RETRY_MS = 25_000;

/**
 * The router allows one SSH session. While it is taken, it answers with
 * "No connection is available now. Try again later!" instead of an SSH banner,
 * which ssh2 reports as a header error or a connection lost before the handshake.
 */
export class RouterBusyError extends Error {
  constructor(cause: Error) {
    super(
      "Router refused the SSH connection: it allows only one SSH session at a time, " +
      "and another client (e.g. another draytek-mcp instance or an open SSH/telnet login) is using it. " +
      `Try again shortly. (${cause.message})`
    );
    this.name = "RouterBusyError";
  }
}

function isBusyError(err: Error): boolean {
  return /Invalid header|expected newline|before handshake|No connection is available/i.test(err.message);
}

/** Raised when the router does not return a prompt in time. */
export class PromptTimeoutError extends Error {
  constructor(public readonly received: string, timeoutMs: number) {
    super(
      received.length === 0
        ? `Timed out after ${timeoutMs} ms waiting for router prompt (no data received — connection is probably dead)`
        : `Timed out after ${timeoutMs} ms waiting for router prompt (output may be incomplete):\n${received}`
    );
    this.name = "PromptTimeoutError";
  }
}

export class DraytekClient {
  private config: DraytekConfig;
  private conn: Client | null = null;
  private shell: ClientChannel | null = null;
  private buffer = "";
  private promptPattern = /\r?\n?[\w.-]+>\s*$/;
  private connecting: Promise<void> | null = null;
  /** Serialises commands: they share one shell and one buffer. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Commands queued or running; the session is released when this reaches 0. */
  private pending = 0;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(config: DraytekConfig) {
    this.config = { port: 22, ...config };
  }

  /** Forget the current session (only if it is still the active one). */
  private reset(conn: Client): void {
    if (this.conn !== conn) return;
    this.shell = null;
    this.conn = null;
  }

  async connect(): Promise<void> {
    if (this.shell) return;
    if (!this.connecting) {
      this.connecting = this.openSessionWhenFree().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /** Open a session, waiting with backoff while another client holds the router's only SSH slot. */
  private async openSessionWhenFree(): Promise<void> {
    const deadline = Date.now() + BUSY_RETRY_MS;
    let delay = 1_000;
    for (;;) {
      try {
        return await this.openSession();
      } catch (err) {
        if (!(err instanceof RouterBusyError)) throw err;
        if (Date.now() + delay > deadline) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 5_000);
      }
    }
  }

  private async openSession(): Promise<void> {
    const conn = new Client();
    this.conn = conn;

    await new Promise<void>((resolve, reject) => {
      let hostMismatchMsg = "";
      let settled = false;
      const fail = (err: Error) => {
        this.reset(conn);
        conn.end();
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      conn.on("ready", () => {
        conn.shell({ term: "dumb", rows: 1000, cols: 200 }, (err, stream) => {
          if (err) return fail(err);
          this.shell = stream;
          this.buffer = "";

          stream.on("data", (data: Buffer) => {
            this.buffer += data.toString("utf-8");
          });

          stream.on("close", () => this.reset(conn));

          this.waitForPrompt(10_000)
            .then(async () => {
              this.buffer = "";
              stream.write("sys admin drayteker\r\n");
              await this.waitForPrompt(5_000);
              settled = true;
              resolve();
            })
            .catch(fail);
        });
      });

      conn.on("error", (err) => {
        if (hostMismatchMsg) return fail(new Error(hostMismatchMsg));
        fail(isBusyError(err) ? new RouterBusyError(err) : err);
      });

      // Link drop, router reboot or idle timeout: forget the session so the next call reconnects.
      conn.on("close", () => fail(new Error("SSH connection closed")));
      conn.on("end", () => fail(new Error("SSH connection ended")));

      const sshConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: 10_000,
        // Detect half-open connections (no TCP close arrives after a link drop).
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
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

  /**
   * Resolve with everything received once the prompt appears.
   * Rejects with PromptTimeoutError if no prompt arrives within timeoutMs
   * (the timer restarts after each "--- MORE ---" page).
   */
  private waitForPrompt(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const startLen = this.buffer.length;
      let done = false;
      let poll: NodeJS.Timeout | undefined;
      let timer: NodeJS.Timeout;

      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(poll);
        fn();
      };
      const armTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          finish(() => reject(new PromptTimeoutError(this.buffer.substring(startLen), timeoutMs)));
        }, timeoutMs);
      };

      const check = () => {
        if (done) return;
        const current = this.buffer;

        if (MORE_PATTERN.test(current)) {
          // Ask for the next page; strip the marker so it is not matched again.
          this.buffer = current.replace(MORE_PATTERN, "");
          if (this.shell) this.shell.write(" ");
          armTimer();
          poll = setTimeout(check, 200);
          return;
        }

        if (this.promptPattern.test(current)) {
          finish(() => resolve(current.substring(startLen)));
          return;
        }

        poll = setTimeout(check, 100);
      };

      armTimer();
      check();
    });
  }

  async execute(command: string, timeoutMs = 15_000): Promise<string> {
    if (/[\x00-\x1f\x7f]/.test(command)) {
      throw new Error("Command contains illegal control characters");
    }
    clearTimeout(this.idleTimer);
    this.pending++;
    const run = this.queue
      .then(() => this.executeWithRetry(command, timeoutMs))
      .finally(() => {
        if (--this.pending === 0) {
          this.idleTimer = setTimeout(() => void this.disconnect(), IDLE_DISCONNECT_MS);
        }
      });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async executeWithRetry(command: string, timeoutMs: number): Promise<string> {
    try {
      return await this.executeOnce(command, timeoutMs);
    } catch (err) {
      await this.disconnect();
      // Retry only when nothing at all came back. The router echoes every command,
      // so no data means the command never reached the CLI and is safe to resend.
      // Partial output means it may have run, so it is not repeated.
      if (err instanceof PromptTimeoutError && err.received.length === 0) {
        return this.executeOnce(command, timeoutMs);
      }
      throw err;
    }
  }

  private async executeOnce(command: string, timeoutMs: number): Promise<string> {
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
