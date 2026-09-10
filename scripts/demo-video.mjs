import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

const folder = path.join(ROOT, 'artifacts', 'demo');
await mkdir(folder, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit', windowsHide: true, timeout: 180000 });
if (process.argv[2] === 'prepare') {
  const source = 'gradients=size=864x486:rate=24:c0=0x050505:c1=0x111111:c2=0x1c1c1c:c3=0x090909:n=4:speed=0.003:type=radial,drawgrid=w=96:h=96:t=1:c=white@0.055,vignette=PI/5';
  run(['-f', 'lavfi', '-i', source, '-t', '90', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '700k', '-pix_fmt', 'yuv420p', path.join(folder, 'sample.webm')]);
} else if (process.argv[2] === 'compose') {
  const file = path.join(folder, 'interlude-beta-demo.mp4');
  const filter = "[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]hstack=inputs=2:shortest=1,pad=iw:ih+120:0:60:color=0x050505,drawbox=x=0:y=59:w=iw:h=1:color=0xcaff3d@0.45:t=fill,drawbox=x=0:y=ih-60:w=iw:h=1:color=0xcaff3d@0.45:t=fill,drawtext=text='INTERLUDE BETA':fontcolor=0xcaff3d:fontsize=28:x=32:y=17,drawtext=text='Two projects. One controlled break.':fontcolor=white:fontsize=28:x=310:y=17,drawtext=text='REAL dashboard + extension + media control  |  SIMULATED Codex events  |  Native focus mocked':fontcolor=0xa4a69f:fontsize=21:x=32:y=h-42";
  run(['-i', path.join(folder, 'dashboard.webm'), '-i', path.join(folder, 'media.webm'), '-filter_complex', filter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
  for (const [name, seconds] of [['poster', '11'], ['paused', '19'], ['learning', '31']]) run(['-ss', seconds, '-i', file, '-frames:v', '1', path.join(folder, `${name}.jpg`)]);
  const metadata = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
  if (Number(metadata.format.duration) < 30 || !(await stat(file)).size) throw new Error('Recording is incomplete.');
  await writeFile(path.join(folder, 'video-info.json'), JSON.stringify(metadata, null, 2));
  console.log(`Recorded ${Number(metadata.format.duration).toFixed(1)} seconds of the working integration.`);
} else throw new Error('Use prepare or compose. FFmpeg and ffprobe must be installed.');
