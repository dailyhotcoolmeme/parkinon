import { useState } from "react";

const periods = ["이번 주", "이번 달", "최근 3개월"];

const prevLabels = {
  "이번 주": "지난주",
  "이번 달": "지난달",
  "최근 3개월": "지난 3개월",
};

const summaryData = {
  "이번 주": {
    medication: { current: 90, prev: 88, unit: "%" },
    bodyState: {
      "복용 직후": { current: 2.1, prev: 2.0 },
      "30분 후":   { current: 3.8, prev: 3.5 },
      "2시간 후":  { current: 3.2, prev: 3.0 },
    },
    mood: {
      "복용 직후": { current: 2.3, prev: 2.1 },
      "30분 후":   { current: 3.5, prev: 3.2 },
      "2시간 후":  { current: 3.0, prev: 2.9 },
    },
    sleep: { current: 3.6, prev: 3.2, unit: "점" },
    constipation: { current: "4일", prev: "3일", unit: "" },
    exercise: { current: "4회 / 95분", prev: "2회 / 60분", unit: "" },
  },
  "이번 달": {
    medication: { current: 88, prev: 85, unit: "%" },
    bodyState: {
      "복용 직후": { current: 2.0, prev: 1.9 },
      "30분 후":   { current: 3.5, prev: 3.2 },
      "2시간 후":  { current: 3.0, prev: 2.8 },
    },
    mood: {
      "복용 직후": { current: 2.2, prev: 2.0 },
      "30분 후":   { current: 3.3, prev: 3.0 },
      "2시간 후":  { current: 2.9, prev: 2.7 },
    },
    sleep: { current: 3.4, prev: 3.0, unit: "점" },
    constipation: { current: "18일", prev: "15일", unit: "" },
    exercise: { current: "14회 / 380분", prev: "10회 / 280분", unit: "" },
  },
  "최근 3개월": {
    medication: { current: 87, prev: 83, unit: "%" },
    bodyState: {
      "복용 직후": { current: 2.0, prev: 1.8 },
      "30분 후":   { current: 3.4, prev: 3.1 },
      "2시간 후":  { current: 2.9, prev: 2.7 },
    },
    mood: {
      "복용 직후": { current: 2.1, prev: 1.9 },
      "30분 후":   { current: 3.2, prev: 2.9 },
      "2시간 후":  { current: 2.8, prev: 2.6 },
    },
    sleep: { current: 3.3, prev: 2.9, unit: "점" },
    constipation: { current: "54일", prev: "44일", unit: "" },
    exercise: { current: "42회 / 1140분", prev: "30회 / 820분", unit: "" },
  },
};

const timeColors = {
  "복용 직후": "#F44336",
  "30분 후":   "#4CAF50",
  "2시간 후":  "#2196F3",
};

