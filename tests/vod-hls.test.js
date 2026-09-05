import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawn } from 'node:child_process';
import { createVodHls } from '../vod-hls.js';

function kill(proc) {
  if (proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else proc.kill('SIGKILL');
}

test('native HLS: playable playlist, TS ranges, isolated sessions and cleanup', { timeout: 45000 }, async () => {
  const app = express();
  const hls = createVodHls(app, kill);
  app.get('/broken', (req, res) => hls.start(req, res, 'broken', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'nonexistent_test_filter'
  ]));
  app.get('/start/:sid', (req, res) => hls.start(req, res, req.params.sid, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=25', '-t', '8',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:gte(t,n_forced*2)'
  ]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/start/test`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/vnd.apple.mpegurl/);
    const playlist = await response.text();
    assert.match(playlist, /#EXT-X-START:TIME-OFFSET=0/);
    assert.match(playlist, /#EXT-X-INDEPENDENT-SEGMENTS/);
    const segments = playlist.split('\n').filter(line => /^segment\d+\.ts$/.test(line));
    assert.ok(segments.length >= 3);
    const segmentUrl = new URL(segments[0], response.url);
    const segment = await fetch(segmentUrl);
    assert.equal(segment.status, 200);
    assert.match(segment.headers.get('content-type'), /video\/mp2t/);
    const body = new Uint8Array(await segment.arrayBuffer());
    assert.equal(body[0], 0x47); // MPEG transport stream sync byte.
    assert.equal(body.length % 188, 0);
    const range = await fetch(segmentUrl, { headers: { Range: 'bytes=0-1' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 2);
    assert.equal((await fetch(new URL('unknown.ts', response.url))).status, 404);
    const replacement = await fetch(`${base}/start/test`);
    assert.notEqual(replacement.url, response.url);
    await replacement.text();
    assert.equal((await fetch(response.url)).status, 404);
    hls.stop('test');
    assert.equal((await fetch(replacement.url)).status, 404);
    const failed = await fetch(`${base}/broken`);
    assert.equal(failed.status, 502);
    assert.match(await failed.text(), /Film akışı hazırlanamadı/);
  } finally {
    hls.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
