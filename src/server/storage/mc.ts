import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Thin wrapper around the MinIO `mc` CLI, used for admin operations that the
   S3 protocol cannot express (create IAM user, create/attach canned policy).
   There is no maintained JS admin SDK and the admin REST API encrypts
   payloads with DARE/sio, so shelling out to mc is the robust path. Every
   invocation uses a throwaway --config-dir (no state touches $HOME), --json
   output, and a hard timeout; secrets are redacted from error messages. */

export interface McCreds {
  endpoint: string; // host, no protocol
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
}

const MC_TIMEOUT_MS = 15_000;

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join('***');
  }
  return out.trim();
}

function execMc(configDir: string, secrets: string[], args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'mc',
      ['--config-dir', configDir, '--json', ...args],
      { timeout: MC_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = redact(stderr || stdout || err.message, secrets);
          const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
          reject(
            new Error(
              notFound
                ? '未安装 mc（MinIO Client）：brew install minio/stable/mc，或确认部署镜像已内置 mc'
                : `mc ${args.slice(0, 2).join(' ')} 失败：${detail}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/* Set a throwaway alias for the given admin creds, run fn(alias, run), then
   wipe the temp config dir. `run` executes further mc subcommands against the
   same alias; `configDir` is exposed so callers can drop input files (e.g. a
   policy document) somewhere that gets cleaned up automatically. */
export async function withMcAdmin<T>(
  creds: McCreds,
  fn: (alias: string, run: (args: string[]) => Promise<string>, configDir: string) => Promise<T>,
): Promise<T> {
  const configDir = await mkdtemp(join(tmpdir(), 'spms-mc-'));
  const secrets = [creds.accessKey, creds.secretKey];
  const run = (args: string[]) => execMc(configDir, secrets, args);
  try {
    const url = `${creds.useSsl ? 'https' : 'http'}://${creds.endpoint}:${creds.port}`;
    await run(['alias', 'set', 'p', url, creds.accessKey, creds.secretKey]);
    return await fn('p', run, configDir);
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
  }
}
