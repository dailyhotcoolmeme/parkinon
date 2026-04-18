import { useState } from "react";

const colors = {
  primary: "#4CAF50",
  dark: "#2E7D32",
  light: "#E8F5E9",
  accent: "#FF9800",
  danger: "#F44336",
  bg: "#F5F5F5",
  white: "#FFFFFF",
  text: "#111111",
  textSub: "#666666",
  textHint: "#AAAAAA",
  border: "#EEEEEE",
};

export default function DesignSystem() {
  const [checked, setChecked] = useState(true);

  return (
    <div style={{ background: colors.bg, minHeight: "100vh", fontFamily: "sans-serif", maxWidth: 390, margin: "0 auto" }}>

      {/* 탑바 */}
      <div style={{ background: colors.white, padding: "18px 20px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 22, color: colors.text }}>≡</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>파킨온</span>
        <span style={{ fontSize: 22, color: colors.text }}>📅</span>
      </div>

      <div style={{ padding: 16 }}>

        {/* 컬러 팔레트 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>COLOR PALETTE</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { name: "Primary", color: "#4CAF50" },
              { name: "Dark", color: "#2E7D32" },
              { name: "Light", color: "#E8F5E9" },
              { name: "Accent", color: "#FF9800" },
              { name: "Danger", color: "#F44336" },
            ].map(c => (
              <div key={c.name} style={{ textAlign: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: 12, background: c.color, marginBottom: 6, border: "1px solid #eee" }} />
                <p style={{ fontSize: 10, color: colors.textSub }}>{c.name}</p>
                <p style={{ fontSize: 9, color: colors.textHint }}>{c.color}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 타이포그래피 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>TYPOGRAPHY</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: colors.text, marginBottom: 8 }}>제목 24sp Bold</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: colors.text, marginBottom: 8 }}>소제목 20sp Bold</p>
          <p style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8 }}>본문 18sp Semibold</p>
          <p style={{ fontSize: 16, color: colors.text, marginBottom: 8 }}>본문 16sp Regular</p>
          <p style={{ fontSize: 14, color: colors.textSub, marginBottom: 8 }}>보조 텍스트 14sp</p>
          <p style={{ fontSize: 12, color: colors.textHint }}>힌트 텍스트 12sp</p>
        </div>

        {/* 버튼 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>BUTTONS</p>

          <button style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none",
            background: colors.primary, color: "#fff",
            fontSize: 18, fontWeight: 700, marginBottom: 10, cursor: "pointer",
          }}>💊 약 먹었어요</button>

          <button style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none",
            background: colors.dark, color: "#fff",
            fontSize: 18, fontWeight: 700, marginBottom: 10, cursor: "pointer",
          }}>저장하기</button>

          <button style={{
            width: "100%", padding: "16px", borderRadius: 12,
            border: `2px solid ${colors.primary}`, background: "#fff",
            color: colors.primary, fontSize: 18, fontWeight: 700, marginBottom: 10, cursor: "pointer",
          }}>나중에 할게요</button>

          <button style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none",
            background: "#eee", color: colors.textHint,
            fontSize: 18, fontWeight: 700, cursor: "default",
          }}>비활성화 버튼</button>
        </div>

        {/* 카드 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>CARDS</p>

          {/* 복용 현황 카드 */}
          <div style={{ background: colors.light, borderRadius: 12, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>아침약 복용</span>
              <span style={{ fontSize: 15, color: colors.primary, fontWeight: 700 }}>✓ 완료 08:03</span>
            </div>
          </div>

          <div style={{ background: "#f9f9f9", borderRadius: 12, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>점심약 복용</span>
              <span style={{ fontSize: 15, color: colors.textHint }}>□ 미완료</span>
            </div>
          </div>

          {/* 경고 카드 */}
          <div style={{ background: "#FFF3E0", borderRadius: 12, padding: 16, borderLeft: `4px solid ${colors.accent}` }}>
            <span style={{ fontSize: 16, color: "#E65100", fontWeight: 600 }}>⚠️ 중복된 약이 있어요. 확인해주세요.</span>
          </div>
        </div>

        {/* 입력 필드 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>INPUT FIELDS</p>

          <p style={{ fontSize: 16, color: colors.text, fontWeight: 600, marginBottom: 6 }}>이름</p>
          <div style={{ border: `1.5px solid ${colors.primary}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
            <span style={{ fontSize: 18, color: colors.text }}>홍길동</span>
          </div>

          <p style={{ fontSize: 16, color: colors.text, fontWeight: 600, marginBottom: 6 }}>출생연도</p>
          <div style={{ border: `1.5px solid ${colors.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 18, color: colors.text }}>1955년</span>
            <span style={{ fontSize: 18, color: colors.textSub }}>▼</span>
          </div>
        </div>

        {/* 선택 버튼 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>SELECTION</p>

          <p style={{ fontSize: 16, color: colors.text, fontWeight: 600, marginBottom: 10 }}>성별</p>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, padding: "14px", borderRadius: 10, border: `2px solid ${colors.primary}`, background: colors.light, textAlign: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: colors.dark }}>● 남자</span>
            </div>
            <div style={{ flex: 1, padding: "14px", borderRadius: 10, border: `1.5px solid ${colors.border}`, textAlign: "center" }}>
              <span style={{ fontSize: 18, color: colors.textSub }}>○ 여자</span>
            </div>
          </div>

          <p style={{ fontSize: 16, color: colors.text, fontWeight: 600, marginBottom: 10 }}>1~5점 선택</p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {[1,2,3,4,5].map(n => (
              <div key={n} style={{
                flex: 1, height: 52, borderRadius: 10,
                border: n === 4 ? `2px solid ${colors.primary}` : `1.5px solid ${colors.border}`,
                background: n === 4 ? colors.light : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 20, fontWeight: n === 4 ? 700 : 400, color: n === 4 ? colors.dark : colors.textSub }}>{n}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 토글 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>TOGGLE</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>약 복용 알림</p>
              <p style={{ fontSize: 14, color: colors.textSub }}>약 드실 시간이 되면 알려드려요</p>
            </div>
            <div onClick={() => setChecked(!checked)} style={{
              width: 52, height: 30, borderRadius: 15,
              background: checked ? colors.primary : "#ccc",
              cursor: "pointer", position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 3,
                left: checked ? 25 : 3,
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
          </div>
        </div>

        {/* 탭바 예시 */}
        <div style={{ background: colors.white, borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: colors.textSub, fontWeight: 700, marginBottom: 14 }}>TAB BAR</p>
          <div style={{ display: "flex", justifyContent: "space-around", padding: "10px 0" }}>
            {[
              { icon: "💊", label: "약복용", active: true },
              { icon: "😊", label: "몸상태", active: false },
              { icon: "🏃", label: "운동", active: false },
              { icon: "📰", label: "정보/나눔", active: false },
            ].map(tab => (
              <div key={tab.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 26, marginBottom: 4 }}>{tab.icon}</div>
                <p style={{ fontSize: 12, fontWeight: tab.active ? 700 : 400, color: tab.active ? colors.primary : colors.textHint }}>{tab.label}</p>
                {tab.active && <div style={{ width: 4, height: 4, borderRadius: "50%", background: colors.primary, margin: "4px auto 0" }} />}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