const trendData = {
  medication: {
    "주별": { values: [82, 84, 85, 88, 87, 90, 90, 88, 90], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "%", color: "#4CAF50", max: 100 },
    "월별": { values: [80, 83, 85, 85, 88], labels: ["5개월전","4개월전","3개월전","지난달","이번달"], unit: "%", color: "#4CAF50", max: 100 },
    "3개월별": { values: [75, 78, 83, 87], labels: ["9개월전","6개월전","지난3개월","최근3개월"], unit: "%", color: "#4CAF50", max: 100 },
  },
  bodyState: {
    "복용 직후": { values: [1.8, 1.9, 2.0, 2.0, 2.1, 2.0, 2.1, 2.0, 2.1], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#F44336", max: 5 },
    "30분 후":   { values: [3.0, 3.2, 3.3, 3.4, 3.5, 3.6, 3.5, 3.5, 3.8], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#4CAF50", max: 5 },
    "2시간 후":  { values: [2.6, 2.7, 2.8, 2.9, 3.0, 3.0, 3.1, 3.0, 3.2], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#2196F3", max: 5 },
  },
  mood: {
    "복용 직후": { values: [1.9, 2.0, 2.0, 2.1, 2.1, 2.2, 2.1, 2.1, 2.3], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#F44336", max: 5 },
    "30분 후":   { values: [2.8, 3.0, 3.1, 3.2, 3.2, 3.3, 3.3, 3.2, 3.5], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#4CAF50", max: 5 },
    "2시간 후":  { values: [2.5, 2.6, 2.7, 2.8, 2.8, 2.9, 2.9, 2.9, 3.0], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#2196F3", max: 5 },
  },
  sleep: {
    "주별": { values: [2.5, 2.6, 2.8, 2.9, 3.0, 3.1, 3.2, 3.2, 3.6], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "점", color: "#9C27B0", max: 5 },
    "월별": { values: [2.6, 2.8, 3.0, 3.0, 3.4], labels: ["5개월전","4개월전","3개월전","지난달","이번달"], unit: "점", color: "#9C27B0", max: 5 },
    "3개월별": { values: [2.5, 2.9, 3.3], labels: ["9개월전","지난3개월","최근3개월"], unit: "점", color: "#9C27B0", max: 5 },
  },
  constipation: {
    "주별": { values: [2, 3, 3, 4, 3, 4, 3, 3, 4], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "일", color: "#FF9800", max: 7 },
    "월별": { values: [10, 13, 15, 15, 18], labels: ["5개월전","4개월전","3개월전","지난달","이번달"], unit: "일", color: "#FF9800", max: 31 },
    "3개월별": { values: [30, 44, 54], labels: ["9개월전","지난3개월","최근3개월"], unit: "일", color: "#FF9800", max: 92 },
  },
  exercise: {
    "주별": { values: [1, 2, 2, 3, 2, 3, 2, 2, 4], labels: ["8주전","7주전","6주전","5주전","4주전","3주전","2주전","지난주","이번주"], unit: "회", color: "#FF5722", max: 7 },
    "월별": { values: [6, 8, 10, 10, 14], labels: ["5개월전","4개월전","3개월전","지난달","이번달"], unit: "회", color: "#FF5722", max: 31 },
    "3개월별": { values: [18, 30, 42], labels: ["9개월전","지난3개월","최근3개월"], unit: "회", color: "#FF5722", max: 100 },
  },
};

const periodToTrendKey = {
  "이번 주": "주별",
  "이번 달": "월별",
  "최근 3개월": "3개월별",
};

const ArrowBadge = ({ curr, prev, size = 18 }) => {
  const d = parseFloat(curr) - parseFloat(prev);
  if (isNaN(d)) return null;
  if (d > 0) return <span style={{ color: "#4CAF50", fontSize: size, fontWeight: 700 }}>↑</span>;
  if (d < 0) return <span style={{ color: "#F44336", fontSize: size, fontWeight: 700 }}>↓</span>;
  return <span style={{ color: "#999", fontSize: size }}>→</span>;
};

const ScrollBarChart = ({ values, labels, color, max, unit }) => {
  const visibleCount = 4;
  const [offset, setOffset] = useState(Math.max(0, values.length - visibleCount));
  const visible = values.slice(offset, offset + visibleCount);
  const visibleLabels = labels.slice(offset, offset + visibleCount);
  const canPrev = offset > 0;
  const canNext = offset < values.length - visibleCount;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
        {visible.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#555", fontWeight: 700 }}>
              {typeof v === "number" && v % 1 !== 0 ? v.toFixed(1) : v}{unit}
            </span>
            <div style={{
              width: "100%",
              height: `${Math.max((v / max) * 64, 4)}px`,
              backgroundColor: i === visible.length - 1 ? color : color + "77",
              borderRadius: 6,
            }} />
            <span style={{ fontSize: 11, color: "#aaa", textAlign: "center", lineHeight: 1.4 }}>{visibleLabels[i]}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
        <button onClick={() => setOffset(Math.max(0, offset - 1))} disabled={!canPrev} style={{
          padding: "8px 20px", borderRadius: 10, border: "1px solid #ddd",
          background: !canPrev ? "#f5f5f5" : "#fff",
          color: !canPrev ? "#ccc" : "#555",
          fontSize: 15, cursor: canPrev ? "pointer" : "default",
        }}>← 이전</button>
        <button onClick={() => setOffset(Math.min(values.length - visibleCount, offset + 1))} disabled={!canNext} style={{
          padding: "8px 20px", borderRadius: 10, border: "1px solid #ddd",
          background: !canNext ? "#f5f5f5" : "#fff",
          color: !canNext ? "#ccc" : "#555",
          fontSize: 15, cursor: canNext ? "pointer" : "default",
        }}>다음 →</button>
      </div>
    </div>
  );
};

const Card = ({ children, style = {} }) => (
  <div style={{
    background: "#fff", borderRadius: 16, padding: 20, marginBottom: 14,
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)", ...style,
  }}>{children}</div>
);

function DetailScreen({ item, period, onBack }) {
  const trendKey = periodToTrendKey[period];
  const prevLabel = prevLabels[period];
  const summary = summaryData[period][item.key];
  const isTimeItem = item.key === "bodyState" || item.key === "mood";
  const timeTrend = isTimeItem ? trendData[item.key] : null;
  const generalTrend = !isTimeItem ? trendData[item.key]?.[trendKey] : null;

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", background: "#f5f5f7", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{
        background: "#fff", padding: "18px 20px", borderBottom: "1px solid #eee",
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <span onClick={onBack} style={{ fontSize: 24, cursor: "pointer" }}>←</span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{item.icon} {item.label}</span>
      </div>

      <div style={{ padding: 16 }}>

        {/* 일반 항목 현황 */}
        {!isTimeItem && (
          <Card>
            <p style={{ fontSize: 15, color: "#999", margin: "0 0 8px" }}>{period} 현황</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: "#222" }}>
                {summary.current}{summary.unit}
              </span>
              <ArrowBadge curr={summary.current} prev={summary.prev} size={24} />
            </div>
            <p style={{ fontSize: 15, color: "#bbb", margin: "6px 0 0" }}>
              {prevLabel} {summary.prev}{summary.unit}
            </p>
          </Card>
        )}

        {/* 시간대별 현황 */}
        {isTimeItem && (
          <Card>
            <p style={{ fontSize: 15, color: "#999", margin: "0 0 6px" }}>{period} 시간대별 현황</p>
            <p style={{ fontSize: 13, color: "#bbb", margin: "0 0 16px" }}>
              ※ 약효 추적 알림을 통해 입력한 기록만 반영돼요
            </p>
            {Object.entries(summary).map(([time, vals]) => (
              <div key={time} style={{
                padding: "14px 16px", borderRadius: 12, background: "#f9f9f9",
                borderLeft: `5px solid ${timeColors[time]}`,
                marginBottom: 10,
              }}>
                <p style={{ fontSize: 16, color: "#555", fontWeight: 700, margin: "0 0 6px" }}>{time}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: timeColors[time] }}>
                    {vals.current.toFixed(1)}점
                  </span>
                  <ArrowBadge curr={vals.current} prev={vals.prev} size={20} />
                  <span style={{ fontSize: 14, color: "#bbb" }}>{prevLabel} {vals.prev.toFixed(1)}점</span>
                </div>
              </div>
            ))}
          </Card>
        )}

        {/* 시간대별 트렌드 */}
        {isTimeItem && timeTrend && Object.entries(timeTrend).map(([time, d]) => (
          <Card key={time}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: timeColors[time] }} />
              <span style={{ fontSize: 17, fontWeight: 700, color: "#222" }}>{time} 트렌드</span>
            </div>
            <ScrollBarChart values={d.values} labels={d.labels} color={d.color} max={d.max} unit={d.unit} />
          </Card>
        ))}

        {/* 일반 트렌드 */}
        {!isTimeItem && generalTrend && (
          <Card>
            <p style={{ fontSize: 17, fontWeight: 700, color: "#222", margin: "0 0 16px" }}>
              {trendKey} 트렌드
            </p>
            <ScrollBarChart values={generalTrend.values} labels={generalTrend.labels} color={generalTrend.color} max={generalTrend.max} unit={generalTrend.unit} />
          </Card>
        )}

      </div>
    </div>
  );
}

