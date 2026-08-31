const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { run, buildClientConfig, draftDomainsFor } = require('../new-client');

const sourceYaml = `modelSpecs:
  enforce: true
  list:
    - name: silkroad
      label: Silkroad
      description: Your company's AI.
      brainSearch: true
      subagents:
        enabled: true
        agent_ids: ['agent_anduril_finance']
      preset:
        endpoint: openAI
        model: gpt-5.5
        promptPrefix: >-
          You are Silkroad, the company brain for Anduril Industries. "me" means Anduril.
          Andurilite is not a word.
endpoints:
  agents:
    recursionLimit: 25
`;

describe('new-client', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silkroad-client-'));
    fs.writeFileSync(path.join(dir, 'librechat.yaml'), sourceYaml);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the company name in spec prompts only', () => {
    const doc = yaml.load(sourceYaml);
    const out = buildClientConfig(doc, 'Acme Corp');
    const spec = out.modelSpecs.list[0];
    expect(spec.preset.promptPrefix).toContain('company brain for Acme Corp.');
    expect(spec.preset.promptPrefix).toContain('"me" means Acme Corp.');
    expect(spec.preset.promptPrefix).toContain('Andurilite');
    expect(spec.subagents.agent_ids).toEqual(['agent_anduril_finance']);
    expect(spec.label).toBe('Silkroad');
    expect(out.endpoints.agents.recursionLimit).toBe(25);
  });

  it('derives the draft allowlist from the owner domain unless it is a public mailbox', () => {
    expect(draftDomainsFor('owner@acme.com')).toBe('acme.com');
    expect(draftDomainsFor('owner@gmail.com')).toBe('');
    expect(draftDomainsFor('Owner <owner@Sub.Acme.IO>'.split('<')[1].slice(0, -1))).toBe(
      'sub.acme.io',
    );
  });

  it('dry-run writes nothing; a real run writes vault, config, and env lines', () => {
    const log = jest.fn();
    const args = [
      '--name',
      'Acme Corp',
      '--short',
      'acme',
      '--email',
      'owner@acme.com',
      '--source',
      path.join(dir, 'librechat.yaml'),
      '--out',
      path.join(dir, 'librechat.acme.yaml'),
      '--vault',
      path.join(dir, 'brain-acme'),
    ];
    const io = { log, generateToken: () => 'tok' };

    const dry = run([...args, '--dry-run'], io);
    expect(dry.written).toBe(false);
    expect(fs.existsSync(path.join(dir, 'brain-acme'))).toBe(false);
    expect(log.mock.calls[0][0]).toContain('DRY RUN');

    const real = run(args, io);
    expect(real.written).toBe(true);
    expect(fs.existsSync(path.join(dir, 'brain-acme', 'Acme Corp.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'brain-acme', 'Acme Corp.md'), 'utf8')).toContain(
      'type: company',
    );
    const written = yaml.load(fs.readFileSync(path.join(dir, 'librechat.acme.yaml'), 'utf8'));
    expect(written.modelSpecs.list[0].preset.promptPrefix).toContain('Acme Corp');
    expect(written.modelSpecs.list[0].preset.promptPrefix).not.toContain('Anduril Industries');
    expect(written.modelSpecs.enforce).toBe(true);
    expect(real.env).toEqual(
      expect.arrayContaining([
        'SILKROAD_USER_EMAIL=owner@acme.com',
        'SILKROAD_SERVICE_TOKEN=tok',
        'SILKROAD_DRAFT_DOMAINS=acme.com',
        `BRAIN_VAULT_PATH=${path.join(dir, 'brain-acme')}`,
      ]),
    );
  });

  it('--apply overwrites the source after backing it up', () => {
    const source = path.join(dir, 'librechat.yaml');
    run(
      [
        '--name',
        'Acme',
        '--email',
        'o@acme.com',
        '--source',
        source,
        '--vault',
        path.join(dir, 'v'),
        '--apply',
      ],
      { log: jest.fn(), generateToken: () => 'tok' },
    );
    expect(fs.existsSync(`${source}.bak`)).toBe(true);
    expect(fs.readFileSync(source, 'utf8')).toContain('Acme');
    expect(fs.readFileSync(`${source}.bak`, 'utf8')).toContain('Anduril Industries');
  });
});
