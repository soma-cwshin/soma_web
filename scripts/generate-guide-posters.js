const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ff = require('@ffmpeg-installer/ffmpeg').path;
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'images', 'guide', 'posters');

const videos = [
  { id: 't-signup', src: 'images/강사가 보는 화면/강사 회원가입.mp4' },
  { id: 't-center', src: 'images/강사가 보는 화면/센터 정보 설정하기.mp4' },
  { id: 't-member-pass', src: 'images/강사가 보는 화면/회원 및 수강권 등록.mp4' },
  { id: 't-invite', src: 'images/강사가 보는 화면/회원 소마로 초대해서 가입시키기.mp4' },
  { id: 't-book-home', src: 'images/강사가 보는 화면/홈에서 수업 예약.mp4' },
  { id: 't-book-cal', src: 'images/강사가 보는 화면/캘린더에서 수업 예약.mp4' },
  { id: 't-book-chat', src: 'images/강사가 보는 화면/채팅에서 수업예약.mp4' },
  { id: 't-reschedule', src: 'images/강사가 보는 화면/수업 변경(홈, 캘린더).mp4' },
  { id: 't-cancel', src: 'images/강사가 보는 화면/수업 취소.mp4' },
  { id: 'm-signup', src: 'images/회원이 보는 화면/회원 회원가입시.mp4' },
  { id: 'm-accept', src: 'images/회원이 보는 화면/수업 수락시 변경되는 상태값.mp4' },
  { id: 'm-change', src: 'images/회원이 보는 화면/수업 예약정보 변경시.mp4' },
  { id: 'm-cancel', src: 'images/회원이 보는 화면/수업 취소 시.mp4' }
];

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const video of videos) {
  const input = path.join(root, video.src);
  const output = path.join(outDir, video.id + '.jpg');

  if (!fs.existsSync(input)) {
    console.warn('skip (missing):', video.src);
    continue;
  }

  execFileSync(ff, [
    '-ss', '1',
    '-i', input,
    '-vframes', '1',
    '-q:v', '3',
    '-vf', 'scale=720:-2',
    output,
    '-y'
  ], { stdio: 'inherit' });

  console.log('wrote', path.relative(root, output));
}
