/* 해시 생성기 (?hashgen=1) */
import { svg } from '../icons.js';
import { $, hashPassword, normPhone } from '../util.js';

/* ═══════════ 해시 생성기 ═══════════ */
/* 최초 관리자 계정을 SQL로 수동 발급할 때만 쓰는 도구(?hashgen=1).
   Phase 3에서 Supabase Auth·bcrypt로 전환하면서 제거 예정. */
function initHashgen(){
  $('loginView').style.display='none';$('appView').style.display='none';$('hashgenView').style.display='block';
  $('hgIcon').innerHTML=svg('settings');
  $('hgBtn').addEventListener('click',async()=>{const phone=normPhone($('hgPhone').value),pw=$('hgPw').value;
    if(!phone||!pw){$('hgOut').textContent='전화번호와 비밀번호를 입력하세요.';return;}
    const hash=await hashPassword(phone,pw);$('hgOut').textContent=hash;
    $('hgSql').textContent=`insert into accounts (phone, password_hash, role)\nvalues ('${phone}', '${hash}', 'admin');`;});
}

export { initHashgen };
