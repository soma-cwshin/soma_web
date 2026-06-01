const { execFileSync } = require('child_process');
const path = require('path');

const ff = require('@ffmpeg-installer/ffmpeg').path;
const cwd = path.join(__dirname, '..');
const inp = path.join(cwd, '나의 몸변화 AI 분석 리포트.mp4');
const out = path.join(cwd, 'videos', 'feature-body-report.mp4');

const fc = [
  '[0:v]split=3[base][a][b]',
  '[a]crop=400:54:44:392,gblur=sigma=24[blur1]',
  '[b]crop=400:56:44:568,gblur=sigma=24[blur2]',
  "[base][blur1]overlay=44:392:enable='between(t,2.7,5.3)'[v1]",
  "[v1][blur2]overlay=44:568:enable='between(t,2.7,5.3)'[vout]",
].join(';');

execFileSync(
  ff,
  [
    '-i',
    inp,
    '-filter_complex',
    fc,
    '-map',
    '[vout]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'fast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    out,
    '-y',
  ],
  { stdio: 'inherit' }
);

console.log('Wrote', out);
