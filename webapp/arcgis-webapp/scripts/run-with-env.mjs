#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , envFile, ...commandArgs] = process.argv;

if (!envFile) {
  console.error('Usage: node scripts/run-with-env.mjs <env-file> [command...]');
  process.exit(1);
}

if (commandArgs.length === 0) {
  console.error('Please provide a command to run after the env file path.');
  process.exit(1);
}

const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`);
  process.exit(1);
}

const env = { ...process.env };

const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
for (const rawLine of lines) {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith('#')) {
    continue;
  }

  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) {
    continue;
  }

  const key = line.slice(0, separatorIndex).trim();
  let value = line.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }

  env[key] = value;
}

const [command, ...args] = commandArgs;

const child = spawn(command, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
