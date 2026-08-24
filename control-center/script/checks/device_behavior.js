const { runCheck } = require('./run_check');

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randDelay = (base, range) => base + rand(0, range);

const stamp = Date.now().toString().slice(-6);
const email = `user${stamp}@test${rand(1,99)}.com`;
const password = `Pass${stamp}!${String.fromCharCode(rand(65,90))}`;

runCheck({
  name: 'device-browser-behavior',
  url: 'https://deviceandbrowserinfo.com/are_you_a_bot_interactions',
  loadWaitMs: randDelay(7000, 2000),
  resultWaitMs: randDelay(5000, 2000),

  interactions: [
    {
      action: 'waitForSelector',
      selector: 'body',
      timeoutMs: 10000,
      delay: () => randDelay(1000, 1500)
    },
    {
      action: 'clickFirstMatch',
      selectors: [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[placeholder*="email" i]'
      ],
      texts: [],
      offset: () => rand(2, 8),
      delay: () => randDelay(500, 700)
    },
    {
      action: 'type',
      text: email,
      delay: () => randDelay(350, 400)
    },
    {
      action: 'waitForSelector',
      selector: 'input[type="password"]',
      timeoutMs: 5000,
      delay: () => randDelay(600, 500)
    },
    {
      action: 'clickFirstMatch',
      selectors: [
        'input[type="password"]',
        'input[name*="pass" i]',
        'input[placeholder*="password" i]'
      ],
      texts: [],
      offset: () => rand(2, 8),
      delay: () => randDelay(500, 700)
    },
    {
      action: 'type',
      text: password,
      delay: () => randDelay(350, 400)
    },
    {
      action: 'clickFirstMatch',
      selectors: [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:not([type])'
      ],
      texts: ['login', 'sign in', 'submit', 'continue'],
      offset: () => rand(3, 10),
      delay: () => randDelay(650, 700)
    },
    {
      action: 'waitForSelector',
      selector: 'body',
      timeoutMs: 5000,
      delay: () => randDelay(1500, 1000)
    }
  ]
});
