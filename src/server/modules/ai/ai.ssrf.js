// ============================================================================
// Kairo — Proteção anti-SSRF para conexões de IA (Tarefa 15)
// ----------------------------------------------------------------------------
// Valida protocolo e host, bloqueia metadados de nuvem e faixas reservadas,
// permite loopback/LAN apenas para provedores locais e mantém uma allowlist
// administrativa para hosts remotos. Resolve o host (DNS) para impedir
// rebinding: a decisão usa o IP realmente resolvido, não só o texto da URL.
// ============================================================================

import net from 'node:net';
import dns from 'node:dns/promises';

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.code = 'HOST_BLOQUEADO';
  }
}

// Endpoints de metadados de nuvem — SEMPRE bloqueados, em qualquer modo.
const CLOUD_METADATA_HOSTS = Object.freeze(
  new Set([
    '169.254.169.254', // AWS, Azure, GCP, OpenStack
    'fd00:ec2::254', // AWS IMDS IPv6
    'metadata.google.internal',
    'metadata.goog'
  ])
);

const PROTOCOLOS_PERMITIDOS = Object.freeze(new Set(['http:', 'https:']));

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function dentroDeCidr(ip, base, mask) {
  const ipLong = ipToLong(ip);
  const baseLong = ipToLong(base);
  const maskLong = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (ipLong & maskLong) === (baseLong & maskLong);
}

// Faixas IPv4 privadas/reservadas (uso interno/LAN).
function ehIpv4Privado(ip) {
  return (
    dentroDeCidr(ip, '10.0.0.0', 8) ||
    dentroDeCidr(ip, '172.16.0.0', 12) ||
    dentroDeCidr(ip, '192.168.0.0', 16) ||
    dentroDeCidr(ip, '169.254.0.0', 16) || // link-local
    dentroDeCidr(ip, '100.64.0.0', 10) || // CGNAT
    dentroDeCidr(ip, '198.18.0.0', 15) // benchmarking
  );
}

function ehLoopback(ip, version) {
  if (version === 4) return dentroDeCidr(ip, '127.0.0.0', 8);
  return ip === '::1';
}

function ehIpv6InternoOuMapeado(ip) {
  const normalizado = ip.toLowerCase();
  if (normalizado === '::1' || normalizado === '::') return true;
  if (normalizado.startsWith('fc') || normalizado.startsWith('fd')) return true; // ULA
  if (normalizado.startsWith('fe80')) return true; // link-local
  // IPv4 mapeado em IPv6 (::ffff:a.b.c.d)
  const mapeado = normalizado.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ehIpv4Privado(mapeado[1]) || ehLoopback(mapeado[1], 4);
  return false;
}

function classificarIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    return {
      version: 4,
      loopback: ehLoopback(ip, 4),
      privado: ehIpv4Privado(ip),
      metadados: CLOUD_METADATA_HOSTS.has(ip)
    };
  }
  if (version === 6) {
    return {
      version: 6,
      loopback: ehLoopback(ip, 6),
      privado: ehIpv6InternoOuMapeado(ip),
      metadados: CLOUD_METADATA_HOSTS.has(ip.toLowerCase())
    };
  }
  return null;
}

/**
 * Valida a URL base de uma conexão de IA e devolve o host/porta seguros.
 *
 * @param {string} baseUrl URL base configurada.
 * @param {object} options
 * @param {boolean} options.isLocal Conexão local (permite loopback/LAN).
 * @param {string[]} options.allowlist Hosts remotos explicitamente liberados.
 * @param {(host:string)=>Promise<string[]>} options.resolver Resolução DNS (injetável em teste).
 */
export async function assertSafeAiUrl(
  baseUrl,
  { isLocal = false, allowlist = [], resolver = null } = {}
) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new SsrfError('A URL da conexão é inválida.');
  }

  if (!PROTOCOLOS_PERMITIDOS.has(url.protocol)) {
    throw new SsrfError('Somente os protocolos http e https são permitidos.');
  }
  if (url.username || url.password) {
    throw new SsrfError('Credenciais embutidas na URL não são permitidas.');
  }

  const host = url.hostname.toLowerCase();

  // Metadados de nuvem são bloqueados incondicionalmente.
  if (CLOUD_METADATA_HOSTS.has(host)) {
    throw new SsrfError('Acesso a endpoints de metadados de nuvem é proibido.');
  }

  const allowSet = new Set(allowlist.map((item) => String(item).toLowerCase()));
  const hostLiberadoPorAllowlist = allowSet.has(host);

  // Determina os IPs de destino: literais são usados diretamente; nomes são
  // resolvidos por DNS para impedir rebinding.
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const resolve =
      resolver || (async (nome) => (await dns.lookup(nome, { all: true })).map((r) => r.address));
    try {
      ips = await resolve(host);
    } catch {
      throw new SsrfError('Não foi possível resolver o host da conexão.');
    }
    if (!ips || ips.length === 0) {
      throw new SsrfError('O host da conexão não resolveu para nenhum endereço.');
    }
  }

  for (const ip of ips) {
    const classe = classificarIp(ip);
    if (!classe) throw new SsrfError('Endereço de destino inválido.');
    if (classe.metadados) {
      throw new SsrfError('Acesso a endpoints de metadados de nuvem é proibido.');
    }

    const interno = classe.loopback || classe.privado;
    if (interno) {
      // Loopback/LAN só é permitido para provedores locais.
      if (!isLocal) {
        throw new SsrfError(
          'Endereços internos/reservados só são permitidos para provedores locais.'
        );
      }
    } else if (!isLocal && !hostLiberadoPorAllowlist) {
      // Host público remoto exige liberação explícita na allowlist administrativa.
      throw new SsrfError('Host remoto não está na allowlist administrativa de provedores de IA.');
    }
  }

  return {
    host,
    protocol: url.protocol,
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    resolvedIps: ips
  };
}
