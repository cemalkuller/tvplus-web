import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Each playback owns an isolated playlist. Serving a playlist must not stop its encoder.
export function createVodHls(app, killProcessTree) {
  const sessions = new Map();
  const owners = new Map();

  function stop(sid) {
    const session = owners.get(sid);
    if (!session) return;
    owners.delete(sid);
    sessions.delete(session.id);
    session.stopped = true;
    killProcessTree(session.proc);
    const remove = () => fs.promises.rm(session.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    if (session.closed || session.proc.exitCode !== null || session.proc.signalCode) void remove();
    else session.proc.once('close', remove);
  }

  const sweep = setInterval(() => {
    for (const session of sessions.values()) {
      if (Date.now() - session.touched > 120000) stop(session.sid);
    }
  }, 15000);
  sweep.unref();

  app.get('/vod/hls/:id/:file', async (req, res) => {
    const session = sessions.get(req.params.id);
    const file = req.params.file;
    if (!session || !/^(index\.m3u8|segment\d+\.ts)$/.test(file)) return res.sendStatus(404);
    session.touched = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type(file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    if (file === 'index.m3u8') {
      try {
        const playlist = await fs.promises.readFile(path.join(session.dir, file), 'utf8');
        return res.send(playlist.replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES'));
      } catch (_) { return res.sendStatus(404); }
    }
    res.sendFile(path.join(session.dir, file), err => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  });

  async function start(req, res, sid, encodingArgs) {
    stop(sid);
    const id = randomUUID();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvplus-hls-'));
    const args = [...encodingArgs];
    // Limit disk growth and source reads to playback speed.
    args.splice(args.indexOf('-i'), 0, '-re');
    args.push('-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file', '-hls_segment_filename',
      path.join(dir, 'segment%06d.ts'), path.join(dir, 'index.m3u8'));
    const proc = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const session = { id, sid, dir, proc, touched: Date.now(), stopped: false, failed: false, closed: false };
    sessions.set(id, session);
    owners.set(sid, session);
    // Consume stderr without exposing provider URLs or account credentials.
    proc.stderr.on('data', () => {});
    proc.on('error', () => { session.failed = true; });
    proc.on('close', code => { session.closed = true; session.failed ||= code !== 0; });
    let handedOff = false;
    const cancel = () => { if (!handedOff && owners.get(sid) === session) stop(sid); };
    res.once('close', cancel);
    try {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !session.stopped && !res.destroyed) {
        let playlist = '';
        try { playlist = await fs.promises.readFile(path.join(dir, 'index.m3u8'), 'utf8'); } catch (_) {}
        // Safari needs several complete segments before starting reliably.
        const segments = (playlist.match(/#EXTINF:/g) || []).length;
        if (segments >= 3 || (session.closed && !session.failed && segments > 0)) {
          handedOff = true;
          res.removeListener('close', cancel);
          res.setHeader('Cache-Control', 'no-store');
          res.redirect(302, `/vod/hls/${id}/index.m3u8`);
          return;
        }
        if (session.failed || session.closed) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (owners.get(sid) === session) stop(sid);
      if (!res.destroyed && !res.writableEnded) res.status(502).type('text').send('Film akışı hazırlanamadı. Lütfen tekrar deneyin.');
    } catch (_) {
      if (owners.get(sid) === session) stop(sid);
      if (!res.destroyed && !res.headersSent) res.sendStatus(500);
    }
  }

  return { start, stop, close() {
    clearInterval(sweep);
    for (const sid of [...owners.keys()]) stop(sid);
  } };
}
