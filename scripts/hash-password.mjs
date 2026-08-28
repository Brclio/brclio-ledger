import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function readHiddenPassword() {
  if (!process.stdin.isTTY) return readFileSync(0, 'utf8').replace(/[\r\n]+$/u, '');

  process.stderr.write('Password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let password = '';
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      resolve(password);
    };
    process.stdin.on('data', (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          process.stdin.setRawMode(false);
          process.stderr.write('\n');
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else password += character;
      }
    });
  });
}

try {
  const password = await readHiddenPassword();
  if (!password) throw new Error('Password cannot be empty');
  if (password.length < 12) {
    console.error('Warning: use a long, unique password (12+ characters recommended).');
  }
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  console.log(`scrypt$16384$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to hash password');
  process.exitCode = 1;
}
