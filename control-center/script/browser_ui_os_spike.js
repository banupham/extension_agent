'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function validateRequest(args) {
  const action = String(args.action || '').trim();
  const title = String(args.title || '').trim();
  const mechanism = String(args.mechanism || 'keyboard').trim().toLowerCase();
  if (!['back', 'forward'].includes(action)) {
    throw new Error('browser_ui_os_spike_action_must_be_back_or_forward');
  }
  if (!['keyboard', 'pointer'].includes(mechanism)) {
    throw new Error('browser_ui_os_spike_mechanism_must_be_keyboard_or_pointer');
  }
  if (!title) throw new Error('--title is required');
  return { action, title, mechanism };
}

function preflightText(request) {
  const shortcut = request.action === 'back' ? 'Alt+Left' : 'Alt+Right';
  const mechanismText = request.mechanism === 'pointer'
    ? `UI Automation locate ${request.action === 'back' ? 'Back' : 'Forward'} + Win32 SendInput physical mouse move/down/up`
    : `Win32 SendInput (${shortcut})`;
  const effectText = request.mechanism === 'pointer'
    ? 'This test will foreground the matching browser window, move the real Windows mouse along a multi-step trajectory, then send left-button down/hold/up on the browser toolbar control.'
    : 'This test will bring the matching Windows window to the foreground and send real OS-level keyboard input.';
  return [
    '',
    '[OS CONTROL TEST — CONSENT REQUIRED]',
    `Target window title contains: ${request.title}`,
    `Action: ${request.action}`,
    `Mechanism: ${mechanismText}`,
    effectText,
    'Do not use the keyboard/mouse in another application while the input is being sent.',
    'Type YES to continue (case-insensitive): '
  ].join('\n');
}

async function confirmRequest(request, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('browser_ui_os_spike_consent_requires_tty');
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(preflightText(request));
    if (String(answer || '').trim().toUpperCase() !== 'YES') {
      throw new Error('browser_ui_os_spike_consent_declined');
    }
  } finally {
    rl.close();
  }
  return true;
}

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function pointerPowerShellArgs(scriptPath, request) {
  const command = [
    "$ErrorActionPreference='Stop'",
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    `$scriptPath = ${psSingleQuoted(scriptPath)}`,
    '$scriptText = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)',
    '$block = [scriptblock]::Create($scriptText)',
    `& $block -Action ${psSingleQuoted(request.action)} -TitleContains ${psSingleQuoted(request.title)}`
  ].join('; ');
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedCommand
  ];
}

function powershellArgs(request) {
  const scriptName = request.mechanism === 'pointer'
    ? 'browser_ui_pointer_spike.ps1'
    : 'browser_ui_os_spike.ps1';
  const scriptPath = path.join(__dirname, scriptName);
  if (request.mechanism === 'pointer') {
    return pointerPowerShellArgs(scriptPath, request);
  }
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-Action', request.action,
    '-TitleContains', request.title
  ];
}

function run(request) {
  if (process.platform !== 'win32') {
    throw new Error('browser_ui_os_spike_windows_only');
  }
  const result = spawnSync('powershell.exe', powershellArgs(request), {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.status !== 0) {
    throw new Error(stderr || stdout || `browser_ui_os_spike_exit_${result.status}`);
  }
  if (stdout) process.stdout.write(`${stdout}\n`);
  if (stderr) process.stderr.write(`${stderr}\n`);
  return { status: result.status, stdout, stderr };
}

async function main(argv = process.argv.slice(2)) {
  const request = validateRequest(parseArgs(argv));
  await confirmRequest(request);
  return run(request);
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  validateRequest,
  preflightText,
  psSingleQuoted,
  pointerPowerShellArgs,
  powershellArgs,
  run,
  main
};
