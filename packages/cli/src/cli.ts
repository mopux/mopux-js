import { createInterface } from 'node:readline';
import { run } from './app.js';
import type { Io } from './context.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function prompt(question: string, options: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (options.hidden) {
      // Print the question once and swallow the echo of what is typed.
      const output = rl as unknown as { _writeToOutput: (text: string) => void };
      let asked = false;
      output._writeToOutput = (text: string) => {
        if (!asked) {
          asked = true;
          process.stdout.write(text);
        }
      };
    }
    rl.on('SIGINT', () => {
      rl.close();
      process.stdout.write('\n');
      reject(new Error('Cancelled.'));
    });
    rl.question(question, (answer) => {
      rl.close();
      if (options.hidden) {
        process.stdout.write('\n');
      }
      resolve(answer);
    });
  });
}

const io: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin,
  prompt,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
};

process.exitCode = await run(process.argv.slice(2), { io, env: process.env });
