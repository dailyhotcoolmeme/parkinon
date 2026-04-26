import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>파킨온 개인정보처리방침</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    background: #f8f8f8;
    color: #222;
    line-height: 1.8;
    font-size: 15px;
  }
  .header {
    background: #fff;
    border-bottom: 1px solid #eee;
    padding: 20px 24px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    color: #222;
  }
  .header p {
    font-size: 13px;
    color: #999;
    margin-top: 2px;
  }
  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 24px 60px;
  }
  .intro {
    background: #f0f7f0;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 12px;
    font-size: 14px;
    color: #444;
    line-height: 1.8;
  }
  .section {
    background: #fff;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 12px;
  }
  .section h2 {
    font-size: 16px;
    font-weight: 700;
    color: #111;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f0f0f0;
  }
  .section p {
    font-size: 14px;
    color: #444;
    margin-bottom: 10px;
  }
  .section ul {
    padding-left: 18px;
    margin-bottom: 10px;
  }
  .section ul li {
    font-size: 14px;
    color: #444;
    margin-bottom: 6px;
  }
  .table-wrap {
    overflow-x: auto;
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    background: #f5f5f5;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    color: #333;
    border: 1px solid #e0e0e0;
  }
  td {
    padding: 10px 12px;
    color: #444;
    border: 1px solid #e0e0e0;
    vertical-align: top;
  }
  .contact {
    background: #f0f7f0;
    border-radius: 12px;
    padding: 20px 24px;
    margin-top: 12px;
  }
  .contact p {
    font-size: 14px;
    color: #444;
    margin-bottom: 6px;
  }
  .contact strong {
    color: #2e7d32;
  }
  .date {
    font-size: 13px;
    color: #bbb;
    text-align: center;
    margin-top: 24px;
  }
</style>
</head>
<body>

<div class="header">
  <h1>개인정보처리방침</h1>
  <p>파킨온 (ParkinON)</p>
</div>

