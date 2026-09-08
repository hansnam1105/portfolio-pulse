/**
 * `Disclaimer` — spec 0002 §2.5. One line, caption size, muted; present on `/`
 * and `/holdings/[id]`. The app describes and contextualizes, it does not
 * advise (spec 0001 § Computational Integrity). Not dismissible.
 */
export function Disclaimer() {
  return (
    <p className="disclaimer">
      본 화면은 정보 제공을 목적으로 하며 투자 자문이 아닙니다.
      <br />
      모든 수치는 업로드된 자료와 시세 제공자 데이터를 기반으로 계산됩니다.
    </p>
  );
}
