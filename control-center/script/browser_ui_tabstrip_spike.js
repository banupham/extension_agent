'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');

const ACTIONS = new Set(['switchTab', 'openNewTab', 'closeTab']);

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

function validateRequest(args = {}) {
  const action = String(args.action || '').trim();
  const title = String(args.title || '').trim();
  const targetTabTitle = String(args['tab-title'] || args.targetTabTitle || '').trim();
  if (!ACTIONS.has(action)) throw new Error('browser_ui_tabstrip_action_must_be_switchTab_openNewTab_or_closeTab');
  if (!title) throw new Error('--title is required');
  if (['switchTab', 'closeTab'].includes(action) && !targetTabTitle) {
    throw new Error('--tab-title is required for switchTab/closeTab');
  }
  return { action, title, targetTabTitle };
}

function preflightText(request) {
  const windowAnchorText = request.action === 'switchTab'
    ? `Window anchor tab title: ${request.title}`
    : `Target window title contains: ${request.title}`;
  const targetText = request.targetTabTitle ? `Target tab title: ${request.targetTabTitle}` : 'Target: browser New Tab button';
  return [
    '',
    '[BROWSER UI TAB-STRIP TEST — CONSENT REQUIRED]',
    windowAnchorText,
    `Action: ${request.action}`,
    targetText,
    'Mechanism: Windows UI Automation semantic discovery + Win32 SendInput real pointer trajectory/down/hold/up.',
    'This test will foreground the matching browser window and temporarily own the real Windows mouse.',
    'Do not use mouse/keyboard in another application until the command finishes.',
    'Type YES to continue (case-insensitive): '
  ].join('\n');
}

async function confirmRequest(request, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) throw new Error('browser_ui_tabstrip_consent_requires_tty');
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(preflightText(request));
    if (String(answer || '').trim().toUpperCase() !== 'YES') throw new Error('browser_ui_tabstrip_consent_declined');
  } finally {
    rl.close();
  }
  return true;
}

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function powershellArgs(request) {
  const switchMode = request.action === 'switchTab';
  const scriptName = switchMode ? 'browser_ui_switch_tab_spike.ps1' : 'browser_ui_tabstrip_spike.ps1';
  const scriptPath = path.join(__dirname, scriptName);
  const invoke = switchMode
    ? [
        `& $block -AnchorTabTitle ${psSingleQuoted(request.title)}`,
        `-TargetTabTitle ${psSingleQuoted(request.targetTabTitle)}`
      ].join(' ')
    : [
        `& $block -Action ${psSingleQuoted(request.action)}`,
        `-TitleContains ${psSingleQuoted(request.title)}`,
        request.targetTabTitle ? `-TargetTabTitle ${psSingleQuoted(request.targetTabTitle)}` : ''
      ].filter(Boolean).join(' ');
  const command = [
    "$ErrorActionPreference='Stop'",
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    `$scriptPath = ${psSingleQuoted(scriptPath)}`,
    '$scriptText = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)',
    '$block = [scriptblock]::Create($scriptText)',
    invoke
  ].join('; ');
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')
  ];
}

function run(request) {
  if (process.platform !== 'win32') throw new Error('browser_ui_tabstrip_windows_only');
  const result = spawnSync('powershell.exe', powershellArgs(request), {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.status !== 0) throw new Error(stderr || stdout || `browser_ui_tabstrip_exit_${result.status}`);
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
  ACTIONS,
  parseArgs,
  validateRequest,
  preflightText,
  psSingleQuoted,
  powershellArgs,
  run,
  main
};
