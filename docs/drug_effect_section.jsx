import { useState } from "react";

const weeks = ["3주전", "2주전", "지난주", "이번주"];

// 사용자가 설정한 약효 추적 알림 시간: 30분, 2시간
// 해당 알림 통해 입력한 기록만 포함
const drugEffectData = {
  // 이번 주 시간대별 평균 점수 (알림 기준 입력만)
  current: {
    "복용 직후": { body: 2.1, mood: 2.3 },
    "30분 후":   { body: 3.8, mood: 3.5 },
    "2시간 후":  { body: 3.2, mood: 3.0 },
  },
  // 4주 트렌드 (각 시간대별 주간 평균)
  trend: {
    "복용 직후": [2.0, 2.1, 2.0, 2.1],
    "30분 후":   [3.2, 3.4, 3.6, 3.8],
    "2시간 후":  [2.8, 2.9, 3.0, 3.2],
  },
};

const timeColors = {
  "복용 직후": "#F44336",
  "30분 후":   "#4CAF50",
  "2시간 후":  "#2196F3",
};

const scoreColor = (score) =>
  score >= 4 ? "#4CAF50" : score >= 3 ? "#FF9800" : "#F44336";

const TrendBadge = ({ trend }) => {
  const diff = parseFloat((trend[trend.length - 1] - trend[trend.length - 2]).toFixed(1));
  const same = Math.abs(diff) < 0.1;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      color: same ? "#999" : diff > 0 ? "#4CAF50" : "#F44336",
      marginLeft: 6,
    }}>
      {same ? "→ 유지" : diff > 0 ? `↑ ${Math.abs(diff)}점` : `↓ ${Math.abs(diff)}점`}
    </span>
  );
};

const BarChart = ({ values, color, max = 5, labels }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 56 }}>
    {values.map((v, i) => (
      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 9, color: "#888" }}>{v.toFixed(1)}</span>
        <div style={{
          width: "100%",
          height: `${Math.max((v / max) * 40, 3)}px`,
          backgroundColor: color,
          borderRadius: 3,
          opacity: 0.85,
        }} />
        <span style={{ fontSize: 9, color: "#aaa" }}>{labels[i]}</span>
      </div>
    ))}
  </div>
);

const Divider = () => <div style={{ height: 1, background: "#f0f0f0", margin: "12px 0" }} />;

export default function DrugEffectSection() {
  const [selected, setSelected] = useState("몸 상태");
  const tabs = ["몸 상태", "기분 상태"];
  const key = selected === "몸 상태" ? "body" : "mood";

  return (
    <div style={{
      maxWidth: 390,
      margin: "0 auto",
      background: "#f5f5f7",
      minHeight: "100vh",
      fontFamily: "sans-serif",
      padding: 16,
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
      }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>📈</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#222" }}>약효 패턴</span>
        </div>
        <p style={{ fontSize: 11, color: "#bbb", margin: "0 0 14px" }}>
          ※ 약효 추적 알림(30분, 2시간) 통해 입력한 기록만 반영
        </p>

        {/* 몸상태 / 기분상태 탭 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setSelected(t)} style={{
              padding: "5px 14px", borderRadius: 20, border: "none",
              background: selected === t ? "#333" : "#eee",
              color: selected === t ? "#fff" : "#666",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>{t}</button>
          ))}
        </div>

        {/* 이번 주 시간대별 현황 */}
        <p style={{ fontSize: 12, color: "#666", fontWeight: 600, margin: "0 0 10px" }}>이번 주 시간대별 평균</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {Object.entries(drugEffectData.current).map(([time, scores]) => {
            const score = scores[key];
            return (
              <div key={time} style={{
                flex: 1,
                background: "#f9f9f9",
                borderRadius: 12,
                padding: "10px 8px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                borderTop: `3px solid ${scoreColor(score)}`,
              }}>
                <span style={{ fontSize: 10, color: "#999", textAlign: "center" }}>{time}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: scoreColor(score) }}>{score.toFixed(1)}</span>
                <span style={{ fontSize: 9, color: scoreColor(score) }}>
                  {score >= 4 ? "좋음" : score >= 3 ? "보통" : "나쁨"}
                </span>
              </div>
            );
          })}
        </div>

        {/* 흐름 화살표 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 6 }}>
          {Object.entries(drugEffectData.current).map(([time, scores], i, arr) => (
            <div key={time} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: timeColors[time],
              }} />
              {i < arr.length - 1 && (
                <span style={{ fontSize: 12, color: "#ccc" }}>→</span>
              )}
            </div>
          ))}
          <span style={{ fontSize: 10, color: "#bbb", marginLeft: 8 }}>복용 후 시간 흐름</span>
        </div>

        <Divider />

        {/* 4주 트렌드 */}
        <p style={{ fontSize: 12, color: "#666", fontWeight: 600, margin: "0 0 12px" }}>4주 트렌드</p>
        {Object.entries(drugEffectData.trend).map(([time, values]) => (
          <div key={time} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: timeColors[time], marginRight: 6 }} />
              <span style={{ fontSize: 12, color: "#555", fontWeight: 600 }}>{time}</span>
              <TrendBadge trend={values} />
            </div>
            <BarChart values={values} color={timeColors[time]} max={5} labels={weeks} />
          </div>
        ))}

      </div>
    </div>
  );
}