<div class="container">

  <div class="intro">
    아워마인(이하 "회사")은 파킨온(ParkinON) 서비스 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 등 관련 법령을 준수합니다. 본 방침은 회사가 수집하는 개인정보의 항목, 수집 목적, 보유 기간 및 이용자의 권리에 대해 안내합니다.
  </div>

  <div class="section">
    <h2>제1조 (수집하는 개인정보)</h2>
    <p>회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다.</p>
    <div class="table-wrap">
      <table>
        <tr>
          <th>구분</th>
          <th>수집 항목</th>
          <th>수집 방법</th>
        </tr>
        <tr>
          <td>필수</td>
          <td>카카오 계정 정보 (닉네임, 이메일), 이름, 출생연도, 성별, 역할(환자/보호자)</td>
          <td>카카오 소셜 로그인, 회원가입 시 직접 입력</td>
        </tr>
        <tr>
          <td>선택</td>
          <td>파킨슨 진단연도, 관계(배우자/자녀 등), 거주 여부</td>
          <td>서비스 이용 중 직접 입력</td>
        </tr>
        <tr>
          <td>서비스 이용 중</td>
          <td>약 복용 기록, 몸 상태/기분/수면/변비 기록, 운동 기록, 영상/사진, 게시글 및 댓글</td>
          <td>서비스 이용 중 직접 입력 및 업로드</td>
        </tr>
        <tr>
          <td>자동 수집</td>
          <td>기기 정보(OS, 앱 버전), 서비스 이용 기록</td>
          <td>서비스 이용 중 자동 수집</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>제2조 (개인정보의 수집 및 이용 목적)</h2>
    <ul>
      <li>서비스 제공 및 운영 (약 복용 관리, 알림 발송, 가족 연동)</li>
      <li>이용자 식별 및 본인 확인</li>
      <li>서비스 개선 및 신규 기능 개발</li>
      <li>고객 문의 및 불만 처리</li>
      <li>법령상 의무 이행</li>
    </ul>
  </div>

  <div class="section">
    <h2>제3조 (개인정보의 보유 및 이용 기간)</h2>
    <p>회사는 이용자가 서비스를 이용하는 동안 개인정보를 보유합니다.</p>
    <div class="table-wrap">
      <table>
        <tr>
          <th>항목</th>
          <th>보유 기간</th>
        </tr>
        <tr>
          <td>회원 정보</td>
          <td>회원 탈퇴 시까지</td>
        </tr>
        <tr>
          <td>약 복용 / 건강 기록</td>
          <td>회원 탈퇴 시까지 (탈퇴 후 즉시 삭제)</td>
        </tr>
        <tr>
          <td>영상 기록</td>
          <td>업로드 후 6개월 (이후 자동 삭제)</td>
        </tr>
        <tr>
          <td>게시글 및 댓글</td>
          <td>삭제 요청 시 또는 회원 탈퇴 시까지</td>
        </tr>
        <tr>
          <td>서비스 이용 기록</td>
          <td>3개월</td>
        </tr>
      </table>
    </div>
    <p>단, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보유합니다.</p>
  </div>

  <div class="section">
    <h2>제4조 (개인정보의 제3자 제공)</h2>
    <p>회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.</p>
    <ul>
      <li>이용자가 사전에 동의한 경우</li>
      <li>법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
    </ul>
  </div>

  <div class="section">
    <h2>제5조 (개인정보 처리 위탁)</h2>
    <div class="table-wrap">
      <table>
        <tr>
          <th>수탁업체</th>
          <th>위탁 업무</th>
        </tr>
        <tr>
          <td>Supabase Inc.</td>
          <td>데이터베이스 및 인증 서비스</td>
        </tr>
        <tr>
          <td>Cloudflare Inc.</td>
          <td>영상/사진 파일 저장</td>
        </tr>
        <tr>
          <td>Anthropic</td>
          <td>처방전 OCR 분석 (Claude API)</td>
        </tr>
        <tr>
          <td>카카오</td>
          <td>소셜 로그인 인증</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>제6조 (민감 정보 처리)</h2>
    <p>회사는 건강 상태, 약 복용 기록 등 민감한 개인정보를 수집합니다. 이러한 정보는 서비스 제공 목적으로만 사용되며, 암호화하여 안전하게 보관합니다.</p>
    <p>처방전 사진은 OCR 분석 후 즉시 삭제되며, 분석 결과(약 이름, 용량 등)만 저장됩니다.</p>
  </div>

  <div class="section">
    <h2>제7조 (이용자의 권리)</h2>
    <p>이용자는 언제든지 다음의 권리를 행사할 수 있습니다.</p>
    <ul>
      <li>개인정보 열람 요청</li>
      <li>개인정보 정정·삭제 요청</li>
      <li>개인정보 처리 정지 요청</li>
      <li>회원 탈퇴 (서비스 내 탈퇴 기능 이용)</li>
    </ul>
    <p>권리 행사는 서비스 내 설정 화면 또는 아래 이메일을 통해 요청하실 수 있습니다.</p>
  </div>

  <div class="section">
    <h2>제8조 (개인정보 보호 조치)</h2>
    <ul>
      <li>개인정보는 암호화하여 저장 및 전송</li>
      <li>접근 권한 최소화 및 관리</li>
      <li>보안 취약점 정기 점검</li>
      <li>개인정보 처리 직원 최소화</li>
    </ul>
  </div>

  <div class="section">
    <h2>제9조 (쿠키 및 자동 수집)</h2>
    <p>서비스는 앱 운영을 위해 기기 정보 및 이용 기록을 자동으로 수집할 수 있습니다. 이는 서비스 개선 및 오류 분석 목적으로만 활용됩니다.</p>
  </div>

  <div class="section">
    <h2>제10조 (개인정보처리방침 변경)</h2>
    <p>이 개인정보처리방침은 법령·정책 변경에 따라 수정될 수 있으며, 변경 시 서비스 내 공지를 통해 안내합니다.</p>
  </div>

  <div class="contact">
    <p><strong>개인정보 보호 책임자</strong></p>
    <p><strong>회사명:</strong> 아워마인</p>
    <p><strong>대표자:</strong> 최성철</p>
    <p><strong>이메일:</strong> ourmine1003@naver.com</p>
    <p style="margin-top:10px; font-size:13px; color:#888;">개인정보 관련 문의는 위 이메일로 연락주시면 성실히 답변드리겠습니다.</p>
  </div>

  <p class="date">시행일: 2026년 4월 1일</p>

</div>
</body>
</html>`;

export function PrivacyScreen() {
  const navigation = useNavigation<any>();
  const { unreadCount } = useNotificationBadge();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="개인정보처리방침"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <WebView
        style={styles.webview}
        source={{ html: PRIVACY_HTML }}
        originWhitelist={['*']}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  webview: { flex: 1 },
});
