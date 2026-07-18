import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS = Object.freeze([
  {
    label: 'chave privada',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/
  },
  {
    label: 'chave de acesso AWS',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    label: 'token pessoal do GitHub',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/
  },
  {
    label: 'chave de API OpenAI',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/
  },
  {
    label: 'chave de API Google',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    label: 'token Slack',
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/
  },
  {
    label: 'chave secreta Stripe',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}\b/
  }
]);

function normalizeRepositoryPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function artifactPolicyViolations(filePath) {
  const normalizedPath = normalizeRepositoryPath(filePath);
  const basename = path.posix.basename(normalizedPath).toLowerCase();
  const violations = [];

  if (basename.startsWith('.env') && !basename.endsWith('.example')) {
    violations.push('arquivo de ambiente real');
  }

  if (['.npmrc', '.pypirc', 'id_rsa', 'id_ed25519'].includes(basename)) {
    violations.push('arquivo conhecido por armazenar credenciais');
  }

  if (/\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i.test(normalizedPath)) {
    violations.push('banco de dados local');
  }

  if (/\.(?:log|pem|key|p12|pfx)$/i.test(normalizedPath)) {
    violations.push('log ou material criptográfico privado');
  }

  if (/(^|\/)(?:storage|coverage|test-results|playwright-report)(?:\/|$)/i.test(normalizedPath)) {
    violations.push('artefato local ou de execução');
  }

  if (/(^|\/)(?:credentials?|service-account)[^/]*\.json$/i.test(normalizedPath)) {
    violations.push('arquivo de credenciais estruturado');
  }

  return violations;
}

export function secretPolicyViolations(content) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(({ label }) => label);
}

function listRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );

  return output
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepositoryPath)
    .filter((filePath) => existsSync(filePath));
}

function readTextFileSafely(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length > MAX_TEXT_FILE_BYTES || buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

export function verifyRepository(files = listRepositoryFiles()) {
  const findings = [];

  for (const filePath of files) {
    for (const violation of artifactPolicyViolations(filePath)) {
      findings.push({ filePath, violation });
    }

    const content = readTextFileSafely(filePath);
    if (content === null) continue;

    for (const violation of secretPolicyViolations(content)) {
      findings.push({ filePath, violation });
    }
  }

  return findings;
}

const findings = verifyRepository();

if (findings.length > 0) {
  console.error('A política do repositório encontrou arquivos ou segredos proibidos:');
  for (const finding of findings) {
    console.error(`- ${finding.filePath}: ${finding.violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    'Política do repositório aprovada: nenhum segredo ou artefato proibido foi encontrado.'
  );
}
