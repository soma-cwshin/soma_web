/** maps / chains 공통 — 헬스·PT 리스트에서 제외할 업종 */

function isFoodLead(lead) {
  const name = String(lead?.name || '');
  const addr = String(lead?.address || '');
  const blob = `${name} ${addr}`.toLowerCase();

  if (/머슬카페|카페\s*피트니스|피트니스\s*카페|헬스\s*카페/i.test(blob)) return false;

  if (/^샐러디\b|샐러디\s/i.test(name)) return true;
  if (/poke\s*all\s*day/i.test(name)) return true;
  if (/포케\s*[&＆]\s*샐러드|포케&샐러드/i.test(name)) return true;
  if (/\b포케\b/i.test(name) && !/피트니스|헬스|pt|피티|짐|gym|fitness|휘트니스/i.test(blob)) return true;

  if (/\b카페\b/.test(name) && !/피트니스|헬스|pt|피티|짐|gym|fitness|휘트니스|머슬/i.test(blob)) return true;
  if (/음식점|치킨|피자|버거킹|맥도날드|베이커리|베이글|브런치|분식|떡볶이|김밥|순대|족발|보쌈|고깃집|삼겹|회\s*전문|초밥|스시|라멘|국밥|맛집/.test(blob)) return true;

  return false;
}

module.exports = { isFoodLead };
