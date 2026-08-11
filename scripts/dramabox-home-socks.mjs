#!/usr/bin/env node
/**
 * Minimal localhost SOCKS5 (no-auth, CONNECT only) for DramaBox reverse tunnel.
 * Bind: 127.0.0.1 only. Egress = this machine's residential IP.
 *
 * Usage: node scripts/dramabox-home-socks.mjs
 * Env:   DRAMABOX_HOME_SOCKS_PORT=18080
 */
import net from 'net';

const PORT = Number(process.env.DRAMABOX_HOME_SOCKS_PORT || 18080);
const HOST = '127.0.0.1';

function fail(client, rep = 0x05) {
  try {
    client.end(Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
  } catch {
    client.destroy();
  }
}

function parseConnect(req) {
  if (req.length < 7 || req[0] !== 0x05 || req[1] !== 0x01) {
    return null;
  }
  const atyp = req[3];
  if (atyp === 0x01) {
    if (req.length < 10) return null;
    const host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
    const port = req.readUInt16BE(8);
    return { host, port, hdrLen: 10 };
  }
  if (atyp === 0x03) {
    const len = req[4];
    if (req.length < 7 + len) return null;
    const host = req.slice(5, 5 + len).toString('utf8');
    const port = req.readUInt16BE(5 + len);
    return { host, port, hdrLen: 7 + len };
  }
  return null;
}

const server = net.createServer((client) => {
  client.on('error', () => client.destroy());
  client.once('data', (greeting) => {
    if (!greeting.length || greeting[0] !== 0x05) {
      client.destroy();
      return;
    }
    client.write(Buffer.from([0x05, 0x00]));
    client.once('data', (req) => {
      const parsed = parseConnect(req);
      if (!parsed) {
        fail(client, 0x07);
        return;
      }
      const remote = net.connect(parsed.port, parsed.host);
      remote.on('connect', () => {
        const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        client.write(reply);
        if (req.length > parsed.hdrLen) {
          remote.write(req.slice(parsed.hdrLen));
        }
        client.pipe(remote);
        remote.pipe(client);
      });
      remote.on('error', () => fail(client, 0x05));
      client.on('close', () => remote.destroy());
      remote.on('close', () => client.destroy());
    });
  });
});

server.on('error', (err) => {
  console.error('[dramabox-home-socks]', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[dramabox-home-socks] socks5://${HOST}:${PORT}`);
});
