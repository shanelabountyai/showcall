import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Modelled on saas-foundation (Next core-web-vitals + typescript) and on
// bookable-appointment-service's axis-crossing bans (D-052).
//
// CLAUDE.md hard rule 3: times are minute-of-day on a LocalDate in the event's
// timezone (src/time.ts), and "now" comes from the injected clock
// (src/clock.ts). Each pattern below is a silent crossing between the calendar
// axis and the instant axis through the PROCESS timezone, or a clock read that
// bypasses the injected one.
const dateAxisBans = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Bare new Date() reads the system clock. Take "now" from the injected Clock (src/clock.ts).',
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: 'Date.now() reads the system clock. Take "now" from the injected Clock (src/clock.ts).',
    },
    {
      // A date-only literal parses as UTC midnight and a date-time literal with
      // no offset parses in the PROCESS timezone; either way a wall-clock
      // reading becomes an instant. A literal with Z or an offset is an
      // instant already and stays allowed.
      selector: "NewExpression[callee.name='Date'][arguments.0.type='Literal'][arguments.0.value=/^\\d{4}-/]:not([arguments.0.value=/(Z|[+-]\\d{2}:?\\d{2})$/])",
      message: "new Date('YYYY-MM-DD…') with no offset turns a calendar reading into an instant. Use toDbDate() from src/time.ts for a day, or write the instant with Z.",
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
      message: 'Date.parse crosses the calendar/instant axis. Use src/time.ts.',
    },
    {
      selector: "CallExpression[callee.property.name=/^(get|set)(Hours|Minutes|Seconds|Milliseconds|Date|Month|FullYear|Day)$/]",
      message: 'Local-time Date accessors read/write through the process timezone. Use localNow()/minute-of-day from src/time.ts.',
    },
    {
      selector: "CallExpression[callee.property.name='getTimezoneOffset']",
      message: 'getTimezoneOffset reads the process timezone, not the event\'s. Use src/time.ts.',
    },
    {
      // slice(0, 16) + ' UTC' is an honest UTC stamp of an instant and stays allowed.
      selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString'][arguments.1.value=10]",
      message: 'toISOString().slice(0,10) derives a calendar day from an instant in UTC, not the venue. Use fromDbDate/localNow from src/time.ts.',
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      ...dateAxisBans,
      // `_`-prefixed names are the repo's idiom for "destructured to drop it".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // The sanctioned boundaries: src/time.ts is the one module that converts
    // between LocalDate and Date, src/clock.ts is the one source of "now".
    files: ['src/time.ts', 'src/clock.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/generated/**', 'test-results/**', 'playwright-report/**']),
]);