const items = [
  { key: "medication",    icon: "💊", label: "약 복용" },
  { key: "bodyState",     icon: "😊", label: "몸 상태" },
  { key: "mood",          icon: "😄", label: "기분 상태" },
  { key: "sleep",         icon: "😴", label: "수면" },
  { key: "constipation",  icon: "🚽", label: "변비" },
  { key: "exercise",      icon: "🏃", label: "운동" },
];

export default function RecordsMain() {
  const [period, setPeriod] = useState("이번 주");
  const [detail, setDetail] = useState(null);
  const prevLabel = prevLabels[period];

  if (detail) {
    return <DetailScreen item={detail} period={period} onBack={() => setDetail(null)} />;
  }

  const summary = summaryData[period];

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", background: "#f5f5f7", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{
        background: "#fff", padding: "18px 20px 14px", borderBottom: "1px solid #eee",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 24 }}>←</span>
          <span style={{ fontSize: 20, fontWeight: 700 }}>기록 보기</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {periods.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: "8px 16px", borderRadius: 20, border: "none",
              background: period === p ? "#4CAF50" : "#eee",
              color: period === p ? "#fff" : "#666",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}>{p}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <p style={{ fontSize: 15, color: "#999", margin: "0 0 14px", fontWeight: 600 }}>
          {period} 요약
        </p>

        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          {items.map((item, i) => {
            const s = summary[item.key];
            const isTimeItem = item.key === "bodyState" || item.key === "mood";

            return (
              <div key={item.key} onClick={() => setDetail(item)} style={{
                padding: "18px 16px",
                borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none",
                cursor: "pointer",
              }}>
                {/* 헤더 */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: isTimeItem ? 14 : 0 }}>
                  <span style={{ fontSize: 24, marginRight: 12 }}>{item.icon}</span>
                  <span style={{ fontSize: 18, color: "#222", flex: 1, fontWeight: 600 }}>{item.label}</span>
                  {!isTimeItem && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8 }}>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#222" }}>{s.current}{s.unit}</span>
                        <span style={{ fontSize: 13, color: "#bbb", display: "block" }}>{prevLabel} {s.prev}{s.unit}</span>
                      </div>
                      <ArrowBadge curr={s.current} prev={s.prev} size={18} />
                    </div>
                  )}
                  <span style={{ fontSize: 20, color: "#ccc" }}>›</span>
                </div>

                {/* 시간대별 카드 */}
                {isTimeItem && (
                  <div style={{ display: "flex", gap: 8, paddingLeft: 36 }}>
                    {Object.entries(s).map(([time, vals]) => (
                      <div key={time} style={{
                        flex: 1, background: "#f9f9f9", borderRadius: 10,
                        padding: "10px 8px", textAlign: "center",
                        borderTop: `3px solid ${timeColors[time]}`,
                      }}>
                        <p style={{ fontSize: 12, color: "#999", margin: "0 0 4px" }}>{time}</p>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 700, color: timeColors[time] }}>
                            {vals.current.toFixed(1)}
                          </span>
                          <ArrowBadge curr={vals.current} prev={vals.prev} size={14} />
                        </div>
                        <p style={{ fontSize: 11, color: "#bbb", margin: "2px 0 0" }}>
                          {prevLabel} {vals.prev.toFixed(1)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
