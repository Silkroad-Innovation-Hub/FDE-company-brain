/**
 * Scaffolds a new Silkroad client instance: an empty vault, a librechat.yaml with the
 * client's company name in every spec prompt, and the .env lines the instance needs.
 *
 *   node config/new-client.js --name "Acme Corp" --short acme --email owner@acme.com
 *     [--vault ./brain-acme] [--source librechat.yaml] [--out librechat.acme.yaml]
 *     [--apply]     overwrite librechat.yaml (backs up librechat.yaml.bak)
 *     [--dry-run]   print everything, write nothing
 *
 * Specialist subagents (the seeded Anduril analysts) are per-client and optional:
 * seed the client's own with config/seed-silkroad-agents.js as a template.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_COMPANY = 'Anduril';
const SOURCE_COMPANY_FULL = 'Anduril Industries';
const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
]);

function parseArgs(argv) {
  const args = { apply: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--')) {
      args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
  }
  return args;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Replaces the source company name inside every spec prompt; nothing else changes. */
function buildClientConfig(doc, companyName) {
  const specs = doc?.modelSpecs?.list ?? [];
  const full = new RegExp(SOURCE_COMPANY_FULL, 'g');
  const short = new RegExp(`\\b${SOURCE_COMPANY}\\b`, 'g');
  const list = specs.map((spec) => {
    const prefix = spec?.preset?.promptPrefix;
    if (typeof prefix !== 'string') {
      return spec;
    }
    const promptPrefix = prefix.replace(full, companyName).replace(short, companyName);
    return { ...spec, preset: { ...spec.preset, promptPrefix } };
  });
  return { ...doc, modelSpecs: { ...doc.modelSpecs, list } };
}

function draftDomainsFor(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() ?? '';
  return PUBLIC_MAILBOX_DOMAINS.has(domain) ? '' : domain;
}

function envLines({ email, vaultPath, token }) {
  return [
    `SILKROAD_USER_EMAIL=${email}`,
    `BRAIN_VAULT_PATH=${vaultPath}`,
    `SILKROAD_SERVICE_TOKEN=${token}`,
    'SILKROAD_MONTHLY_EXPECTED_USD=50',
    `SILKROAD_DRAFT_DOMAINS=${draftDomainsFor(email)}`,
    'BRAIN_WRITE_APPROVAL=on',
  ];
}

function starterNote(companyName, email) {
  return `---\ntype: company\ntags: [client]\n---\n\n${companyName} — the company this Silkroad instance serves. Owner contact: ${email}.\n\n- Add the first facts here or let the brain distil them from chat, iMessage, and email.\n`;
}

function vaultReadme(companyName) {
  return `# ${companyName} — company brain\n\nObsidian-compatible vault read by Silkroad. One markdown note per entity, frontmatter \`type:\` (company, product, program, finance, person, facility, org, intel, note, invoice) and \`[[wikilinks]]\` between notes. The distiller writes here; edits made by hand are picked up automatically.\n`;
}

function run(argv, io = { log: console.log, generateToken: undefined }) {
  const args = parseArgs(argv);
  if (!args.name || !args.email) {
    throw new Error('--name and --email are required');
  }
  const short = args.short ? slugify(args.short) : slugify(args.name);
  const source = path.resolve(ROOT, args.source ?? 'librechat.yaml');
  const out = args.apply ? source : path.resolve(ROOT, args.out ?? `librechat.${short}.yaml`);
  const vaultPath = path.resolve(ROOT, args.vault ?? `brain-${short}`);
  const doc = yaml.load(fs.readFileSync(source, 'utf8'));
  const config = buildClientConfig(doc, args.name);
  const dumped = yaml.dump(config, { lineWidth: 100, noRefs: true, quotingType: "'" });
  const generateToken =
    io.generateToken ?? (() => require('@librechat/api').generateServiceToken());
  const env = envLines({ email: args.email, vaultPath, token: generateToken() });

  const plan = [
    `client:        ${args.name} (${short})`,
    `vault:         ${vaultPath}`,
    `config:        ${out}${args.apply ? ' (backup: librechat.yaml.bak)' : ''}`,
    '',
    '# add to .env',
    ...env,
    '',
    'Specialist subagents are per-client and optional — seed them with config/seed-silkroad-agents.js as a template.',
  ];
  if (args.dryRun) {
    io.log(['DRY RUN — nothing written', ...plan].join('\n'));
    return { short, vaultPath, out, env, config, written: false };
  }
  fs.mkdirSync(vaultPath, { recursive: true });
  const notePath = path.join(vaultPath, `${args.name}.md`);
  if (!fs.existsSync(notePath)) {
    fs.writeFileSync(notePath, starterNote(args.name, args.email));
  }
  fs.writeFileSync(path.join(vaultPath, 'README.md'), vaultReadme(args.name));
  if (args.apply && fs.existsSync(source)) {
    fs.copyFileSync(source, `${source}.bak`);
  }
  fs.writeFileSync(out, dumped);
  io.log(plan.join('\n'));
  return { short, vaultPath, out, env, config, written: true };
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { run, buildClientConfig, draftDomainsFor, envLines, parseArgs };
