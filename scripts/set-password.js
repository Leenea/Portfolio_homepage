// 관리자 비밀번호 설정/변경: npm run set-password
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const store = require('../lib/store');

store.load();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.stdoutMuted = false;
const origWrite = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => origWrite(rl.stdoutMuted ? '' : s);

rl.question('새 관리자 비밀번호 (8자 이상): ', (pw) => {
  rl.stdoutMuted = false;
  console.log('');
  if (pw.length < 8) {
    console.log('8자 이상으로 입력해 주세요.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  fs.writeFileSync(store.ADMIN_FILE, JSON.stringify({ salt, hash }), { mode: 0o600 });
  console.log('저장했어요. 서버를 다시 켜면 이전 로그인은 모두 풀려요.');
  rl.close();
});
rl.stdoutMuted = true;
