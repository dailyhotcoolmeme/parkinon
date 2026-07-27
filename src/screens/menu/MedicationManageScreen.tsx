import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  Dimensions,
  Switch,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SlotTimeIcon } from '../../components/common/SlotTimeIcon';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { supabase } from '../../lib/supabase';
import type { Json } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useSettings } from '../../context/SettingsContext';
import { useDialog } from '../../context/DialogContext';
import {
  LEGACY_SLOT_ORDER,
  LEGACY_SLOT_META,
  labelToLegacyKey,
  normalizeHhmm,
  slotTitle,
  type LegacyMealKey,
} from '../../constants/doseSlots';
import {
  ensurePatientDoseSlots,
  syncMedicationDoseSlots,
  invalidateDoseSlotsCache,
  setMedicationSlots,
  fetchPatientDoseSlots,
  type DoseSlot,
} from '../../hooks/useDoseSlots';
import { DoseSlotSetList } from '../../components/settings/DoseSlotSetList';
import { AlarmSoundPickerRow } from '../../components/common/AlarmSoundPickerRow';
import { MedSlotAssignModal } from '../../components/common/MedSlotAssignModal';
import { PRESET_ALARM_SOUNDS, presetFileIdOf, presetSoundDisplayName, type AlarmMode } from '../../constants/presetAlarmSounds';
import { ensurePresetChannelForSoundId } from '../../lib/alarmSound';
import { rescheduleRemindAlarms } from '../../lib/localAlarm';
import { PRESET_PREVIEW_ASSETS } from '../../constants/presetPreviewAssets';
import { recommendForSlotMeds } from '../../utils/recommendUtils';
import { navigateTo } from '../../navigation/navigationRef';
import { AdSlot } from '../../components/common/AdSlot';
import { AlarmSoundOption } from '../../components/common/AlarmSoundPickerRow';
import {
  turnOnImmediatePopup,
  turnOffImmediatePopup,
  trackChangePopup,
  trackOffPopup,
  hasTakenTodayKST,
  deleteSlotCombinedPopup,
} from '../../utils/notifActionFeedback';
import type { MenuStackParamList } from '../../navigation/MenuNavigator';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';

// ─── 타입 ────────────────────────────────────────────────────────────────────

type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'bedtime';

// 화면 내 슬롯 표시 상수(값 동일) — 공용 단일 출처(LEGACY_SLOT_META)에서 파생.
// label 은 기존 '아침약' 표기 유지(korMed). emoji/defaultTime/bgColor 동일.
const TIME_SLOTS: { key: TimeSlot; label: string; emoji: string; defaultTime: string; bgColor: string }[] =
  LEGACY_SLOT_ORDER.map((key) => {
    const meta = LEGACY_SLOT_META[key];
    return {
      key,
      label: meta.korMed,
      emoji: meta.emoji,
      defaultTime: meta.defaultTime,
      bgColor: meta.bgColor,
    };
  });

// 슬롯 좌측 이미지(이모지) — 시각대 기준 자동(공용 periodEmoji, 시간대 단어와 동일 범위).

type MealSchedules = Partial<Record<TimeSlot, string>>;

interface DrugInfo {
  itemName: string;
  entpName?: string;
  itemImage?: string;
  chart?: string;
  drugShape?: string;
  colorClass?: string;
  className?: string;
  etcOtcName?: string;
  printFront?: string;
  printBack?: string;
  itemSeq?: string;
}

/**
 * 약에 배정된 dose_slots 조인 결과(표시 전용).
 * - key: dose_slot.label 을 legacy 슬롯 키로 역매핑한 값(표준 4슬롯). 비표준 라벨이면 null.
 * - time: 'HH:MM' (dose_slots.time 정규화)
 * - sortOrder: dose_slots.sort_order (표시 정렬용)
 * ⚠️ 표시 전용. 쓰기(meal_times/meal_schedules)에는 사용하지 않음.
 */
interface MedDoseSlot {
  key: LegacyMealKey | null;
  time: string;
  sortOrder: number;
}

interface Medication {
  id: string;
  name: string;
  dosage?: string | null;
  /** 복용 횟수(처방전 OCR). null=불명확. 슬롯 약넣기 가이드("1일 N회 중 M개 배정")에 사용. */
  dailyCount?: number | null;
  /** 복용횟수 기준 기간. 'day'="1일 N회"(기본) / 'week'="1주 N회". */
  countUnit?: 'day' | 'week';
  times: TimeSlot[];
  schedules?: MealSchedules;
  drugInfo?: DrugInfo | null;
  ediCode?: string;
  /** medication_dose_slots 조인(표시 우선). 없으면 legacy(times/schedules) 폴백. */
  doseSlots?: MedDoseSlot[];
}

/**
 * 중단한 약(이력 표시 전용). is_active=false & ended_at 있음.
 * startedAt=created_at(복용 시작 추정), endedAt=ended_at(중단 시점). 둘 다 ISO 문자열.
 */
interface StoppedMed {
  id: string;
  name: string;
  dosage?: string | null;
  dailyCount?: number | null;
  countUnit?: 'day' | 'week';
  startedAt?: string | null;
  endedAt?: string | null;
}

// 복용횟수 표시: 단위(1일/1주) + 횟수. 횟수 없으면 "횟수 미정".
const formatDoseCount = (n?: number | null, u?: 'day' | 'week') =>
  n && n > 0
    ? i18n.t(u === 'week' ? 'medManage.doseCountWeek' : 'medManage.doseCountDay', { n })
    : i18n.t('medManage.doseCountUnknown');

// 복용량 표시: dosage는 "1정"/"5mg" 처럼 숫자+단위가 합쳐진 raw 문자열로 저장되는데,
// '정' 단위는 DB에 항상 한글로 박혀 있어(로케일 무관) 그대로 보여주면 해외에서도 "정"이 노출된다.
// (등록 직후 하단 리스트·과거 기록 리스트 두 곳에서 이 raw 문자열을 그대로 표시하던 버그)
function formatDosageForDisplay(dosage?: string | null): string {
  const trimmed = (dosage ?? '').trim();
  if (!trimmed) return '';
  const numMatch = trimmed.match(/[0-9]+(?:\.[0-9]+)?/);
  const num = numMatch ? numMatch[0] : '';
  if (!num) return trimmed; // 예상 밖 포맷이면 회귀 방지로 그대로 표시
  if (/mg/i.test(trimmed)) return `${num}mg`; // mg는 로케일 무관 그대로
  const isEn = (i18n.language || '').toLowerCase().startsWith('en');
  return isEn ? `${num} ${i18n.t('medManage.unitTablet')}` : `${num}정`;
}

type ChangeType = 'added' | 'updated' | 'deleted';

interface MedSnapshot {
  id: string;
  name: string;
  dosage?: string | null;
  meal_times: TimeSlot[];
}

// ─── API 함수 ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? SUPABASE_ANON_KEY;
}

async function callClaudeOCR(
  base64Image: string,
  mediaType: string,
): Promise<{ medications: { name: string; ediCode: string; dosage: string; dailyCount: number | null; times: string[] }[]; rawText: string }> {
  // image_type: 'jpeg' | 'png'
  const rawType = mediaType.replace('image/', '');
  const imageType: 'jpeg' | 'png' = rawType === 'png' ? 'png' : 'jpeg';

  const accessToken = await getAccessToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/claude-medical-record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      image_base64: base64Image,
      image_type: imageType,
      mode: 'medication_manage',
    }),
  });

  if (!response.ok) throw new Error(`OCR error: ${response.status}`);
  const data = await response.json();
  const normalized = {
    medications: (data.medications ?? []).map((m: any) => {
      // dailyCount: 정수 양수만, 그 외엔 null (엣지함수가 정규화하지만 방어적 재검).
      let dailyCount: number | null = null;
      const raw = m.dailyCount ?? m.daily_count;
      if (raw !== null && raw !== undefined) {
        const n = Math.trunc(Number(raw));
        if (Number.isFinite(n) && n > 0) dailyCount = n;
      }
      return {
        name: String(m.name ?? ''),
        ediCode: (m.ediCode ?? '').toString().trim(),
        dosage: (m.dosage ?? '').toString().trim(),
        dailyCount,
        times: Array.isArray(m.times) ? m.times : [],
      };
    }),
  };
  return { ...normalized, rawText: '' };
}

// mfds-proxy Edge Function 호출 헬퍼
async function callMfdsProxy(endpoint: 'grn' | 'easy' | 'easy01' | 'permit-list' | 'permit-detail', query: string, opts?: { numOfRows?: number; pageNo?: number }): Promise<any> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mfds-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ endpoint, query, ...(opts ?? {}) }),
  });
  if (!res.ok) return null;
  return res.json();
}

function normalizeDrugName(s: string): string {
  return (s || '').replace(/[\s()（）\-_\/]/g, '').toUpperCase();
}

function isNameMatched(searchName: string, returnedName: string): boolean {
  if (!returnedName) return false;
  const s = normalizeDrugName(searchName);
  const r = normalizeDrugName(returnedName);
  if (!s || !r) return false;
  const sHead = s.slice(0, 3);
  const rHead = r.slice(0, 3);
  return r.includes(sHead) || s.includes(rHead);
}

async function searchMfdsInfo(drugName: string): Promise<DrugInfo | null> {
  // 식약처(한국 정부) DB라 해외 로케일에는 의미 없음(자국 약 이름을 넣어도 항상 못 찾음).
  // 무의미한 네트워크 호출·"확인 실패" 오노출 방지를 위해 아예 조회하지 않는다.
  if (isOverseasLocale()) return null;
  // 1차: 의약품 e약은요 API (제품허가 기반, 브랜드명 검색에 강함) — mfds-proxy 경유
  let easyHit: {
    itemName: string;
    entpName?: string;
    itemImage?: string;
    efcyQesitm?: string;
    useMethodQesitm?: string;
  } | null = null;

  // 'easy'(e약은요)와 'grn'(낱알식별)은 폴백 관계가 아니라 항상 둘 다 호출해 병합한다
  //  (easy=브랜드명/효능, grn=모양·색·식별표시). 서로 독립 → 병렬 호출로 지연 단축.
  const [easyData, grnData] = await Promise.all([
    callMfdsProxy('easy', drugName, { numOfRows: 5, pageNo: 1 }).catch(() => null),
    callMfdsProxy('grn', drugName, { numOfRows: 5, pageNo: 1 }).catch(() => null),
  ]);

  try {
    if (easyData) {
      const rawEasy = easyData?.body?.items?.item ?? easyData?.body?.items;
      if (rawEasy) {
        const easyList = Array.isArray(rawEasy) ? rawEasy : [rawEasy];
        const matched = easyList.find((it: any) => isNameMatched(drugName, it?.itemName ?? '')) ?? easyList[0];
        if (matched && matched.itemName) {
          easyHit = {
            itemName: matched.itemName,
            entpName: matched.entpName ?? undefined,
            itemImage: matched.itemImage ?? undefined,
            efcyQesitm: matched.efcyQesitm ?? undefined,
            useMethodQesitm: matched.useMethodQesitm ?? undefined,
          };
        }
      }
    }
  } catch {
    // ignore, fallback to 낱알식별
  }

  // 2차: 낱알식별 API (이미지/모양 정보 보강) — mfds-proxy 경유
  let grnHit: any = null;
  try {
    const data = grnData;
    if (data) {
      const rawItems = data?.body?.items?.item ?? data?.body?.items;
      if (rawItems) {
        const list = Array.isArray(rawItems) ? rawItems : [rawItems];
        const matched = list.find((it: any) => isNameMatched(drugName, it?.ITEM_NAME ?? '')) ?? list[0];
        if (matched && isNameMatched(drugName, matched.ITEM_NAME ?? '')) {
          grnHit = matched;
        }
      }
    }
  } catch {
    // ignore
  }

  if (!easyHit && !grnHit) return null;

  const itemName = easyHit?.itemName || grnHit?.ITEM_NAME || drugName;
  const entpName = easyHit?.entpName ?? grnHit?.ENTP_NAME ?? undefined;
  const itemImage = easyHit?.itemImage || grnHit?.ITEM_IMAGE || undefined;

  return {
    itemName,
    entpName,
    itemImage,
    chart: grnHit?.CHART ?? undefined,
    drugShape: grnHit?.DRUG_SHAPE ?? undefined,
    colorClass: grnHit?.COLOR_CLASS1 ?? undefined,
    className: grnHit?.CLASS_NAME ?? undefined,
    etcOtcName: grnHit?.ETC_OTC_NAME ?? undefined,
    printFront: grnHit?.PRINT_FRONT ?? undefined,
    printBack: grnHit?.PRINT_BACK ?? undefined,
    itemSeq: grnHit?.ITEM_SEQ ?? undefined,
  };
}

// ─── 중단 약 날짜 표기(KST) ──────────────────────────────────────────────────

/** timestamptz(ISO) → KST 기준 'YYYY.M.D'. 값 없으면 빈 문자열. */
function formatKstYmd(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // KST(UTC+9) 보정 후 UTC 게터로 연·월·일 추출
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`;
}

/** "YYYY.M.D ~ YYYY.M.D" 형태(날짜 범위만). 시작/끝 한쪽만 있으면 가능한 만큼만. */
function formatStoppedRange(startedAt?: string | null, endedAt?: string | null): string {
  const start = formatKstYmd(startedAt);
  const end = formatKstYmd(endedAt);
  if (start && end) return `${start} ~ ${end}`;
  if (end) return `~ ${end}`;
  if (start) return `${start} ~`;
  return i18n.t('medManage.noInfo');
}

// ─── 스와이프 다운 닫기 훅 ────────────────────────────────────────────────────

function useSwipeToDismiss(onDismiss: () => void) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 80) {
          Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onDismiss();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return { translateY, panResponder };
}

// ─── DrugInfoModal ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML/XML 엔티티 디코드 (DOC_DATA 안에 &nbsp; 등이 섞여 들어옴) */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // &amp; 는 마지막에 (이중 디코드 방지)
}

/**
 * 식약처 허가정보 DOC_DATA(escape된 XML 문자열, <DOC><SECTION><ARTICLE><PARAGRAPH><![CDATA[...]]>)에서
 * 사람이 읽을 텍스트만 추출한다.
 * - ARTICLE title(원문이 가진 소제목)과 PARAGRAPH 본문(CDATA 또는 태그 사이 텍스트)을 등장 순서대로 추출.
 * - 태그 제거 + 엔티티 디코드만 수행. 원문 텍스트 임의 요약·가공 금지(의료 규칙).
 * - 태그가 전혀 없으면(이미 평문) 엔티티 디코드만 해서 그대로 반환(방어적).
 * - 빈 값/파싱 실패 시 빈 문자열.
 */
function parseDocData(raw?: string | null): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // 일부 응답은 DOC_DATA 값 자체가 한 번 더 escape돼 올 수 있어 방어적으로 1차 디코드된 형태를 본다.
  // (이미 평문이면 아래 태그 매칭이 안 걸려 그대로 떨어짐)
  const hasTags = /<\s*(DOC|SECTION|ARTICLE|PARAGRAPH)/i.test(s) || s.includes('<![CDATA[');
  if (!hasTags) {
    // 태그 없음 → 이미 평문. 엔티티만 정리.
    return decodeEntities(s).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  const out: string[] = [];
  // ARTICLE title / PARAGRAPH 본문을 등장 순서대로 토큰화
  // - ARTICLE 여는 태그의 title="..." 속성(비어있지 않으면 소제목으로 추가)
  // - PARAGRAPH ... >내용</PARAGRAPH> 의 내용(CDATA 우선)
  const tokenRe = /<ARTICLE\b[^>]*\btitle="([^"]*)"[^>]*>|<PARAGRAPH\b[^>]*>([\s\S]*?)<\/PARAGRAPH>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(s)) !== null) {
    if (m[1] !== undefined) {
      // ARTICLE title 속성
      const title = decodeEntities(m[1]).trim();
      if (title) out.push(title);
    } else if (m[2] !== undefined) {
      let inner = m[2];
      // CDATA 안쪽 텍스트만 (여러 개면 이어붙임)
      const cdata = [...inner.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((c) => c[1]);
      let text = cdata.length > 0 ? cdata.join('') : inner;
      // 남은 태그 제거
      text = text.replace(/<[^>]*>/g, '');
      text = decodeEntities(text).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
      if (text) out.push(text);
    }
  }

  if (out.length === 0) {
    // 구조가 예상과 달라 토큰을 못 뽑았으면, 통째로 태그만 제거하는 최후 폴백
    const fallback = s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '\n');
    return decodeEntities(fallback).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function DrugInfoModal({ drug, onClose }: { drug: Medication | null; onClose: () => void }) {
  const { t } = useTranslation();
  const sheetBottomPad = useBottomSheetPadding(32, 24);
  const [easyInfo, setEasyInfo] = useState<{
    efficacy?: string;
    dosage?: string;
    caution?: string;
    sideEffect?: string;
    deposit?: string;
  } | null>(null);
  const [easyLoading, setEasyLoading] = useState(false);
  const [easyNotFound, setEasyNotFound] = useState(false);
  // 약 정보를 실제로 표시한 출처 구분: 'easy'=e약은요, 'permit'=허가정보
  const [infoSource, setInfoSource] = useState<'easy' | 'permit' | null>(null);

  useEffect(() => {
    if (!drug?.name) return;
    const drugName = drug.name;
    const savedItemSeq = drug.drugInfo?.itemSeq; // 등록 시 저장된 허가정보 식별자(이름매칭 우회용)
    let cancelled = false;

    setEasyInfo(null);
    setEasyNotFound(false);
    setInfoSource(null);
    setEasyLoading(true);

    // 식약처(한국 정부) DB라 해외 로케일에는 의미 없음 — 무의미한 네트워크 호출 없이 바로 미확인 처리.
    if (isOverseasLocale()) {
      setEasyLoading(false);
      setEasyNotFound(true);
      return;
    }

    // 허가정보 상세(item_seq) → EE/UD/NB_DOC_DATA 파싱 → easyInfo 형태로 변환
    const loadPermitDetail = async (itemSeq: string): Promise<boolean> => {
      const detail = await callMfdsProxy('permit-detail', itemSeq, { numOfRows: 1, pageNo: 1 });
      if (!detail) return false;
      const body = detail?.body ?? detail?.response?.body;
      const rawItems = body?.items?.item ?? body?.items;
      const list = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
      const item = list[0];
      if (!item) return false;
      const efficacy = parseDocData(item.EE_DOC_DATA);
      const dosage = parseDocData(item.UD_DOC_DATA);
      const caution = parseDocData(item.NB_DOC_DATA);
      const deposit = item.STORAGE_METHOD ? String(item.STORAGE_METHOD).trim() : '';
      if (!efficacy && !dosage && !caution && !deposit) return false;
      if (!cancelled) {
        setEasyInfo({
          efficacy: efficacy || undefined,
          dosage: dosage || undefined,
          caution: caution || undefined,
          sideEffect: undefined, // 허가정보엔 별도 부작용 섹션 없음(주의사항에 포함)
          deposit: deposit || undefined,
        });
        setInfoSource('permit');
      }
      return true;
    };

    (async () => {
      try {
        // ── 1차: e약은요(easy) 이름검색 (일반약은 소비자친화 텍스트라 우선) ──
        const easyData = await callMfdsProxy('easy', drugName, { numOfRows: 5, pageNo: 1 });
        if (!cancelled && easyData) {
          const body = easyData?.body ?? easyData?.response?.body;
          const rawItems = body?.items?.item ?? body?.items;
          const list = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
          const item = list.find((it: any) => isNameMatched(drugName, it?.itemName ?? '')) ?? list[0];
          if (item) {
            const clean = (v?: string) => (v ? stripHtml(v) : undefined);
            const caution = [item.atpnWarnQesitm, item.atpnQesitm]
              .filter(Boolean)
              .map((v: string) => stripHtml(v))
              .join('\n\n') || undefined;
            const efficacy = clean(item.efcyQesitm);
            const dosage = clean(item.useMethodQesitm);
            if (efficacy || dosage || caution) {
              if (!cancelled) {
                setEasyInfo({
                  efficacy,
                  dosage,
                  caution,
                  sideEffect: clean(item.seQesitm),
                  deposit: clean(item.depositMethodQesitm),
                });
                setInfoSource('easy');
              }
              return; // e약은요로 충분
            }
          }
        }

        // ── 2차: e약은요 0건 → 허가정보(전문약 포함) ──
        if (cancelled) return;
        // 2-1) 저장된 item_seq 있으면 이름매칭 건너뛰고 상세 직행
        if (savedItemSeq) {
          if (await loadPermitDetail(savedItemSeq)) return;
        }
        // 2-2) item_seq 없으면 permit-list(item_name)로 검색 → ITEM_SEQ → 상세
        if (cancelled) return;
        const listData = await callMfdsProxy('permit-list', drugName, { numOfRows: 5, pageNo: 1 });
        if (!cancelled && listData) {
          const lbody = listData?.body ?? listData?.response?.body;
          const lraw = lbody?.items?.item ?? lbody?.items;
          const plist = lraw ? (Array.isArray(lraw) ? lraw : [lraw]) : [];
          const phit = plist.find((it: any) => isNameMatched(drugName, it?.ITEM_NAME ?? '')) ?? plist[0];
          const seq = phit?.ITEM_SEQ ? String(phit.ITEM_SEQ) : null;
          if (seq && (await loadPermitDetail(seq))) return;
        }

        // ── 3차: 둘 다 없음 ──
        if (!cancelled) setEasyNotFound(true);
      } catch (e) {
        if (__DEV__) console.error('[DrugInfo] 약정보 로드 오류:', e);
        if (!cancelled) setEasyNotFound(true);
      } finally {
        if (!cancelled) setEasyLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [drug?.name, drug?.drugInfo?.itemSeq]);

  if (!drug) return null;
  const info = drug.drugInfo;

  const shapeDesc = [info?.colorClass, info?.drugShape, info?.chart]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* 배경(backdrop) 탭으로 닫기 */}
      <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={onClose} />
      {/* 시트: 일반 View. backdrop 위에 형제로 렌더돼 시트 영역 탭은 시트가 받아 backdrop까지 안 감(responder 가로채기 없음 → ScrollView 스크롤 정상) */}
      <View style={modalStyles.sheetWrap} pointerEvents="box-none">
        <View style={modalStyles.sheet}>
            {/* 장식용 그랩바 (제스처 없음) */}
            <View style={modalStyles.dragHandleArea}>
              <View style={modalStyles.dragHandle} />
            </View>
            <ScrollView
              style={[modalStyles.scrollArea, { maxHeight: SCREEN_HEIGHT * 0.72 }]}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              contentContainerStyle={[
                modalStyles.scrollContent,
                { paddingBottom: sheetBottomPad },
              ]}
            >
              <View style={modalStyles.imageContainer}>
                {info?.itemImage ? (
                  <Image source={{ uri: info.itemImage }} style={modalStyles.drugImage} resizeMode="contain" />
                ) : (
                  <View style={modalStyles.imagePlaceholder}>
                    <Ionicons name="medkit-outline" size={40} color={Colors.textHint} />
                  </View>
                )}
              </View>
              <Text style={modalStyles.drugName}>{drug.name}</Text>
              {!easyLoading && easyInfo && infoSource && (
                <View style={[modalStyles.sourceRow, { marginTop: 6 }]}>
                  <Ionicons name="shield-checkmark" size={14} color={Colors.primary} style={modalStyles.sourceIcon} />
                  <Text style={modalStyles.sourceText}>
                    {infoSource === 'easy'
                      ? t('medManage.sourceEasy')
                      : t('medManage.sourcePermit')}
                  </Text>
                </View>
              )}
              {info?.entpName && <Text style={modalStyles.companyName}>{info.entpName}</Text>}
              {!info && (
                <View style={modalStyles.noInfoContainer}>
                  <Text style={modalStyles.noInfoText}>{t('medManage.noMfdsInfo')}</Text>
                  <Text style={modalStyles.noInfoSubText}>{t('medManage.checkDrugName')}</Text>
                </View>
              )}
              {shapeDesc ? (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionShape')}</Text>
                  <Text style={modalStyles.sectionContent}>{shapeDesc}</Text>
                </View>
              ) : null}
              {(info?.className || info?.etcOtcName) && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionClass')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {[info.className, info.etcOtcName].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              )}
              {(info?.printFront || info?.printBack) && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionIdent')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {info.printFront ? t('medManage.printFront', { v: info.printFront }) : ''}
                    {info.printFront && info.printBack ? '\n' : ''}
                    {info.printBack ? t('medManage.printBack', { v: info.printBack }) : ''}
                  </Text>
                </View>
              )}
              {easyLoading && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.easyLoadingText}>{i18n.t('loading.loadingMedInfo')}</Text>
                </View>
              )}
              {!easyLoading && easyInfo?.efficacy && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionEfficacy')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.efficacy}
                  </Text>
                </View>
              )}
              {!easyLoading && easyInfo?.dosage && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionDosageUsage')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.dosage}
                  </Text>
                </View>
              )}
              {!easyLoading && easyInfo?.caution && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.cautionHeader}>{t('medManage.sectionCaution')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.caution}
                  </Text>
                </View>
              )}
              {!easyLoading && easyInfo?.sideEffect && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.cautionHeader}>{t('medManage.sectionSideEffect')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.sideEffect}
                  </Text>
                </View>
              )}
              {!easyLoading && easyInfo?.deposit && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>{t('medManage.sectionDeposit')}</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.deposit}
                  </Text>
                </View>
              )}
              {!easyLoading && easyNotFound && !easyInfo && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.easyLoadingText}>{t('medManage.medInfoNotFound')}</Text>
                </View>
              )}
              <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={modalStyles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

const modalStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  dragHandleArea: { paddingTop: 12, paddingBottom: 4, alignItems: 'center' },
  dragHandle: { width: 40, height: 5, backgroundColor: '#DDDDDD', borderRadius: 3 },
  scrollArea: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 8 },
  imageContainer: { alignItems: 'center', marginVertical: 16 },
  drugImage: { width: 160, height: 100, resizeMode: 'contain', borderRadius: 8, backgroundColor: '#F5F5F5' },
  imagePlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.light, alignItems: 'center', justifyContent: 'center' },
  drugName: { fontSize: 24, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 6 },
  companyName: { fontSize: 16, color: Colors.textSub, textAlign: 'center', marginBottom: 20 },
  noInfoContainer: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  noInfoText: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  noInfoSubText: { fontSize: 16, color: Colors.textSub, textAlign: 'center', lineHeight: 26 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  sectionContent: { fontSize: 18, color: Colors.textSub, lineHeight: 28 },
  cautionHeader: { fontSize: 18, fontWeight: '700', color: '#C62828', marginBottom: 8 },
  easyLoadingText: { fontSize: 18, color: Colors.textSub, textAlign: 'center', paddingVertical: 8 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 },
  sourceIcon: { marginRight: 5 },
  sourceText: { fontSize: 13, fontWeight: '600', color: Colors.primary, textAlign: 'center', lineHeight: 18 },
  closeBtn: { backgroundColor: Colors.primary, borderRadius: 12, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── 슬롯 약 넣기 바텀시트 (확정안 D) ──────────────────────────────────────────
// 슬롯 카드의 [약 넣기]/[약 넣기·빼기] → 이 시트.
// "이 시간대(슬롯)에 먹는 약을 내 약에서 고르기".
//   - 그 슬롯 기준으로 active 약을 전부 보여주고, 각 약에 체크(이미 이 슬롯에
//     배정됐으면 체크됨). 토글하면 이 슬롯-약 매핑을 즉시 추가/제거.
//   - 각 약 옆에 "1일 N회 중 M개 슬롯 배정됨" 가이드(daily_count 대비 현재
//     medication_dose_slots 수). N 모르면(null) "배정: M개 슬롯".
// 처방전/직접등록 진입 버튼 없음 — "내 약 추가는 상단에서" 안내(처방전은 슬롯 단위 아님).
// 시각 입력 없음 — 시간은 슬롯(dose_slots)이 단일 소스. 매핑만 변경.
function MedToSlotSheet({
  slot,
  slots,
  medications,
  medSlotMap,
  onClose,
  onCommitMedSlot,
  onGoRegister,
}: {
  slot: DoseSlot | null;
  slots: DoseSlot[];
  medications: Medication[];
  medSlotMap: Record<string, string[]>;
  onClose: () => void;
  /** "완료" 눌렀을 때만 호출 — 이 슬롯의 최종 약 목록으로 일괄 커밋. */
  onCommitMedSlot: (slotId: string, finalMedIds: string[]) => Promise<void>;
  /** 빈 상태(내 약 0개)에서 "약 등록하러 가기" → 시트 닫고 복용약 등록 진입. */
  onGoRegister: () => void;
}) {
  const { t } = useTranslation();
  const sheetBottomPad = useBottomSheetPadding(28, 12);
  const { translateY, panResponder } = useSwipeToDismiss(onClose);
  // 스테이징: 이 슬롯에 넣을 약 id 로컬 선택 상태(체크/해제는 여기만 토글, DB write 없음).
  // 시트 열 때 그 슬롯의 현재 약 목록으로 초기화. "완료" 눌러야 일괄 커밋.
  const [localMedIds, setLocalMedIds] = useState<Set<string>>(new Set());
  // "완료" 커밋 진행 중(이때만 스피너)
  const [committing, setCommitting] = useState(false);

  const visible = slot !== null;
  const slotId = slot?.id ?? null;

  useEffect(() => {
    // 시트가 열리거나 다른 슬롯으로 바뀔 때마다 로컬 선택을 그 슬롯의 현재 약으로 리셋.
    if (visible && slotId) {
      setLocalMedIds(new Set(medSlotMap[slotId] ?? []));
      setCommitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slotId]);

  if (!slot || !slot.id) return null;
  const thisSlotId = slot.id;
  // 이 슬롯에 "선택된" 약 id 집합(로컬 스테이징 상태).
  const assignedHere = localMedIds;

  // 약별 현재 배정 슬롯 수(모든 슬롯 통틀어). 이 슬롯은 로컬 선택 기준(스테이징 반영).
  const assignedSlotCount = (medId: string): number => {
    let n = 0;
    slots.forEach((s) => {
      if (!s.id) return;
      const inThisSlot = s.id === thisSlotId
        ? assignedHere.has(medId)
        : (medSlotMap[s.id] ?? []).includes(medId);
      if (inThisSlot) n += 1;
    });
    return n;
  };

  const guideText = (med: Medication): string => {
    const m = assignedSlotCount(med.id);
    const n = med.dailyCount ?? null;
    if (n && n > 0) return t('medManage.assignedWithCount', { n, m });
    return t('medManage.assignedNoCount', { m });
  };

  // 약 탭 = 로컬 선택만 토글(즉각 체크 표시, DB write·스피너·깜빡임 없음).
  const handleToggle = (medId: string) => {
    if (committing) return;
    setLocalMedIds((prev) => {
      const next = new Set(prev);
      if (next.has(medId)) next.delete(medId); else next.add(medId);
      return next;
    });
  };

  // "완료" = 로컬 선택을 이 슬롯의 최종 약 목록으로 일괄 커밋 후 시트 닫기.
  const handleDone = async () => {
    if (committing) return;
    setCommitting(true);
    try {
      await onCommitMedSlot(thisSlotId, [...localMedIds]);
      onClose();
    } catch {
      // 실패 안내는 부모(onCommitMedSlot)에서 처리 — 시트는 닫지 않고 재시도 가능하게 유지.
      setCommitting(false);
    }
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={mtsStyles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[mtsStyles.sheet, { paddingBottom: sheetBottomPad, transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={mtsStyles.grab} />
            <Text style={mtsStyles.title}>
              {t('medManage.slotMedsTitle', { slot: slotTitle(slot.label, slot.legacyKey, slot.time) })}
            </Text>
            <Text style={mtsStyles.sub}>
              {t('medManage.slotMedsSub')}
            </Text>

            {/* 새 약 추가 안내 = 박스 전체 버튼 → 복용약 관리 메뉴로 이동 */}
            {medications.length > 0 && (
              <TouchableOpacity
                style={mtsStyles.guideBanner}
                onPress={onGoRegister}
                activeOpacity={0.8}
              >
                <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
                <Text style={mtsStyles.guideBannerText}>
                  {t('medManage.addMedGuide')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
              </TouchableOpacity>
            )}

            {/* 약 ~4개 높이까지만, 그 이상은 스크롤(내용 적으면 그만큼만 차지) */}
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {medications.length === 0 ? (
                <View style={mtsStyles.emptyWrap}>
                  <Ionicons name="medkit-outline" size={52} color={Colors.textHint} />
                  <Text style={mtsStyles.emptyText}>
                    {t('medManage.noMedsRegistered')}
                  </Text>
                  <TouchableOpacity
                    style={mtsStyles.emptyRegisterBtn}
                    onPress={onGoRegister}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle-outline" size={24} color={Colors.white} />
                    <Text style={mtsStyles.emptyRegisterBtnText}>{t('medManage.goRegister')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                medications.map((m) => {
                  const checked = assignedHere.has(m.id);
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[mtsStyles.medRow, checked && mtsStyles.medRowOn]}
                      onPress={() => handleToggle(m.id)}
                      activeOpacity={0.8}
                      disabled={committing}
                    >
                      {m.drugInfo?.itemImage ? (
                        <Image source={{ uri: m.drugInfo.itemImage }} style={mtsStyles.medImg} resizeMode="contain" />
                      ) : (
                        <View style={[mtsStyles.medImg, mtsStyles.medImgPlaceholder]}>
                          <Text style={{ fontSize: 18 }}>💊</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={mtsStyles.medName}>{m.name}</Text>
                        <Text style={mtsStyles.medGuide}>{guideText(m)}</Text>
                      </View>
                      <View style={[mtsStyles.chkBox, checked && mtsStyles.chkBoxOn]}>
                        {checked && <Ionicons name="checkmark-sharp" size={18} color={Colors.white} />}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              <View style={{ height: 20 }} />
            </ScrollView>

            {/* 취소 · 완료 한 줄. 체크는 임시(로컬)이고 "완료"를 눌러야 실제 반영. */}
            <View style={mtsStyles.btnRow}>
              <TouchableOpacity
                style={mtsStyles.cancelBtn}
                onPress={onClose}
                activeOpacity={0.7}
                disabled={committing}
              >
                <Text style={mtsStyles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[mtsStyles.doneBtn, committing && mtsStyles.doneBtnDisabled]}
                onPress={handleDone}
                activeOpacity={0.85}
                disabled={committing}
              >
                <Text style={mtsStyles.doneBtnText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
    <BrandProgressOverlay
      visible={committing}
      title={i18n.t('loading.savingMed')}
      minVisibleMs={500}
    />
    </>
  );
}

const mtsStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%', // 내용 높이에 맞춰 줄고/늘되, 화면 90% 넘지 않게(안전 상한)
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grab: { width: 42, height: 5, borderRadius: 3, backgroundColor: '#D7DBE1', alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  sub: { fontSize: 15, color: Colors.textSub, marginBottom: 14, lineHeight: 22 },
  guideBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.light, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
  },
  guideBannerText: { flex: 1, fontSize: 16, color: Colors.dark, fontWeight: '600', lineHeight: 22 },
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 16 },
  emptyText: { fontSize: 18, color: Colors.textSub, textAlign: 'center', lineHeight: 27 },
  emptyRegisterBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, borderRadius: 14, backgroundColor: Colors.primary,
    paddingHorizontal: 24, marginTop: 4,
  },
  emptyRegisterBtnText: { fontSize: 18, fontWeight: '800', color: Colors.white },
  medRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 10,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1.6, borderColor: '#F0F2F5', backgroundColor: Colors.white,
  },
  medRowOn: { borderColor: Colors.primary, backgroundColor: Colors.light },
  medImg: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#F5F5F5' },
  medImgPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF1F4' },
  medName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  medGuide: { fontSize: 16, color: Colors.textSub, marginTop: 3, fontWeight: '600' },
  chkBox: {
    width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: '#CDD2DA',
    alignItems: 'center', justifyContent: 'center',
  },
  chkBoxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  // 닫기·완료 한 줄
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1, minHeight: 58, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 19, fontWeight: '700', color: Colors.textSub },
  doneBtn: {
    flex: 1, minHeight: 58, borderRadius: 14, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  doneBtnText: { fontSize: 19, fontWeight: '800', color: Colors.white },
  doneBtnDisabled: { opacity: 0.7 },
});

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface MedicationManageScreenProps {
  // 해외판 탭 내부(OverseasMedTabScreen)에서 세그먼트 전환용으로 mode를 직접 넘길 때 사용.
  // route.params보다 우선. 국내 기존 진입(스택 라우트)은 그대로 route.params로 동작(하위호환).
  modeOverride?: 'meds' | 'slots';
  // 해외 탭 내부 임베드 시 뒤로가기 버튼 숨김(탭 루트라 뒤로갈 스택이 없음).
  hideBack?: boolean;
  // 해외 탭 내부 임베드 시 이 화면 자체 TopBar를 완전히 숨김(바깥 OverseasMedTabScreen이
  // 정식 TopBar+세그먼트 탭을 이미 그리므로 중복 방지). true면 SafeAreaView top 인셋도 부모가 처리.
  hideTopBar?: boolean;
  // 슬롯 편집 중 "약 등록하러 가기" CTA를 눌렀을 때의 동작. 지정 시 DoseSlotSetList로 그대로 전달됨
  // (해외판 OverseasMedTabScreen이 로컬 세그먼트 전환 콜백을 넘겨 다른 탭으로 안 벗어나게 함).
  onGoRegisterMeds?: () => void;
  // 다른 화면(설정의 '환자 알림 설정')의 ScrollView 안에 인라인 임베드할 때 true.
  //  → 자체 flex:1/ScrollView 를 걷어내고 콘텐츠 높이만 차지(부모 스크롤이 담당, 중첩 스크롤 방지).
  embedded?: boolean;
}

// 기본 제공 알림음(프리셋) → 피커 옵션. 미리듣기는 번들 mp3 로컬 재생(재빌드 전에도 동작).
const PRESET_SOUND_OPTIONS: AlarmSoundOption[] = PRESET_ALARM_SOUNDS.map((p) => ({
  id: p.id,
  label: presetSoundDisplayName(p),
  durationSec: Math.round(p.durationMs / 1000),
  group: 'preset' as const,
  previewAsset: PRESET_PREVIEW_ASSETS[p.fileId] ?? null,
}));

// 약효추적 오프셋(분) → 안내 문구. 0=복용 직후, 그 외 "복용 후 N시간 M분".
function offsetLine(min: number, en: boolean): string {
  if (min <= 0) return en ? 'Right after taking' : '복용 직후';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (en) {
    const parts: string[] = [];
    if (h) parts.push(`${h} hr`);
    if (m) parts.push(`${m} min`);
    return `${parts.join(' ')} after`;
  }
  if (h && m) return `복용 후 ${h}시간 ${m}분`;
  if (h) return `복용 후 ${h}시간`;
  return `복용 후 ${m}분`;
}

export function MedicationManageScreen({ modeOverride, hideBack, hideTopBar, onGoRegisterMeds, embedded }: MedicationManageScreenProps = {}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { getPatientForCaregiver } = useFamilyLink();
  const { unreadCount } = useNotificationBadge();
  const { medNotifs } = useSettings();
  const dialog = useDialog();
  // 바텀시트 하단 버튼이 안드 3버튼 내비에 가리지 않도록(글로벌 규칙).
  const sheetBottomPad = useBottomSheetPadding(40);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<MenuStackParamList, 'MedicationManage'>>();
  // 진입 mode: 'meds'(내 약) | 'slots'(복용 시간·알림). 기본 'slots'(기존 진입 호환).
  const mode: 'meds' | 'slots' = modeOverride ?? route.params?.mode ?? 'slots';

  // 온보딩 직후 강제 진입(guideSetup) 시 1회 안내 팝업 — 여기서 약 등록·알림 켜기 안내.
  const setupGuideShownRef = useRef(false);
  useEffect(() => {
    if (route.params?.guideSetup && !setupGuideShownRef.current) {
      setupGuideShownRef.current = true;
      setTimeout(() => {
        dialog.alert({ title: t('medManage.setupGuideTitle'), message: t('medManage.setupGuideMsg') });
      }, 350);
    }
  }, [route.params?.guideSetup]);

  const [medications, setMedications] = useState<Medication[]>([]);
  // 복용약 realtime — 채널 이름은 마운트당 고유 1회만 생성(인라인 Math.random() 금지).
  //  인라인으로 매 구독 effect 마다 새 난수를 쓰면 채널이 계속 다른 이름으로 재생성된다.
  const medRtChannelId = useRef(Math.random().toString(36).slice(2, 10));
  // 콜백 stale 클로저 방지: 구독은 항상 ref 로 최신 loadMedications 를 호출한다.
  //  (loadMedications 를 구독 effect deps 에 넣으면 user 참조 변동마다 채널이 끊겼다
  //   붙어 그 사이 medications 이벤트를 놓친다 — dose_slots 가 안 끊기는 것과 대비됨.)
  const loadMedicationsRef = useRef<(opts?: { silent?: boolean }) => void>(() => {});
  // 환자에게 dose_slots(이관/신규)가 1개 이상 있으면 true → 표시 슬롯/시각 폴백의 단일 기준.
  // (true면 약 카드/섹션 시각은 dose_slots 조인 우선, false면 legacy meal_schedules)
  const [hasDoseSlots, setHasDoseSlots] = useState(false);

  // ── 통합 복용 관리(슬롯 중심) 상태 ──────────────────────────────────────────
  // 슬롯 목록(시간 빠른 순) — dose_slots 단일 소스. 각 슬롯에 어떤 약이 매핑됐는지는
  // medication_dose_slots 조인으로 medSlotMap(slotId → medId[])에 담는다.
  const [doseSlotList, setDoseSlotList] = useState<DoseSlot[]>([]);
  const [medSlotMap, setMedSlotMap] = useState<Record<string, string[]>>({}); // slotId → medId[]

  // 정시 복용 '알람처럼'/'30초' 로컬 알람 재예약 — 환자 본인이 자기 슬롯 편집 시 즉시 반영.
  //   보호자가 환자 알림을 편집할 땐 role!=='patient' 라 여기서 예약 안 함(환자 기기가 반영).
  const remindAlarmSignature = useMemo(
    () =>
      doseSlotList
        .map((s) => `${s.id}|${s.time}|${s.remindEnabled ? 1 : 0}|${s.remindAlarmMode}|${s.remindSoundId ?? ''}`)
        .join(','),
    [doseSlotList],
  );
  useEffect(() => {
    if (user?.role !== 'patient') return;
    void rescheduleRemindAlarms(doseSlotList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindAlarmSignature, user?.role]);
  // 최신 loadDoseSlots 를 참조하는 ref — 콜백/모달 닫기에서 deps 안정적으로 재조회 호출용.
  // (loadDoseSlots 는 아래에서 선언되지만, ref 는 실제 호출 시점에 이미 채워져 있다.)
  const loadDoseSlotsRef = useRef<() => void>(() => {});
  // [안전망] 0슬롯 환자 1회 자동 생성 가드 — 환자(patientId)당 1번만 시도(무한 루프 방지).
  const autoEnsuredSlotsForRef = useRef<string | null>(null);
  // 약 넣기·빼기 바텀시트(이 슬롯에 약을 배정/해제)
  const [medSheetSlot, setMedSheetSlot] = useState<DoseSlot | null>(null);
  // 시간·알림 수정(DoseSlotSetList 재사용) 모달
  const [slotAlarmEditVisible, setSlotAlarmEditVisible] = useState(false);
  // 슬롯 카드 "시간·알림 바꾸기" 진입 시 펼칠 슬롯 id(없으면 전체 관리).
  const [slotAlarmFocusId, setSlotAlarmFocusId] = useState<string | null>(null);
  // 같은 슬롯을 다시 열어도 포커스가 재적용되도록 하는 진입 토큰.
  const [slotAlarmFocusNonce, setSlotAlarmFocusNonce] = useState(0);
  // "복용 시간대 추가"로 진입할 때 모달 안에서 곧장 시간 추가 시트를 열게 하는 토큰.
  // 0이면 전체 관리 모드(추가 시트 자동 안 열림). >0이면 마운트 즉시 시간 추가 시트.
  const [slotAlarmAddNonce, setSlotAlarmAddNonce] = useState(0);
  // 추가 전용 진입 여부 — true면 전체 슬롯 목록(관리 UI)을 렌더하지 않고 시간 선택 시트만
  // 띄운다(시트 2겹 방지). 시트를 닫거나 저장하면 모달 전체를 닫아 본 화면으로 복귀.
  const [slotAlarmAddOnly, setSlotAlarmAddOnly] = useState(false);
  // 시간·알림 모달 내부 ScrollView ref — 포커스 슬롯으로 스크롤 위임용.
  const slotAlarmScrollRef = useRef<ScrollView>(null);

  // ── 편집/추가한 슬롯으로 본 화면 복귀 스크롤 ────────────────────────────────
  // (오너 요청 2026-07-27: 알림을 추가하거나 시간을 수정하고 목록으로 돌아오면 그 슬롯이 보여야 한다.
  //  전엔 항상 맨 위로 돌아와 어디가 바뀌었는지 확인하려면 직접 찾아 내려야 했다.)
  // 카드 y 는 onLayout 으로 수집(best-effort). 새로 추가한 슬롯은 목록 재조회 후에야 카드가
  // 생기므로, pending 에 넣어두고 그 카드가 레이아웃될 때 소비한다.
  const mainScrollRef = useRef<ScrollView>(null);
  const slotCardY = useRef<Map<string, number>>(new Map());
  const pendingSlotScrollRef = useRef<string | null>(null);
  // 이번에 추가/수정한 슬롯 id — 모달을 닫을 때 이 슬롯으로 스크롤한다.
  const touchedSlotRef = useRef<string | null>(null);

  const scrollToSlotCard = useCallback((slotId: string) => {
    pendingSlotScrollRef.current = slotId;
    const y = slotCardY.current.get(slotId);
    if (y == null) return; // 아직 카드 없음 → onLayout 에서 소비
    setTimeout(() => {
      if (pendingSlotScrollRef.current !== slotId) return;
      pendingSlotScrollRef.current = null;
      (mainScrollRef.current as any)?.scrollTo?.({ y: Math.max(0, y - 12), animated: true });
    }, 180);
  }, []);

  // 특정 슬롯으로 포커스(펼침+스크롤)해서 모달 열기(슬롯 카드 "수정" 진입).
  const openSlotAlarmEdit = useCallback((slotId: string | null) => {
    touchedSlotRef.current = slotId;
    setSlotAlarmFocusId(slotId);
    setSlotAlarmFocusNonce((n) => n + 1);
    setSlotAlarmAddNonce(0); // 수정 진입은 추가 시트 자동 열기 안 함
    setSlotAlarmAddOnly(false);
    setSlotAlarmEditVisible(true);
  }, []);
  // "복용 시간대 추가" 진입 — 전체 관리 목록(관리 모달 UI) 없이 시간 선택 시트만 띄운다.
  // addOnly=true 로 DoseSlotSetList 가 목록을 렌더하지 않게 하고, 시트를 닫거나 저장하면
  // onAddDone(=closeSlotAlarmEdit) 으로 모달 전체를 닫아 본 화면(슬롯 목록)으로 복귀한다.
  const openSlotAlarmAdd = useCallback(() => {
    setSlotAlarmFocusId(null);
    setSlotAlarmAddNonce((n) => n + 1);
    setSlotAlarmAddOnly(true);
    setSlotAlarmEditVisible(true);
  }, []);
  const closeSlotAlarmEdit = useCallback(() => {
    setSlotAlarmEditVisible(false);
    // 닫을 때 포커스/추가모드 초기화 — 다음에 전체 관리로 열면 포커스 없이 뜸.
    setSlotAlarmFocusId(null);
    setSlotAlarmAddNonce(0);
    setSlotAlarmAddOnly(false);
    // 슬롯 수정(시각/라벨/알림설정) 후 닫을 때 본 화면 슬롯 리스트를 즉시 재조회한다.
    // (추가/삭제는 별도 경로에서 이미 loadDoseSlots 를 부르지만, 단일 슬롯 "수정"은
    //  realtime UPDATE 전달에만 의존해 늦거나 누락되면 화면을 떠났다 와야 반영됐다.
    //  명시 재조회로 추가/삭제와 동일하게 닫는 즉시 최신값을 반영한다. realtime 은 보강책으로 유지.)
    loadDoseSlotsRef.current();
    // 방금 추가/수정한 슬롯이 화면에 보이도록 그 카드로 스크롤(없으면 아무 일도 안 함).
    const touched = touchedSlotRef.current;
    touchedSlotRef.current = null;
    if (touched) scrollToSlotCard(touched);
  }, [scrollToSlotCard]);
  // "복용 시간대 추가" 시간 선택 시트 처리 완료 콜백.
  //  - newSlotId 있음(저장 성공) → 모달을 닫지 않고 그 새 슬롯의 수정 시트(soloSlotId 단일 편집)로 전환.
  //    addOnly 호스트(시간 시트) 인스턴스가 언마운트되고 soloSlotId 편집 인스턴스가 마운트되며,
  //    같은 Modal 안에서 내용만 교체되어 깜빡임/전체목록 노출 없이 곧바로 알림·소리·약효추적 설정 화면으로 진입.
  //  - newSlotId 없음(취소/닫기 또는 id 확보 실패) → 기존처럼 모달 닫고 본 화면(슬롯 목록)으로 복귀.
  const handleSlotAlarmAddDone = useCallback((newSlotId?: string) => {
    if (newSlotId) {
      touchedSlotRef.current = newSlotId; // 닫을 때 이 새 슬롯으로 스크롤
      setSlotAlarmAddOnly(false);
      setSlotAlarmAddNonce(0);
      setSlotAlarmFocusId(newSlotId);
      setSlotAlarmFocusNonce((n) => n + 1);
      setSlotAlarmEditVisible(true); // 이미 열려 있지만 명시(전환 보장)
    } else {
      closeSlotAlarmEdit();
    }
  }, [closeSlotAlarmEdit]);
  // 슬롯(복용 시간대) 삭제 — DoseSlotSetList.onDeleteSlot 와 동일 정책으로 일원화.
  // 흐름: 이 시각에 쌓인 기록(med_logs+on_off_logs) 건수를 먼저 조회 →
  //   · 0건  : 기존처럼 확인 후 슬롯만 soft delete(is_active=false). 기록 없음.
  //   · 1건+ : "이 시간대에 기록이 N건 있어요. 기록도 함께 삭제할까요?" 2버튼.
  //       - 기록도 함께 삭제 → 서버 RPC(delete_dose_slot_with_records)로 슬롯+기록 일괄 삭제.
  //       - 기록은 남기기   → 기존 soft delete(슬롯만). 기록은 보존.
  // (이전엔 이 핸들러가 항상 옛 확인 팝업만 띄워, DoseSlotSetList 에 넣은 새 분기가 안 보였음.)
  const handleDeleteSlot = async (slot: DoseSlot) => {
    if (!slot.id) return;
    const id = slot.id;
    const pid = targetPatientId;

    // 삭제 성공 후 공통 로컬 정리(캐시 무효화 + 재조회).
    const finishRemoval = () => {
      if (pid) invalidateDoseSlotsCache(pid);
      loadDoseSlots();
    };

    // 슬롯만 soft delete(기록 보존).
    const softDeleteOnly = async () => {
      const takenToday = await hasTakenTodayKST(pid, id, user?.timezone);
      try {
        const { error } = await supabase.from('dose_slots').update({ is_active: false }).eq('id', id);
        if (error) throw error;
        finishRemoval();
        await dialog.alert(deleteSlotCombinedPopup(takenToday));
      } catch (e) {
        console.error('[MedicationManageScreen] dose_slot 삭제 실패:', e);
        await dialog.alert({ message: t('medManage.deleteFailMsg') });
      }
    };

    // 슬롯 + 이 시각의 기록까지 서버에서 함께 삭제(RPC).
    const deleteWithRecords = async () => {
      const takenToday = await hasTakenTodayKST(pid, id, user?.timezone);
      try {
        const { error } = await supabase.rpc('delete_dose_slot_with_records', { p_dose_slot_id: id });
        if (error) throw error;
        finishRemoval();
        await dialog.alert(deleteSlotCombinedPopup(takenToday));
      } catch (e) {
        console.error('[MedicationManageScreen] 슬롯+기록 삭제(RPC) 실패:', e);
        await dialog.alert({ message: t('medManage.deleteFailMsg') });
      }
    };

    // 1) 이 슬롯에 연결된 기록 건수 조회(med_logs + on_off_logs). RLS 로 권한 제한됨.
    //    조회가 실패하면 보수적으로 "기록이 있을 수 있다"고 보고 함께-삭제 분기를 띄운다
    //    (조용히 0 취급해 옛 팝업으로 빠지지 않게).
    let recordCount: number | null = 0;
    try {
      let medQ = supabase
        .from('med_logs')
        .select('id', { count: 'exact', head: true })
        .eq('dose_slot_id', id);
      let onoffQ = supabase
        .from('on_off_logs')
        .select('id', { count: 'exact', head: true })
        .eq('dose_slot_id', id);
      if (pid) {
        medQ = medQ.eq('patient_id', pid);
        onoffQ = onoffQ.eq('patient_id', pid);
      }
      const [medRes, onoffRes] = await Promise.all([medQ, onoffQ]);
      if (medRes.error || onoffRes.error) throw medRes.error ?? onoffRes.error;
      recordCount = (medRes.count ?? 0) + (onoffRes.count ?? 0);
    } catch (e) {
      console.error('[MedicationManageScreen] 슬롯 기록 건수 조회 실패:', e);
      recordCount = null; // 불명 → 보수적으로 함께-삭제 선택지를 띄움
    }

    // 2) 기록 0건 → 기존처럼 확인 후 슬롯만 삭제.
    if (recordCount === 0) {
      const ok = await dialog.confirm({
        title: t('medManage.deleteSlotTitle'),
        message: t('medManage.deleteSlotMsg', { slot: slotTitle(slot.label, slot.legacyKey, slot.time) }),
        confirmText: t('medManage.delete'),
        cancelText: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
      await softDeleteOnly();
      return;
    }

    // 3) 기록 1건 이상(또는 조회 불명) → 기록까지 함께 삭제할지 2버튼 선택.
    const choice = await dialog.show({
      title:
        recordCount === null
          ? t('medManage.recordsMayExist')
          : t('medManage.recordsCount', { count: recordCount }),
      message: t('medManage.deleteWithRecordsQ'),
      buttons: [
        { id: 'withRecords', text: t('medManage.deleteWithRecords'), style: 'destructiveSolid', row: true },
        { id: 'keepRecords', text: t('medManage.keepRecords'), style: 'destructive', row: true },
        { id: 'cancel', text: t('common.close'), style: 'cancel' },
      ],
    });
    if (choice === 'withRecords') {
      await deleteWithRecords();
    } else if (choice === 'keepRecords') {
      await softDeleteOnly();
    }
    // choice === 'cancel'(닫기 버튼) / null(배경·뒤로 닫음) → 아무 동작 없음(취소).
  };
  // 메뉴 3등분(1단계): 진입 mode 로 뷰 고정.
  //  - 'meds'  = 내 약(약 등록·목록·수정). 슬롯/시간대 일절 없음.
  //  - 'slots' = 복용 시간·알림(슬롯 카드·약 넣기·시간/알림). 기본값(기존 진입 호환).
  // (showAllMeds 토글 → mode 로 대체. 두 메뉴가 각 뷰로 직행, 화면 내 전환 버튼 없음.)
  const isMedsMode = mode === 'meds';
  // 중단한 약(is_active=false & ended_at 있음) — 이력 표시 전용. (가) 가벼운 방식.
  const [stoppedMeds, setStoppedMeds] = useState<StoppedMed[]>([]);
  // 알림 소리 옵션(그룹 녹음) — DoseSlotSetList 에 전달.
  const [alarmSounds, setAlarmSounds] = useState<AlarmSoundOption[]>([]);

  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Medication | null>(null);
  const [targetPatientId, setTargetPatientId] = useState<string | null>(null);
  // 환자 기기 플랫폼 — '알람처럼'(전체화면 알람)은 안드로이드 전용 기능이라, 실제로 알림이
  // 울리는 대상(환자 기기) 기준으로 옵션 노출 여부를 판단한다(편집자=보호자 기기와 무관).
  const [targetPatientPlatform, setTargetPatientPlatform] = useState<'android' | 'ios' | null>(null);
  // 대상 환자 해석 완료 여부 — 로딩 중(false)과 "미연동(true+null)" 구분. 깜빡임/오판 방지.
  const [targetLoadDone, setTargetLoadDone] = useState(false);

  // ── 온보딩 약효추적 유도(guideEffectTracking) — 복약시간 등록 후 slots 도착 시 1회 팝업 ──
  //   [약 등록하고 설정] → 약 등록(meds, onboarding 플래그) / [약 없이 기본] → 기본 시점으로 켜기 / [나중에]
  const etGuideShownRef = useRef(false);
  useEffect(() => {
    if (!route.params?.guideEffectTracking || etGuideShownRef.current) return;
    etGuideShownRef.current = true;
    setTimeout(async () => {
      const picked = await dialog.show({
        title: t('medManage.etGuideTitle'),
        message: t('medManage.etGuideMsg'),
        buttons: [
          { id: 'meds', text: t('medManage.etGuideRegisterMeds') },
          { id: 'default', text: t('medManage.etGuideDefault') },
          { id: 'later', text: t('medManage.etGuideLater'), style: 'cancel' },
        ],
      });
      if (picked === 'meds') {
        navigation.navigate('MedicationManage', { mode: 'meds', onboardingEffectTracking: true });
      } else if (picked === 'default') {
        const pid = targetPatientId ?? user?.id ?? null;
        if (pid) {
          try {
            await supabase
              .from('dose_slots' as any)
              .update({ track_enabled: true, track_intervals: [0, 30, 120] })
              .eq('patient_id', pid)
              .eq('is_active', true);
            dialog.alert({ title: t('medManage.etDefaultDoneTitle'), message: t('medManage.etDefaultDoneMsg') });
          } catch {
            /* 실패해도 조용히 — 사용자가 슬롯에서 직접 켤 수 있음 */
          }
        }
      }
      // 'later' → 아무것도 안 함
    }, 400);
  }, [route.params?.guideEffectTracking, targetPatientId]);

  // ── 약 등록 후 복귀(openEffectTrackingAfterMeds) →
  //    ① 약효추적 안내 팝업(레보도파=엔진 정확값+출처 / 비레보도파=기본값+의사상담 안내)
  //    → 확인 시 그 시각으로 track 반영 → ② 약별 복용 시간대 배정 모달(setAssignVisible). ──
  const [assignVisible, setAssignVisible] = useState(false);
  const etAfterMedsShownRef = useRef(false);
  useEffect(() => {
    if (!route.params?.openEffectTrackingAfterMeds || etAfterMedsShownRef.current) return;
    etAfterMedsShownRef.current = true;
    const en = (i18n.language || '').toLowerCase().startsWith('en');
    setTimeout(async () => {
      const pid = targetPatientId ?? user?.id ?? null;
      if (!pid) return;
      let intervals: number[] = [0, 30, 120];
      let message = '';
      try {
        const { data: medRows } = await supabase
          .from('medications')
          .select('name')
          .eq('patient_id', pid)
          .eq('is_active', true);
        // 약명 기반 판정(DoseSlotSetList 와 동일 패턴). 레보도파 계열이면 offsets 채워짐.
        const rec = recommendForSlotMeds(((medRows as any[]) ?? []).map((m) => ({ name: m.name })));
        if (rec.offsets.length > 0) {
          // 레보도파 계열 → 엔진 정확값 + 출처 표기.
          // ⚠️ 약효추적은 "복용 직후(0)"가 기준선(baseline)으로 필수 → 항상 앞에 포함.
          intervals = Array.from(new Set([0, ...rec.offsets])).sort((a, b) => a - b);
          const bullets = intervals.map((o) => `· ${offsetLine(o, en)}`).join('\n');
          message =
            t('medManage.etTrackLevodopaIntro', { names: rec.levodopaNames.join('·') }) +
            '\n\n' + bullets +
            '\n\n(' + t('medManage.etTrackSource', { source: rec.source }) + ')';
        } else {
          // 비레보도파/매칭 실패 → 표준 기본값. 출처 없이 의사 상담 소프트 안내.
          intervals = [0, 30, 120];
          const bullets = intervals.map((o) => `· ${offsetLine(o, en)}`).join('\n');
          message =
            t('medManage.etTrackDefaultIntro') +
            '\n\n' + bullets +
            '\n\n' + t('medManage.etTrackDoctorNote');
        }
      } catch {
        intervals = [0, 30, 120];
        const bullets = intervals.map((o) => `· ${offsetLine(o, en)}`).join('\n');
        message =
          t('medManage.etTrackDefaultIntro') + '\n\n' + bullets + '\n\n' + t('medManage.etTrackDoctorNote');
      }
      // 확인을 누르면 그 시각으로 반영(단일 확인 버튼).
      await dialog.alert({ title: t('medManage.etTrackTitle'), message });
      try {
        await supabase
          .from('dose_slots' as any)
          .update({ track_enabled: true, track_intervals: intervals })
          .eq('patient_id', pid)
          .eq('is_active', true);
      } catch {
        /* 실패해도 조용히 — 슬롯에서 직접 켤 수 있음 */
      }
      loadDoseSlotsRef.current?.();
      // ② 약별 복용 시간대 배정 모달로 마무리.
      setAssignVisible(true);
    }, 400);
  }, [route.params?.openEffectTrackingAfterMeds, targetPatientId]);

  // 직접 입력 폼 ("내 약 전체 보기" = 복용약 등록·관리 페이지의 상시 노출 폼).
  const [addName, setAddName] = useState('');
  const [addDosage, setAddDosage] = useState('');
  // 복용량 단위 칩 선택값 (숫자칸이 비어도 유지). 기본 '정' — OCR 시트와 동일 패턴.
  const [addDosageUnit, setAddDosageUnit] = useState<'정' | 'mg'>('정');
  // 복용횟수 = 숫자만(저장 시 daily_count 정수). 단위(1일/1주)는 addCountUnit.
  const [addDailyCount, setAddDailyCount] = useState('');
  // 횟수 입력값 ref(재렌더로 controlled state 흔들려도 보존) + 제출 후 입력칸 리마운트용 nonce.
  const addCountRef = useRef('');
  const [addCountNonce, setAddCountNonce] = useState(0);
  const [addCountUnit, setAddCountUnit] = useState<'day' | 'week'>('day');
  const [addDrugInfo, setAddDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isMfdsLoading, setIsMfdsLoading] = useState(false);

  // 인라인 수정 모드 (등록된 약 수정)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDosage, setEditDosage] = useState('');
  // 복용량 단위 칩 선택값 (숫자칸이 비어도 유지). 기본 '정' — OCR 시트/직접등록과 동일 패턴.
  const [editDosageUnit, setEditDosageUnit] = useState<'정' | 'mg'>('정');
  const [editDailyCount, setEditDailyCount] = useState('');
  // 횟수 입력값을 ref로도 보관 — 재렌더로 controlled state가 흔들려도 저장 시점에 확실히 캡처.
  const editCountRef = useRef('');
  const [editCountUnit, setEditCountUnit] = useState<'day' | 'week'>('day');
  const [editDrugInfo, setEditDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isEditMfdsLoading, setIsEditMfdsLoading] = useState(false);

  // OCR 결과 확인 바텀시트
  const [ocrResultVisible, setOcrResultVisible] = useState(false);
  const [ocrRawText, setOcrRawText] = useState<string>('');
  const [ocrEnrichedMeds, setOcrEnrichedMeds] = useState<Array<{
    id: string;
    name: string;
    ediCode: string;
    dailyCount?: number | null;
    countUnit?: 'day' | 'week';
    dosage?: string | null;
    /** 1회 투약량 단위 칩 선택값 (숫자칸이 비어도 유지). 기본 '정' */
    dosageUnit?: '정' | 'mg';
    times: TimeSlot[];
    schedules?: MealSchedules;
    drugInfo?: DrugInfo | null;
    doseSlots?: MedDoseSlot[];
    checked: boolean;
    /** 식약처 불러오기 결과 상태: undefined=아직 안 누름, true=확인됨, false=못 찾음 */
    mfdsFetched?: boolean;
  }>>([]);
  // OCR 결과 시트에서 행별 식약처 불러오기 로딩 표시(약 id 집합).
  const [ocrMfdsLoadingIds, setOcrMfdsLoadingIds] = useState<Set<string>>(new Set());

  // OCR 결과 시트 키보드 회피 — Modal 안 바텀시트라 안드 adjustResize가 적용 안 됨.
  // (PostDetailScreen과 동일 패턴) 안드는 키보드 높이를 직접 받아 ScrollView 하단에
  // 그만큼 스페이서를 줘 포커스된 입력칸이 키보드 위로 스크롤되게 한다. iOS는 KeyboardAvoidingView가 처리.
  const ocrScrollRef = useRef<ScrollView>(null);
  // 카드별 ScrollView 내 y 오프셋(onLayout). 포커스 시 그 카드로 스크롤.
  const ocrCardY = useRef<Record<string, number>>({});
  const [ocrKbHeight, setOcrKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setOcrKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setOcrKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  // 포커스된 카드를 키보드 위로 올림 — TextInput onFocus에서 카드 y로 스크롤.
  const scrollOcrFocusedInput = useCallback((y: number) => {
    setTimeout(() => ocrScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), 80);
  }, []);

  // OCR 결과 시트 — 특정 행의 (수정된) 이름으로 식약처 정보 불러오기.
  const handleFetchMfdsForOcrRow = useCallback(async (medId: string) => {
    const target = ocrEnrichedMeds.find(m => m.id === medId);
    const name = (target?.name ?? '').trim();
    if (!name) { await dialog.alert({ message: t('medManage.medNameRequired') }); return; }
    setOcrMfdsLoadingIds(prev => { const next = new Set(prev); next.add(medId); return next; });
    try {
      const info = await searchMfdsInfo(name);
      setOcrEnrichedMeds(prev => prev.map(m =>
        m.id === medId ? { ...m, drugInfo: info, mfdsFetched: true } : m
      ));
    } finally {
      setOcrMfdsLoadingIds(prev => { const next = new Set(prev); next.delete(medId); return next; });
    }
  }, [ocrEnrichedMeds, dialog]);

  // 대상 환자 id 결정
  useEffect(() => {
    if (!user) return;
    if (user.role === 'caregiver') {
      setTargetLoadDone(false);
      getPatientForCaregiver().then(patient => {
        setTargetPatientId(patient?.id ?? null);
        setTargetLoadDone(true);
      });
    } else {
      setTargetPatientId(user.id);
      setTargetLoadDone(true);
    }
  }, [user, getPatientForCaregiver]);

  // 미연동 보호자: 보호자인데 환자 해석 끝났고 대상 환자 없음 → 환자 본인 경로는 절대 영향 없음
  const caregiverUnlinked = user?.role === 'caregiver' && targetLoadDone && targetPatientId == null;

  // 환자 기기 플랫폼 조회('알람처럼' 옵션 노출 판단용). 본인(환자)이 직접 보는 경우도 포함.
  useEffect(() => {
    if (!targetPatientId) { setTargetPatientPlatform(null); return; }
    supabase
      .from('users')
      .select('push_platform')
      .eq('id', targetPatientId)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data as any)?.push_platform;
        setTargetPatientPlatform(p === 'ios' || p === 'android' ? p : null);
      });
  }, [targetPatientId]);

  // ── DB 로드 ────────────────────────────────────────────────────────────

  // silent=true: 백그라운드 realtime 갱신 — 전체 스켈레톤(setIsLoading)을 켜지 않고 데이터만 갱신.
  // (스켈레톤 early-return 이 editSheet Modal 을 언마운트해 약 토글마다 시트가 닫혔다 열리던 버그 차단.)
  const loadMedications = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const pid = targetPatientId;
    if (!user || !pid) return;
    if (!silent) setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('patient_id', pid)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const baseMeds: Medication[] = (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        dosage: row.dosage ?? null,
        dailyCount: row.daily_count ?? null,
        countUnit: (row.count_unit ?? 'day') as 'day' | 'week',
        times: (row.meal_times ?? []) as TimeSlot[],
        schedules: (row.meal_schedules ?? {}) as MealSchedules,
        // drug_image_url 또는 item_seq 중 하나라도 있으면 drugInfo 구성(itemSeq=허가정보 직행용)
        drugInfo: (row.drug_image_url || row.item_seq)
          ? { itemName: row.name, itemImage: row.drug_image_url ?? undefined, itemSeq: row.item_seq ?? undefined }
          : undefined,
      }));

      // ── 표시용 dose_slots 조인 (읽기 전용) ──────────────────────────────────
      // 이관/신규 환자: medication_dose_slots(M:N) → dose_slots 의 time/label 로 표시.
      // 없으면 hasDoseSlots=false → 기존 legacy(meal_times/meal_schedules) 폴백.
      // ⚠️ 쓰기 경로(meal_times/meal_schedules)는 전혀 건드리지 않음.
      let medsWithSlots = baseMeds;
      let patientHasDoseSlots = false;
      try {
        const medIds = baseMeds.map((m) => m.id);
        const { data: slotJoin, error: slotErr } = await supabase
          .from('medication_dose_slots')
          .select('medication_id, dose_slots!inner(label, time, sort_order, is_active, patient_id)')
          .eq('dose_slots.patient_id', pid)
          .eq('dose_slots.is_active', true)
          .in('medication_id', medIds.length > 0 ? medIds : ['__none__']);
        if (slotErr) throw slotErr;

        const byMed = new Map<string, MedDoseSlot[]>();
        (slotJoin ?? []).forEach((row: any) => {
          const ds = row.dose_slots;
          if (!ds) return;
          patientHasDoseSlots = true;
          const list = byMed.get(row.medication_id) ?? [];
          list.push({
            key: labelToLegacyKey(ds.label),
            time: normalizeHhmm(ds.time),
            sortOrder: ds.sort_order ?? 0,
          });
          byMed.set(row.medication_id, list);
        });

        if (patientHasDoseSlots) {
          medsWithSlots = baseMeds.map((m) => {
            const slots = byMed.get(m.id);
            if (!slots || slots.length === 0) return m;
            return {
              ...m,
              doseSlots: [...slots].sort((a, b) => a.sortOrder - b.sortOrder),
            };
          });
        }
      } catch (slotE) {
        // dose_slots 조인 실패 시 legacy 표시로 안전 폴백
        console.warn('[MedicationManageScreen] dose_slots 조인 실패, legacy 표시로 폴백:', slotE);
        patientHasDoseSlots = false;
        medsWithSlots = baseMeds;
      }
      setHasDoseSlots(patientHasDoseSlots);
      setMedications(medsWithSlots);

      // ── 중단한 약(이력 표시 전용) 조회 ─────────────────────────────────────
      // is_active=false & ended_at 있음 → "○○ · YYYY.M.D ~ YYYY.M.D 복용".
      // 슬롯/매핑·기록(med_logs)은 건드리지 않음. 최근 중단 순으로 정렬.
      try {
        const { data: stoppedData, error: stoppedErr } = await supabase
          .from('medications')
          .select('id, name, dosage, daily_count, count_unit, created_at, ended_at')
          .eq('patient_id', pid)
          .eq('is_active', false)
          .not('ended_at', 'is', null)
          .order('ended_at', { ascending: false });
        if (stoppedErr) throw stoppedErr;
        setStoppedMeds(
          (stoppedData ?? []).map((row: any) => ({
            id: row.id,
            name: row.name,
            dosage: row.dosage ?? null,
            dailyCount: row.daily_count ?? null,
            countUnit: (row.count_unit ?? 'day') as 'day' | 'week',
            startedAt: row.created_at ?? null,
            endedAt: row.ended_at ?? null,
          }))
        );
      } catch (stoppedE) {
        console.warn('[MedicationManageScreen] 중단 약 조회 실패(계속):', stoppedE);
        setStoppedMeds([]);
      }

      // drug_image_url 없는 약은 식약처 API로 이미지 보충 시도
      const medsWithoutImage = baseMeds.filter(m => !m.drugInfo?.itemImage);
      if (medsWithoutImage.length > 0) {
        Promise.all(
          medsWithoutImage.map(async med => {
            const info = await searchMfdsInfo(med.name);
            return { id: med.id, drugInfo: info };
          })
        ).then(results => {
          setMedications(prev =>
            prev.map(med => {
              const found = results.find(r => r.id === med.id);
              if (!found) return med;
              // DB에도 이미지 URL 저장 (비동기, 실패해도 무시)
              if (found.drugInfo?.itemImage) {
                supabase
                  .from('medications')
                  .update({
                    drug_image_url: found.drugInfo.itemImage,
                    ...(found.drugInfo.itemSeq ? { item_seq: found.drugInfo.itemSeq } : {}),
                  })
                  .eq('id', med.id)
                  .then(() => {}, () => {});
              }
              return { ...med, drugInfo: found.drugInfo ?? med.drugInfo };
            })
          );
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[MedicationManageScreen] loadMedications 오류:', e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [user, targetPatientId]);

  // 구독 콜백용 ref 를 항상 최신 loadMedications 로 유지(채널 재생성 없이 최신 fetch 호출).
  useEffect(() => {
    loadMedicationsRef.current = loadMedications;
  }, [loadMedications]);

  useEffect(() => {
    if (targetPatientId) loadMedications();
  }, [loadMedications, targetPatientId]);

  useFocusEffect(
    useCallback(() => {
      if (targetPatientId) loadMedications();
    }, [loadMedications, targetPatientId])
  );

  // ── 슬롯 중심 데이터 로드 (dose_slots + 약↔슬롯 매핑) ───────────────────────
  // 시간 단일 소스 = dose_slots. 각 슬롯에 매핑된 약 id 목록(medSlotMap)을 함께 만든다.
  // 슬롯 시간/알림 편집(DoseSlotSetList)이 끝나면 realtime/refresh 로 다시 호출됨.
  const loadDoseSlots = useCallback(async () => {
    const pid = targetPatientId;
    if (!pid) { setDoseSlotList([]); setMedSlotMap({}); return; }
    try {
      invalidateDoseSlotsCache(pid);
      let slots = await fetchPatientDoseSlots(pid);

      // [안전망] 기존 0슬롯 환자 구제 — fetch 가 명확히 0개를 반환했고(로딩 중 아님),
      // 화면을 보는 사람이 환자 본인이며, 이 환자에 대해 아직 자동 생성을 시도한 적이 없으면
      // 기본 4슬롯을 1회 생성한다. 멱등 헬퍼라 이미 슬롯 있으면 만들지 않는다(보수적).
      // ⚠️ 0개일 때만 — fetch 가 던지면 catch 로 가므로 여기엔 안 옴(로딩 중과 0개 구분됨).
      if (
        slots.length === 0 &&
        user?.role === 'patient' &&
        pid === user.id &&
        autoEnsuredSlotsForRef.current !== pid
      ) {
        autoEnsuredSlotsForRef.current = pid;
        console.warn('[MedicationManageScreen] 0슬롯 환자 감지 → 기본 4슬롯 자동 생성(안전망)');
        await ensurePatientDoseSlots(pid, null);
        invalidateDoseSlotsCache(pid);
        slots = await fetchPatientDoseSlots(pid);
      }

      setDoseSlotList(slots);

      // medication_dose_slots → slotId 별 medId 목록
      const slotIds = slots.map((s) => s.id).filter((id): id is string => !!id);
      const map: Record<string, string[]> = {};
      if (slotIds.length > 0) {
        const { data: rows, error } = await supabase
          .from('medication_dose_slots')
          .select('medication_id, dose_slot_id')
          .in('dose_slot_id', slotIds);
        if (error) throw error;
        (rows ?? []).forEach((r: any) => {
          const list = map[r.dose_slot_id] ?? [];
          list.push(r.medication_id);
          map[r.dose_slot_id] = list;
        });
      }
      setMedSlotMap(map);
    } catch (e) {
      console.warn('[MedicationManageScreen] loadDoseSlots 실패:', e);
    }
  }, [targetPatientId, user?.role, user?.id]);

  useEffect(() => {
    if (targetPatientId) loadDoseSlots();
  }, [loadDoseSlots, targetPatientId, medications]);

  // 슬롯 realtime — 슬롯 추가/삭제/시각·알림 변경 즉시 반영(DoseSlotSetList 편집 결과).
  // (이 구독은 deps 가 loadDoseSlots=[targetPatientId] 라 안정적 — 잘 동작하는 기준점.)
  const doseRtChannelId = useRef(Math.random().toString(36).slice(2, 10));
  useEffect(() => {
    loadDoseSlotsRef.current = loadDoseSlots;
  }, [loadDoseSlots]);
  useEffect(() => {
    if (!targetPatientId) return;
    const ch = supabase
      .channel(`dose-manage-slots-${targetPatientId}-${doseRtChannelId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dose_slots', filter: `patient_id=eq.${targetPatientId}` },
        () => { loadDoseSlotsRef.current(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [targetPatientId]);

  // 복용약 realtime — 환자/보호자 한쪽이 약을 추가·수정·삭제(중단)하면 다른쪽도 새로고침 없이 즉시 반영.
  // ⚠️ dose_slots realtime(위)과 100% 동일 패턴으로 맞춤:
  //   - 채널 이름: 마운트당 고유(ref) — 인라인 Math.random() 으로 매 effect 재생성 금지.
  //   - 콜백: loadMedicationsRef 로 최신 fetch 호출(채널 재생성 없이 deps 안정).
  //   - deps: [targetPatientId] 만 — loadMedications(deps=[user,targetPatientId]) 를 넣으면
  //     user 참조 변동마다 채널이 끊겼다 붙어 그 사이 medications 이벤트를 놓쳤음(이번 버그 원인).
  // medication_dose_slots 매핑까지 반영되도록 약 목록을 다시 로드한다.
  useEffect(() => {
    if (!targetPatientId) return;
    const ch = supabase
      .channel(`med-manage-meds-${targetPatientId}-${medRtChannelId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medications', filter: `patient_id=eq.${targetPatientId}` },
        // 백그라운드 갱신 — silent 로 호출해 스켈레톤을 안 켬(편집 시트가 닫히지 않게).
        () => { loadMedicationsRef.current({ silent: true }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [targetPatientId]);

  // 알림음 목록 = 기본 제공 프리셋(공용·항상) + 그룹 녹음(있으면). 피커가 섹션으로 나눠 표시.
  useEffect(() => {
    // 프리셋은 정적이라 즉시 세팅(재진입 시 custom_sounds 쿼리 지연/실패로 목록이 비어
    // 저장된 프리셋을 못 찾고 '기본 목소리'로 표시되던 문제 방지). 녹음은 도착하면 덧붙임.
    setAlarmSounds(PRESET_SOUND_OPTIONS);
    const gid = user?.patient_group_id;
    if (!gid) return;
    supabase
      .from('custom_sounds' as any)
      .select('id, label, public_url')
      .eq('group_id', gid)
      .order('created_at', { ascending: false })
      .then(({ data }: any) => {
        const recordings: AlarmSoundOption[] = ((data as any[]) ?? []).map((s) => ({
          id: s.id,
          label: s.label?.trim() || t('medManage.myRecording'),
          previewUrl: s.public_url ?? null,
          group: 'recording' as const,
        }));
        setAlarmSounds([...PRESET_SOUND_OPTIONS, ...recordings]);
      });
  }, [user?.patient_group_id]);

  // ── OCR ────────────────────────────────────────────────────────────────

  const pickImageAndRunOCR = async (useCamera: boolean) => {
    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { await dialog.alert({ title: t('medManage.permRequiredTitle'), message: t('medManage.cameraPermMsg') }); return; }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { await dialog.alert({ title: t('medManage.permRequiredTitle'), message: t('medManage.galleryPermMsg') }); return; }
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (!asset.base64) { await dialog.alert({ title: t('common.error'), message: t('medManage.cantReadImage') }); return; }

      const uri = asset.uri.toLowerCase();
      let mediaType = 'image/jpeg';
      if (uri.includes('.png')) mediaType = 'image/png';
      else if (uri.includes('.gif')) mediaType = 'image/gif';
      else if (uri.includes('.webp')) mediaType = 'image/webp';

      setIsOcrLoading(true);

      const parsed = await callClaudeOCR(asset.base64, mediaType);
      const validSlots: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
      const newMeds: Medication[] = parsed.medications.map((med, i) => ({
        id: (Date.now() + i).toString(),
        name: med.name,
        ediCode: (med.ediCode ?? '').trim(),
        dosage: (med.dosage ?? '').trim() || null,
        // 1일 횟수: OCR 추출값 우선, 없으면 times 개수로 보조 추정(0이면 null).
        dailyCount: med.dailyCount ?? (med.times.length > 0 ? med.times.length : null),
        times: med.times.filter((t): t is TimeSlot => validSlots.includes(t as TimeSlot)),
        schedules: {},
      }));

      const enriched = await Promise.all(
        newMeds.map(async med => ({ ...med, drugInfo: (await searchMfdsInfo(med.name)) ?? null }))
      );

      if (enriched.length === 0) {
        await dialog.alert({ title: t('medManage.medNotFoundTitle'), message: t('medManage.medNotFoundMsg') });
        return;
      }

      // DB 저장 대신 바텀시트로 결과 표시
      setOcrRawText(parsed.rawText ?? '');
      setOcrEnrichedMeds(enriched.map(m => ({
        ...m,
        ediCode: m.ediCode ?? '',
        countUnit: 'day' as const,
        dosageUnit: /mg/i.test(m.dosage ?? '') ? 'mg' as const : '정' as const, // 내부 저장값 — 표시할 땐 unitTablet 래핑
        checked: true,
      })));
      setOcrResultVisible(true);
    } catch {
      await dialog.alert({ message: t('medManage.analysisFailMsg') });
    } finally {
      setIsOcrLoading(false);
    }
  };

  // ── 비교 키 / 비교 유틸 ───────────────────────────────────────────────
  const normalizeNameKey = (name: string): string =>
    (name ?? '').replace(/\s/g, '').toLowerCase().slice(0, 5);

  // EDI코드가 있으면 EDI 우선, 없으면 이름 fallback
  const matchKey = (m: { ediCode?: string | null; name?: string | null }): string => {
    const edi = (m.ediCode ?? '').toString().trim();
    if (edi) return 'edi:' + edi;
    return 'name:' + normalizeNameKey(m.name ?? '');
  };

  const slotsLabel = (slots: string[]): string => {
    const order: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
    const sorted = order.filter(s => slots.includes(s));
    return sorted.map(s => TIME_SLOTS.find(ts => ts.key === s)?.label.replace('약', '') ?? s).join(',') || t('medManage.noneLabel');
  };

  type DiffEntry =
    | { type: 'added'; name: string; ediCode?: string; key: string }
    | { type: 'stopped'; name: string; ediCode?: string; key: string; prevItemId?: string; prevMedId?: string }
    | { type: 'timing_changed'; name: string; ediCode?: string; key: string; prevSlots: string[]; newSlots: string[]; prevMedId?: string }
    | { type: 'dose_changed'; name: string; ediCode?: string; key: string; prevTakes: number; newTakes: number; prevMedId?: string }
    | { type: 'unchanged'; name: string; ediCode?: string; key: string; prevMedId?: string };

  const performOcrSave = async (
    selected: typeof ocrEnrichedMeds,
    diffs: DiffEntry[]
  ) => {
    if (!user || !targetPatientId) {
      setMedications(prev => [...prev, ...selected]);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    try {
      // 1) prescription 헤더 저장
      let prescriptionId: string | null = null;
      try {
        const { data: rxRow, error: rxErr } = await supabase
          .from('prescriptions')
          .insert({
            patient_id: targetPatientId,
            issued_at: today,
            hospital: null,
            source: 'ocr',
            image_url: null,
            raw_ocr_text: ocrRawText || null,
          })
          .select()
          .single();
        if (rxErr) throw rxErr;
        prescriptionId = rxRow?.id ?? null;

        if (prescriptionId) {
          const pid = prescriptionId; // 위 가드로 non-null 확정 (컬럼 prescription_id NOT NULL)
          const itemRows = selected.map(med => ({
            prescription_id: pid,
            edi_code: med.ediCode && med.ediCode.trim() ? med.ediCode.trim() : null,
            product_name: med.name,
            dose_per_take: 1,
            takes_per_day: med.times.length,
            total_days: null,
            timing_slots: med.times,
            meal_relation: 'none',
            free_text: med.dosage?.trim() ? med.dosage.trim() : null,
          }));
          if (itemRows.length > 0) {
            const { error: itemErr } = await supabase
              .from('prescription_items')
              .insert(itemRows);
            if (itemErr) console.warn('[OCR confirm] prescription_items 저장 실패:', itemErr);
          }
        }
      } catch (rxErr) {
        console.warn('[OCR confirm] prescriptions 저장 실패:', rxErr);
      }

      // 2) medications 동기화 — diff 기반 (EDI코드 우선 매칭)
      const addedKeys = new Set(diffs.filter(d => d.type === 'added').map(d => d.key));
      // 2-0) 등록 보장: 선택한 약 중 '내 약 목록(medications)'에 실제 행이 없는 것은
      // 변경이력상 added가 아니어도(=unchanged/변경) 반드시 insert한다.
      // unchanged/timing_changed/dose_changed 는 prevMedId 가 있어야 진짜 medications 행이 존재.
      // prevMedId 가 없으면 처방전 항목만 있고 내 약엔 없는 상태 → 등록이 안 되던 케이스.
      const keysWithMedRow = new Set(
        diffs
          .filter(d => (d.type === 'unchanged' || d.type === 'timing_changed' || d.type === 'dose_changed') && !!(d as any).prevMedId)
          .map(d => d.key)
      );
      const ensureInsertKeys = new Set(addedKeys);
      selected.forEach(m => {
        const k = matchKey(m);
        if (!keysWithMedRow.has(k)) ensureInsertKeys.add(k);
      });
      // 2-1) 신규 약 + 등록 보장 약: insert (선택했는데 내 약에 없는 모든 약)
      const toInsert = selected.filter(m => ensureInsertKeys.has(matchKey(m)));
      let insertedDbMeds: Medication[] = [];
      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('medications')
          .insert(
            toInsert.map(med => ({
              patient_id: targetPatientId,
              name: med.name,
              dosage: med.dosage?.trim() ? med.dosage.trim() : null,
              // 처방전 등록 = "내 약"에만 추가. 슬롯 자동배정 안 함 → meal_times 비움.
              // daily_count(1일 횟수)만 보유 → 사용자가 슬롯에서 직접 배정(가이드 기준).
              meal_times: [] as TimeSlot[],
              meal_schedules: {},
              scheduled_times: [] as string[],
              daily_count: med.dailyCount ?? null,
              count_unit: med.countUnit ?? 'day',
              drug_code: null,
              drug_image_url: med.drugInfo?.itemImage ?? null,
              item_seq: med.drugInfo?.itemSeq ?? null,
              is_active: true,
            }))
          )
          .select();
        if (insertError) throw insertError;
        insertedDbMeds = (inserted ?? []).map((row: any) => {
          const matched = toInsert.find(s => s.name === row.name);
          return {
            id: row.id,
            name: row.name,
            dosage: row.dosage ?? matched?.dosage ?? null,
            dailyCount: row.daily_count ?? matched?.dailyCount ?? null,
            times: (row.meal_times ?? []) as TimeSlot[],
            schedules: (row.meal_schedules ?? {}) as MealSchedules,
            drugInfo: matched?.drugInfo ?? null,
            ediCode: matched?.ediCode ?? '',
          };
        });
      }

      // 2-2) 변경된 약: update (meal_times 갱신)
      const toUpdate = diffs.filter(
        d => d.type === 'timing_changed' || d.type === 'dose_changed'
      ) as Extract<DiffEntry, { type: 'timing_changed' | 'dose_changed' }>[];
      const updatedIds: string[] = [];
      for (const d of toUpdate) {
        if (!d.prevMedId) continue;
        const newMed = selected.find(s => matchKey(s) === d.key);
        if (!newMed) continue;
        // 처방전 재등록 = 약 정보(1일 횟수) 갱신만. 슬롯 배정(meal_times/medication_dose_slots)은
        // 사용자가 슬롯에서 직접 관리하므로 건드리지 않는다(기존 슬롯 배정 보존).
        const { error: upErr } = await supabase
          .from('medications')
          .update({
            daily_count: newMed.dailyCount ?? null,
            is_active: true,
          })
          .eq('id', d.prevMedId);
        if (upErr) console.warn('[OCR confirm] medications update 실패:', upErr);
        else updatedIds.push(d.prevMedId);
      }

      // 2-3) 중단된 약: is_active=false + ended_at(있으면)
      const toStop = diffs.filter(d => d.type === 'stopped') as Extract<DiffEntry, { type: 'stopped' }>[];
      const stoppedIds: string[] = [];
      for (const d of toStop) {
        if (!d.prevMedId) continue;
        // ended_at 컬럼 시도 (실패하면 is_active만)
        const { error: upErr } = await supabase
          .from('medications')
          .update({ is_active: false, ended_at: today })
          .eq('id', d.prevMedId);
        if (upErr) {
          const { error: upErr2 } = await supabase
            .from('medications')
            .update({ is_active: false })
            .eq('id', d.prevMedId);
          if (upErr2) console.warn('[OCR confirm] 중단 처리 실패:', upErr2);
          else stoppedIds.push(d.prevMedId);
        } else {
          stoppedIds.push(d.prevMedId);
        }
      }

      // 2-4) 슬롯 자동배정 제거(확정안): 처방전 등록은 "내 약"에만 추가하고
      // 어느 슬롯에도 자동 배정하지 않는다. 신규/변경 약의 medication_dose_slots
      // 자동 insert 안 함(사용자가 슬롯 "약 넣기"에서 직접 배정). dose_slots 시간/슬롯
      // 자동생성도 안 함(시간 단일 소스·슬롯은 사용자 배정).
      // 단, 중단 약은 슬롯에 남아 있으면 안 되므로 매핑만 정리한다.
      try {
        await Promise.all(
          stoppedIds.map((id) => setMedicationSlots(id, [], targetPatientId!))
        );
        invalidateDoseSlotsCache(targetPatientId);
      } catch (dsErr) {
        console.warn('[OCR confirm] 중단 약 슬롯 매핑 정리 실패(계속):', dsErr);
      }

      // 3) 화면 상태 동기화
      //    ⚠️ 이력 저장(side effect)은 setMedications 업데이터 "밖"에서 한 번만 호출한다.
      //    업데이터 내부에서 호출하면 React 18 strict/이중 호출 시 added 이력이 중복 기록될 수 있음.
      let nextMedsForHistory: Medication[] = [];
      setMedications(prev => {
        const next = prev
          .filter(m => !stoppedIds.includes(m.id))
          .map(m => {
            const upd = toUpdate.find(d => d.prevMedId === m.id);
            if (!upd) return m;
            const newMed = selected.find(s => matchKey(s) === upd.key);
            if (!newMed) return m;
            // 슬롯/시각은 사용자 배정 유지 → times/schedules 보존. 1일 횟수만 갱신.
            return { ...m, dailyCount: newMed.dailyCount ?? m.dailyCount ?? null };
          })
          .concat(insertedDbMeds);
        nextMedsForHistory = next;
        return next;
      });
      // 새로 insert된 약에만 added 이력 — updater 밖에서 insertedDbMeds 순회로 1회만 저장.
      // 약 등록(처방전)은 "내 약"에 추가만 — 약효추적 추천/안내 팝업은 띄우지 않음.
      // (약효추적 설정·추천은 슬롯/알림 관리에서 별개로 진입)
      insertedDbMeds.forEach(m => {
        saveMedicationHistory(targetPatientId!, m.id, 'added', nextMedsForHistory);
      });
    } catch (e) {
      console.error('[OCR confirm] 저장 오류:', e);
      // 최후 폴백: 화면에 표시만
      setMedications(prev => [...prev, ...selected]);
    }
  };

  const handleOcrConfirm = async () => {
    const selected = ocrEnrichedMeds.filter(m => m.checked);
    if (selected.length === 0) {
      setOcrResultVisible(false);
      return;
    }
    setOcrResultVisible(false);

    // ── 직전 처방전 조회 + 비교 + PK 매칭 안내 통합 ─────────────────────
    let diffs: DiffEntry[] = [];
    let isFirstPrescription = false;
    let pkTips: string[] = [];

    try {
      if (targetPatientId) {
        // 직전 prescription
        const { data: prevRx } = await supabase
          .from('prescriptions')
          .select('id, issued_at')
          .eq('patient_id', targetPatientId)
          .order('issued_at', { ascending: false })
          .limit(1);
        const prevPrescriptionId = prevRx?.[0]?.id;

        // 현재 active medications (medications 테이블엔 edi_code 컬럼 없을 수 있어 이름 기반 매핑)
        const { data: activeMeds } = await supabase
          .from('medications')
          .select('id, name, meal_times')
          .eq('patient_id', targetPatientId)
          .eq('is_active', true);
        const medByNameKey = new Map<string, { id: string; name: string; times: string[] }>();
        (activeMeds ?? []).forEach((r: any) => {
          medByNameKey.set('name:' + normalizeNameKey(r.name), {
            id: r.id,
            name: r.name,
            times: (r.meal_times ?? []) as string[],
          });
        });

        if (!prevPrescriptionId) {
          isFirstPrescription = true;
          diffs = selected.map(m => {
            const key = matchKey(m);
            return {
              type: 'added',
              name: m.name,
              ediCode: m.ediCode,
              key,
            } as DiffEntry;
          });
        } else {
          const { data: prevItems } = await supabase
            .from('prescription_items')
            .select('id, product_name, edi_code, timing_slots, takes_per_day, dose_per_take')
            .eq('prescription_id', prevPrescriptionId);
          // EDI 우선 매칭 키
          const prevByKey = new Map<string, any>();
          (prevItems ?? []).forEach((it: any) => {
            const key = matchKey({ ediCode: it.edi_code, name: it.product_name });
            prevByKey.set(key, it);
          });
          const newByKey = new Map<string, typeof selected[number]>();
          selected.forEach(s => newByKey.set(matchKey(s), s));

          // 추가 / 변경 / 동일
          for (const s of selected) {
            const key = matchKey(s);
            const prev = prevByKey.get(key);
            // medications 테이블 매칭은 이름 키로 (edi_code 컬럼 없을 수 있음)
            const prevMedId = medByNameKey.get('name:' + normalizeNameKey(s.name))?.id;
            // EDI가 같아 prev로 매칭됐어도 사용자가 이름을 고쳤다면(이름 키 불일치)
            // 같은 약이 아니라 '새 약'으로 본다. (이름만 고쳐도 등록 안 되던 버그 수정)
            const renamed = !!prev && normalizeNameKey(prev.product_name ?? '') !== normalizeNameKey(s.name ?? '');
            if (!prev || renamed) {
              diffs.push({ type: 'added', name: s.name, ediCode: s.ediCode, key });
              continue;
            }
            const prevSlots = (prev.timing_slots ?? []) as string[];
            const newSlots = s.times as string[];
            const slotsDiffer =
              prevSlots.length !== newSlots.length ||
              !prevSlots.every(ps => newSlots.includes(ps));
            const prevTakes = prev.takes_per_day ?? prevSlots.length;
            const newTakes = newSlots.length;
            if (slotsDiffer) {
              diffs.push({
                type: 'timing_changed',
                name: s.name,
                ediCode: s.ediCode,
                key,
                prevSlots,
                newSlots,
                prevMedId,
              });
            } else if (prevTakes !== newTakes) {
              diffs.push({
                type: 'dose_changed',
                name: s.name,
                ediCode: s.ediCode,
                key,
                prevTakes,
                newTakes,
                prevMedId,
              });
            } else {
              diffs.push({ type: 'unchanged', name: s.name, ediCode: s.ediCode, key, prevMedId });
            }
          }
          // 중단: 직전엔 있는데 신규엔 없음
          for (const [key, prev] of prevByKey.entries()) {
            if (!newByKey.has(key)) {
              const prevEdi = (prev.edi_code ?? '').toString().trim();
              diffs.push({
                type: 'stopped',
                name: prev.product_name,
                ediCode: prevEdi || undefined,
                key,
                prevItemId: prev.id,
                prevMedId: medByNameKey.get('name:' + normalizeNameKey(prev.product_name))?.id,
              });
            }
          }
        }
      }
    } catch (cmpErr) {
      console.warn('[OCR confirm] 비교 실패, 전부 신규로 진행:', cmpErr);
      diffs = selected.map(m => ({ type: 'added', name: m.name, ediCode: m.ediCode, key: matchKey(m) } as DiffEntry));
    }

    // PK 매칭 tips (실패해도 무시) — EDI코드 있으면 우선 조회
    try {
      for (const med of selected) {
        let profile: any = null;
        const edi = (med.ediCode ?? '').trim();
        if (edi) {
          const { data: byEdi } = await supabase
            .from('medication_pk_profile')
            .select('product_name, ingredient, suggested_slots, onset_min, tmax_min, edi_code')
            .eq('edi_code', edi)
            .limit(1);
          profile = byEdi?.[0] ?? null;
        }
        if (!profile) {
          const nameFrag = med.name.replace(/\s/g, '').slice(0, 3);
          if (!nameFrag) continue;
          const { data: profileRows } = await supabase
            .from('medication_pk_profile')
            .select('product_name, ingredient, suggested_slots, onset_min, tmax_min')
            .or(`product_name.ilike.%${nameFrag}%,ingredient.ilike.%${nameFrag}%`)
            .limit(1);
          profile = profileRows?.[0];
        }
        if (profile) {
          const slots: number[] = (profile?.suggested_slots as number[] | undefined) ?? [0, 30, 120];
          const label = slots
            .filter(s => s > 0)
            .map(s => (s >= 60 ? t('medManage.pkHour', { h: Math.round(s / 60) }) : t('medManage.pkMin', { m: s })))
            .join(', ');
          pkTips.push(t('medManage.pkTip', { name: med.name, label }));
        }
      }
    } catch (matchErr) {
      console.warn('[OCR confirm] PK 매칭 실패:', matchErr);
    }

    // ── 비교 다이얼로그 메시지 작성 ───────────────────────────────────────
    const lines: string[] = [];
    if (isFirstPrescription) {
      lines.push(t('medManage.firstPrescription'));
    } else {
      const addedLines = diffs.filter(d => d.type === 'added').map(d => t('medManage.addedLine', { name: d.name }));
      const stoppedLines = diffs.filter(d => d.type === 'stopped').map(d => t('medManage.stoppedLine', { name: d.name }));
      const timingLines = diffs
        .filter(d => d.type === 'timing_changed')
        .map(d => {
          const tc = d as Extract<DiffEntry, { type: 'timing_changed' }>;
          return t('medManage.timingChangedLine', { name: tc.name, prev: slotsLabel(tc.prevSlots), next: slotsLabel(tc.newSlots) });
        });
      const doseLines = diffs
        .filter(d => d.type === 'dose_changed')
        .map(d => {
          const dc = d as Extract<DiffEntry, { type: 'dose_changed' }>;
          return t('medManage.doseChangedLine', { name: dc.name, prev: dc.prevTakes, next: dc.newTakes });
        });
      lines.push(...addedLines, ...timingLines, ...doseLines, ...stoppedLines);
      if (lines.length === 0) {
        lines.push(t('medManage.samePrescription'));
      }
    }
    if (pkTips.length > 0) {
      lines.push('');
      lines.push(...pkTips);
    }

    // 공용 다이얼로그로 확인
    const ok = await dialog.confirm({
      title: t('medManage.confirmPrescriptionTitle'),
      message: lines.join('\n'),
      confirmText: t('medManage.registerBtn'),
      cancelText: t('common.cancel'),
      cancelable: true,
    });
    if (ok) { performOcrSave(selected, diffs); }
  };

  const handleOcrPress = async () => {
    const choice = await dialog.show({
      title: t('medManage.photoRegisterTitle'),
      message: t('medManage.photoSourceMsg'),
      buttons: [
        { id: 'camera', text: t('medManage.takePhoto') },
        { id: 'gallery', text: t('medManage.chooseGallery') },
        { id: 'cancel', text: t('common.cancel'), style: 'cancel' },
      ],
      cancelable: true,
    });
    if (choice === 'camera') pickImageAndRunOCR(true);
    else if (choice === 'gallery') pickImageAndRunOCR(false);
  };

  // ── 복용약 등록 통합 진입(처방전 / 직접 입력 선택) ──────────────────────────
  // 메뉴 3등분(1단계): 약 등록은 "내 약" 메뉴로 이관.
  //  - meds 모드(내 약): 처방전 OCR / 직접 입력 폼(상시 노출)으로 등록.
  //  - slots 모드(복용 시간·알림): 약 등록은 "내 약"에서 → 이 함수는 "내 약" 메뉴로 이동시킴.
  const handleRegisterPress = async () => {
    if (!isMedsMode) {
      // 슬롯 뷰에서 등록 요청(약 넣기 빈 상태 등) → "내 약"으로 이동.
      // ⚠️ 해외판(OverseasMedTabScreen)처럼 이 화면이 임베디드된 경우 raw navigate('MedicationManage')는
      //    현재 탭 네비게이터에 그 라우트가 없어 무반응이다. onGoRegisterMeds(로컬 탭 전환)를 우선 쓰고,
      //    없을 때만 루트 기준 전역 네비게이션으로 항상 도달 가능하게 한다.
      if (onGoRegisterMeds) {
        onGoRegisterMeds();
        return;
      }
      navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedicationManage', params: { mode: 'meds' } } });
      return;
    }
    // 내 약 메뉴: 처방전 OCR. (직접 입력 폼은 화면에 상시 노출돼 있음)
    handleOcrPress();
  };

  // ── 식약처 정보 조회 ──────────────────────────────────────────────────

  const handleFetchMfdsForAdd = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { await dialog.alert({ message: t('medManage.medNameRequired') }); return; }
    setIsMfdsLoading(true);
    try {
      const info = await searchMfdsInfo(trimmed);
      setAddDrugInfo(info);
    } finally {
      setIsMfdsLoading(false);
    }
  };

  const handleFetchMfdsForEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { await dialog.alert({ message: t('medManage.medNameRequired') }); return; }
    setIsEditMfdsLoading(true);
    try {
      const info = await searchMfdsInfo(trimmed);
      setEditDrugInfo(info);
    } finally {
      setIsEditMfdsLoading(false);
    }
  };

  // ── medication_history 스냅샷 저장 헬퍼 ────────────────────────────────────

  const saveMedicationHistory = useCallback(async (
    patientId: string,
    changedMedicationId: string | null,
    changeType: ChangeType,
    allMedications: Medication[],
  ) => {
    try {
      const snapshot: MedSnapshot[] = allMedications.map(m => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage ?? null,
        meal_times: m.times,
      }));
      await supabase.from('medication_history').insert({
        patient_id: patientId,
        changed_medication_id: changedMedicationId,
        change_type: changeType,
        snapshot: snapshot as unknown as Json,
      });
    } catch (e) {
      console.warn('[saveMedicationHistory] 이력 저장 실패:', e);
    }
  }, []);

  // ── dose_slots dual-write 헬퍼 (5단계) ────────────────────────────────────
  // legacy(meal_times/meal_schedules) 쓰기 직후 신규 dose_slots/medication_dose_slots
  // 를 동기화하는 공용 진입점. 헬퍼는 실패해도 throw 하지 않으므로 legacy 쓰기를 막지 않음.
  //
  // notifMinutes: 전역 약효추적(medNotifs)에서 enabled 분만 추출 → 신규 슬롯 insert 시
  //               track_intervals 기본값으로 사용(없으면 헬퍼가 30/120 폴백).
  const enabledTrackMinutes = useCallback(
    () => medNotifs.filter((n) => n.enabled && n.minutes > 0).map((n) => n.minutes),
    [medNotifs]
  );

  /**
   * 환자 dose_slots 를 주어진 meal_schedules 기준으로 보장(멱등 upsert).
   * - users.med_time_notif_prefs 를 신선하게 읽어 remind_enabled 반영.
   * - 보호자 경로 포함: 항상 targetPatientId(연동 환자) 대상.
   * 실패해도 throw 하지 않음(헬퍼 내부에서 흡수).
   */
  const ensureDoseSlotsForPatient = useCallback(
    async (mealSchedules: MealSchedules) => {
      const pid = targetPatientId;
      if (!pid) return;
      let notifPrefs: Record<string, boolean> | null = null;
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('med_time_notif_prefs')
          .eq('id', pid)
          .single();
        notifPrefs = (userRow?.med_time_notif_prefs ?? null) as Record<string, boolean> | null;
      } catch (e) {
        console.warn('[MedicationManageScreen] med_time_notif_prefs 조회 실패(계속):', e);
      }
      await ensurePatientDoseSlots(pid, mealSchedules, notifPrefs, enabledTrackMinutes());
    },
    [targetPatientId, enabledTrackMinutes]
  );

  // ── 직접 입력으로 등록 ("내 약"에만 추가, 슬롯 자동배정 없음) ────────────────
  // 메인의 "복용약 등록 → 직접 입력으로 등록" 인라인 폼 제출.
  // 처방전 등록과 동일하게 "내 약" 목록에만 추가하고 어느 슬롯에도 자동 배정하지 않는다.
  // (복용 시간대 배정은 메인 슬롯 카드의 "약 넣기·빼기"에서 직접) → meal_times/schedules 비움.
  const handleAddSubmitMyMedOnly = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { await dialog.alert({ message: t('medManage.medNameRequired2') }); return; }
    if (!user || !targetPatientId) return;

    // 복용횟수: ref 값 우선(재렌더에도 보존), 숫자만 → daily_count(양의 정수). 비었거나 0이하면 null.
    const rawCount = (addCountRef.current || addDailyCount).replace(/[^0-9]/g, '');
    const parsedCount = parseInt(rawCount, 10);
    const dailyCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null;

    try {
      const { data, error } = await supabase
        .from('medications')
        .insert({
          patient_id: targetPatientId,
          name: trimmed,
          dosage: addDosage.trim() || null,
          daily_count: dailyCount,
          count_unit: addCountUnit,
          // "내 약"에만 추가 — 슬롯 자동배정 안 함(시간 단일 소스는 dose_slots).
          meal_times: [] as TimeSlot[],
          meal_schedules: {},
          scheduled_times: [] as string[],
          drug_code: null,
          drug_image_url: addDrugInfo?.itemImage ?? null,
          item_seq: addDrugInfo?.itemSeq ?? null,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;

      const newMed: Medication = {
        id: data.id,
        name: data.name,
        dosage: data.dosage ?? null,
        dailyCount: data.daily_count ?? dailyCount ?? null,
        countUnit: (data.count_unit ?? addCountUnit) as 'day' | 'week',
        times: (data.meal_times ?? []) as TimeSlot[],
        schedules: (data.meal_schedules ?? {}) as MealSchedules,
        drugInfo: addDrugInfo ?? null,
      };
      setMedications(prev => {
        const next = [...prev, newMed];
        saveMedicationHistory(targetPatientId!, data.id, 'added', next);
        // 약 등록(직접 입력)은 "내 약"에 추가만 — 약효추적 추천/안내 팝업은 띄우지 않음.
        // (약효추적 설정·추천은 슬롯/알림 관리에서 별개로 진입)
        return next;
      });
      setAddName('');
      setAddDosage('');
      setAddDosageUnit('정');
      setAddDailyCount('');
      addCountRef.current = '';
      setAddCountNonce(n => n + 1); // 입력칸 리마운트 → defaultValue 초기화
      setAddCountUnit('day');
      setAddDrugInfo(undefined);
    } catch (e) {
      console.error('[MedicationManageScreen] 약 직접 등록 오류:', e);
      await dialog.alert({ message: t('medManage.addFailMsg') });
    }
  };

  // ── 수정 ────────────────────────────────────────────────────────────────

  const handleEditStart = (med: Medication) => {
    setEditingId(med.id);
    setEditName(med.name);
    setEditDosage(med.dosage ?? '');
    // 단위 칩: dosage 문자열에 mg가 있으면 'mg', 아니면 기본 '정'
    setEditDosageUnit(/mg/i.test(med.dosage ?? '') ? 'mg' : '정');
    const initialCount = med.dailyCount && med.dailyCount > 0 ? String(med.dailyCount) : '';
    setEditDailyCount(initialCount);
    editCountRef.current = initialCount;
    setEditCountUnit(med.countUnit ?? 'day');
    setEditDrugInfo(med.drugInfo);
  };

  // 약 수정 = 약 정보(이름·복용량)만. 복용 시간대(슬롯) 배정은 별개(슬롯 카드 "약 넣기"에서).
  // ⚠️ meal_times/meal_schedules/medication_dose_slots 는 절대 건드리지 않는다(기존 슬롯 배정 보존).
  const handleEditSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { await dialog.alert({ message: t('medManage.medNameRequired2') }); return; }
    const savedId = editingId;
    if (!savedId) return;

    // 복용횟수: ref 값 우선(state가 재렌더로 흔들려도 입력값 보존), 숫자만 → daily_count(양의 정수).
    const rawCount = (editCountRef.current || editDailyCount).replace(/[^0-9]/g, '');
    const parsedCount = parseInt(rawCount, 10);
    const dailyCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null;

    setMedications(prev => {
      const next = prev.map(m =>
        m.id === savedId
          ? { ...m, name: trimmed, dosage: editDosage.trim() || null, dailyCount, countUnit: editCountUnit, drugInfo: editDrugInfo }
          : m
      );
      // 스냅샷 저장 (비동기, 실패해도 무시)
      if (targetPatientId) {
        saveMedicationHistory(targetPatientId, savedId, 'updated', next);
      }
      // 약 수정은 약효추적 추천/안내 팝업과 완전 분리 (재추천 제안 호출 제거)
      return next;
    });
    setEditingId(null);

    try {
      // 약 정보(이름·복용량·복용횟수·식약처 메타)만 update. 슬롯 배정(meal_times/medication_dose_slots)은 미변경.
      const { error } = await supabase
        .from('medications')
        .update({
          name: trimmed,
          dosage: editDosage.trim() || null,
          daily_count: dailyCount,
          count_unit: editCountUnit,
          drug_image_url: editDrugInfo?.itemImage ?? null,
          item_seq: editDrugInfo?.itemSeq ?? null,
        })
        .eq('id', savedId);
      if (error) throw error;
    } catch (e) {
      console.error('[MedicationManageScreen] 약 수정 오류:', e);
      await dialog.alert({ message: t('medManage.editFailMsg') });
      loadMedications();
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditName('');
    setEditDosage('');
    setEditDosageUnit('정');
    setEditDailyCount('');
    editCountRef.current = '';
    setEditCountUnit('day');
    setEditDrugInfo(undefined);
  };

  // ── 삭제 ────────────────────────────────────────────────────────────────

  const handleDelete = async (med: Medication) => {
    const ok = await dialog.confirm({
      title: t('medManage.stopMedTitle'),
      message: t('medManage.stopMedMsg', { name: med.name }),
      confirmText: t('medManage.stopBtn'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setMedications(prev => {
      const next = prev.filter(m => m.id !== med.id);
      // 스냅샷 저장 (비동기, 실패해도 무시) - 삭제된 약도 포함한 최종 목록
      if (targetPatientId) {
        saveMedicationHistory(targetPatientId, med.id, 'deleted', next);
      }
      // 약 중단은 약효추적 추천/안내 팝업과 완전 분리 (재추천 제안 호출 제거)
      return next;
    });
    // 중단 처리: 하드 삭제 대신 is_active=false + ended_at=now() (이력 보존, §4 가벼운 방식).
    const endedAtIso = new Date().toISOString();
    try {
      let { error } = await supabase
        .from('medications')
        .update({ is_active: false, ended_at: endedAtIso } as any)
        .eq('id', med.id);
      // ended_at 업데이트 실패 시(컬럼/권한) is_active만이라도 처리
      if (error) {
        console.warn('[MedicationManageScreen] ended_at 기록 실패, is_active만 처리:', error);
        const { error: err2 } = await supabase
          .from('medications')
          .update({ is_active: false })
          .eq('id', med.id);
        if (err2) throw err2;
      }
      // 중단 약을 이력 목록에 즉시 반영(낙관적 — created_at은 다음 새로고침에 정확히 채워짐)
      setStoppedMeds(prev => [
        { id: med.id, name: med.name, dosage: med.dosage ?? null, dailyCount: med.dailyCount ?? null, startedAt: null, endedAt: endedAtIso },
        ...prev.filter(s => s.id !== med.id),
      ]);

      // dose_slots dual-write: 환자 시간표(dose_slots)는 유지하고, 이 약의 약↔슬롯
      // 매핑(medication_dose_slots)만 비운다(빈 배열 → 기존 매핑 delete). 실패해도 throw 안 함.
      if (targetPatientId) {
        try {
          await syncMedicationDoseSlots(targetPatientId, med.id, []);
          invalidateDoseSlotsCache(targetPatientId);
        } catch (dsErr) {
          console.warn('[MedicationManageScreen] dose_slots 매핑 정리 실패(계속):', dsErr);
        }
      }
    } catch (e) {
      console.error('[MedicationManageScreen] 약 중단 오류:', e);
      await dialog.alert({ message: t('medManage.stopFailMsg') });
      loadMedications();
    }
  };

  // ── 지난 약 기록 완전 삭제 ────────────────────────────────────────────────
  // 잘못 등록했다가 중단되어 지난약으로 내려온 항목 등을 영구 제거(하드 삭제).
  // 중단 약은 이미 슬롯 매핑이 비워진 상태지만, 방어적으로 매핑부터 정리 후 medications 삭제.
  const handleDeleteStoppedMed = async (med: StoppedMed) => {
    const ok = await dialog.confirm({
      title: t('medManage.deletePastTitle'),
      message: t('medManage.deletePastMsg', { name: med.name }),
      confirmText: t('medManage.delete'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // 낙관적 제거
    setStoppedMeds(prev => prev.filter(s => s.id !== med.id));
    try {
      // 방어적: 남아있을 수 있는 약↔슬롯 매핑 먼저 제거(FK 보호).
      await supabase.from('medication_dose_slots').delete().eq('medication_id', med.id);
      const { error } = await supabase.from('medications').delete().eq('id', med.id);
      if (error) throw error;
    } catch (e) {
      console.error('[MedicationManageScreen] 지난 약 삭제 오류:', e);
      await dialog.alert({ message: t('medManage.deleteFailMsg') });
      loadMedications();
    }
  };

  // ── 약 넣기·빼기: medication_dose_slots 매핑을 "완료" 눌렀을 때 일괄 커밋. ──
  // 스테이징 방식: 시트에서 약 체크/해제는 로컬 상태만 바꾸고(DB write 없음),
  // "완료" 버튼을 누르면 이 슬롯의 최종 약 목록(finalMedIds)으로 한 번에 반영한다.
  // 이 슬롯에 한정해서 diff(추가분 insert / 해제분 delete)만 수행 → 다른 슬롯 배정 보존.
  // 탭마다 즉시 write(스피너·깜빡임) 하던 toggleMedSlot 을 대체. realtime 트리거는 커밋 1회만 발생.
  const commitMedSlot = useCallback(async (slotId: string, finalMedIds: string[]): Promise<void> => {
    if (!targetPatientId || !slotId) return;
    const prevIds = new Set(medSlotMap[slotId] ?? []);
    const nextIds = new Set(finalMedIds.filter(Boolean));
    const toAdd = [...nextIds].filter((id) => !prevIds.has(id));
    const toRemove = [...prevIds].filter((id) => !nextIds.has(id));

    // 변경 없으면 DB 접근 없이 종료(불필요한 write·realtime 방지).
    if (toAdd.length === 0 && toRemove.length === 0) return;

    try {
      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from('medication_dose_slots')
          .delete()
          .eq('dose_slot_id', slotId)
          .in('medication_id', toRemove);
        if (delErr) throw delErr;
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map((medication_id) => ({ medication_id, dose_slot_id: slotId }));
        const { error: insErr } = await supabase
          .from('medication_dose_slots')
          .insert(rows as any);
        if (insErr) throw insErr;
      }
      // 낙관적: 이 슬롯의 약 목록을 최종값으로 교체.
      setMedSlotMap((prev) => ({ ...prev, [slotId]: [...nextIds] }));
      invalidateDoseSlotsCache(targetPatientId);
    } catch (e) {
      console.error('[MedicationManageScreen] 약 배정 커밋 실패:', e);
      await dialog.alert({ message: t('medManage.assignSaveFailMsg') });
      throw e;
    } finally {
      loadDoseSlots();
    }
  }, [targetPatientId, medSlotMap, dialog, loadDoseSlots]);

  // 약효추적 인터벌 요약. 예: "복용직후 30분 후". 없으면 빈 문자열.
  const slotTrackIntervalSummary = useCallback((slot: DoseSlot): string => {
    if (slot.trackIntervals.length === 0) return '';
    return [...slot.trackIntervals]
      .sort((a, b) => a - b)
      .map((m) => {
        if (m === 0) return t('medManage.rightAfter');
        if (m < 60) return t('medManage.minLater', { m });
        const h = Math.floor(m / 60); const r = m % 60;
        return r === 0 ? t('medManage.hourLaterOnly', { h }) : t('medManage.hourMinLater', { h, m: r });
      })
      .join(' · ');
  }, []);

  // ── 슬롯 인라인 토글: 약 복용 알림(remind_enabled) / 약효추적(track_enabled) 즉시 업데이트. ──
  // DoseSlotSetList.onToggleRemind/onToggleTrack 와 동일 dose_slots 컬럼 업데이트.
  // 낙관적으로 doseSlotList 갱신 후 supabase update, 실패 시 롤백 + 안내, 끝에 refresh.
  const updateSlotFlag = useCallback(
    async (slotId: string, dbPatch: Record<string, unknown>, localPatch: Partial<DoseSlot>) => {
      let prev: DoseSlot | undefined;
      setDoseSlotList((list) => {
        prev = list.find((s) => s.id === slotId);
        return list.map((s) => (s.id === slotId ? { ...s, ...localPatch } : s));
      });
      try {
        const { error } = await supabase.from('dose_slots').update(dbPatch as any).eq('id', slotId);
        if (error) throw error;
        if (targetPatientId) invalidateDoseSlotsCache(targetPatientId);
      } catch (e) {
        console.error('[MedicationManageScreen] dose_slots 토글 update 실패:', e);
        if (prev) {
          const rollback = prev;
          setDoseSlotList((list) => list.map((s) => (s.id === slotId ? rollback : s)));
        }
        await dialog.alert({ message: t('medManage.notifSaveFailMsg') });
      } finally {
        loadDoseSlots();
      }
    },
    [targetPatientId, dialog, loadDoseSlots],
  );

  const toggleSlotRemind = useCallback(
    (slot: DoseSlot, value: boolean) => {
      if (!slot.id) return;
      void updateSlotFlag(slot.id, { remind_enabled: value }, { remindEnabled: value });
      // 결과 안내(DoseSlotSetList.onToggleRemind 와 동일): 켜기=즉시(시각 지났는지 판정) / 끄기=즉시 중단.
      dialog.alert(value ? turnOnImmediatePopup(slot.time, user?.timezone) : turnOffImmediatePopup());
    },
    [updateSlotFlag, dialog, user?.timezone],
  );

  const toggleSlotTrack = useCallback(
    (slot: DoseSlot, value: boolean) => {
      if (!slot.id) return;
      // 켜는데 추적 시각이 없으면 기본값으로 채움(DoseSlotSetList 동작과 동일).
      if (value && slot.trackIntervals.length === 0) {
        const defaults = [0, 30];
        void updateSlotFlag(
          slot.id,
          { track_enabled: true, track_intervals: defaults },
          { trackEnabled: true, trackIntervals: defaults },
        );
      } else {
        void updateSlotFlag(slot.id, { track_enabled: value }, { trackEnabled: value });
      }
      // 결과 안내(DoseSlotSetList.onToggleTrack 와 동일): 약효추적은 지연형 → 오늘 이미 복용했는지 확인해 맞춤 문구.
      const slotId = slot.id;
      void (async () => {
        const taken = await hasTakenTodayKST(targetPatientId, slotId, user?.timezone);
        dialog.alert(value ? trackChangePopup(taken) : trackOffPopup(taken));
      })();
    },
    [updateSlotFlag, dialog, targetPatientId, user?.timezone],
  );

  // 슬롯 알림음 지정 — 복용/약효추적 각각 remind_sound_id/track_sound_id 저장(updateSlotFlag 재사용).
  const setSlotRemindSound = useCallback(
    (slot: DoseSlot, sid: string | null) => {
      if (!slot.id) return;
      void updateSlotFlag(slot.id, { remind_sound_id: sid }, { remindSoundId: sid });
      // 고른 프리셋 채널을 즉시 생성 → 앱 재시작 없이 그 소리로 알림이 울리게.
      void ensurePresetChannelForSoundId(sid);
    },
    [updateSlotFlag],
  );
  const setSlotTrackSound = useCallback(
    (slot: DoseSlot, sid: string | null) => {
      if (!slot.id) return;
      void updateSlotFlag(slot.id, { track_sound_id: sid }, { trackSoundId: sid });
      void ensurePresetChannelForSoundId(sid);
    },
    [updateSlotFlag],
  );

  // 알림 방식(basic|sound30|alarm) 표시 라벨.
  const alarmModeLabel = useCallback((m: AlarmMode) => t(`medManage.alarmMode.${m}`), [t]);

  // "알림 방식" 행 탭 → 3택 선택 → dose_slots.remind_alarm_mode / track_alarm_mode 저장.
  const pickAlarmMode = useCallback(
    async (slot: DoseSlot, kind: 'remind' | 'track') => {
      if (!slot.id) return;
      const current = kind === 'remind' ? slot.remindAlarmMode : slot.trackAlarmMode;
      // '알람처럼'(전체화면 알람)은 안드로이드 전용 — 실제로 알림이 울리는 환자 기기 기준으로
      // 판단(편집자=보호자 기기와 무관). 환자가 아이폰이면 골라도 '기본'과 동일하게 동작하므로
      // 혼란 방지를 위해 선택지 자체를 숨기고 이유를 안내한다.
      const patientIsIos = targetPatientPlatform === 'ios';
      const picked = await dialog.show({
        title: t('medManage.alarmModeTitle'),
        message:
          t('medManage.alarmModeMsg') +
          (patientIsIos ? `\n\n${t('medManage.alarmModePatientIosNote')}` : ''),
        buttons: [
          // '20초내외'(sound30) 제거 — 서버 1회라 '기본'과 동일.
          { id: 'basic', text: t('medManage.alarmMode.basic'), style: 'default' as const },
          // 환자 기기가 아이폰으로 확인되면 '알람처럼' 자체를 숨김(안드로이드 전용 기능).
          ...(patientIsIos
            ? []
            : [{ id: 'alarm', text: t('medManage.alarmMode.alarm'), style: 'primary' as const }]),
          { id: '__cancel', text: t('common.close'), style: 'cancel' as const },
        ],
      });
      if (!picked || picked === '__cancel') return;
      const mode = picked as AlarmMode;
      // 값이 바뀐 경우에만 저장(불필요한 쓰기 방지).
      if (mode !== current) {
        if (kind === 'remind') {
          void updateSlotFlag(slot.id, { remind_alarm_mode: mode }, { remindAlarmMode: mode });
        } else {
          void updateSlotFlag(slot.id, { track_alarm_mode: mode }, { trackAlarmMode: mode });
        }
      }
      // '알람처럼'을 고르면(값 변경 여부와 무관하게) 전체화면 알람 미리보기 제안.
      if (mode === 'alarm') {
        const yes = await dialog.confirm({
          title: t('medManage.alarmPreviewTitle'),
          message: t('medManage.alarmPreviewMsg'),
          // 미리보기를 '취소'하는 게 아니라 그냥 안 보고 넘어가는 것 → '닫기'(오너 지정 2026-07-27).
          cancelText: t('common.close'),
        });
        if (yes) {
          const fileId = presetFileIdOf(kind === 'remind' ? slot.remindSoundId : slot.trackSoundId);
          // preview:true — 미리보기라 '복용 완료'를 눌러도 실제 기록·보호자 알림 없음(테스트 중 가족 알림 방지).
          navigateTo('Alarm', { fileId: fileId ?? undefined, kind, doseSlotId: slot.id ?? undefined, preview: true });
        }
      }
    },
    [dialog, t, updateSlotFlag, targetPatientPlatform],
  );

  // 슬롯이 로드/변경될 때마다, 그 슬롯이 쓰는 프리셋 채널을 즉시 보장(안드).
  //   → 소리를 언제 골랐든(로그인 전/후 무관) 이 화면에 들어오면 채널이 생겨 프리셋 소리로 울림.
  useEffect(() => {
    doseSlotList.forEach((s) => {
      void ensurePresetChannelForSoundId(s.remindSoundId);
      void ensurePresetChannelForSoundId(s.trackSoundId);
    });
  }, [doseSlotList]);

  // 약 id → Medication 빠른 조회(슬롯 카드 약 목록 표시용).
  const medById = useCallback((id: string) => medications.find((m) => m.id === id), [medications]);

  // 약이 배정된 슬롯명 목록(시간 빠른 순). medication_dose_slots 매핑(medSlotMap) 기준.
  // "내 약 전체 보기"의 약별 "배정 슬롯" 뱃지 표시 전용(읽기). 예: ["아침", "점심"].
  const medAssignedSlotLabels = useCallback((medId: string): string[] => {
    const labels: string[] = [];
    doseSlotList.forEach((s) => {
      if (s.id && (medSlotMap[s.id] ?? []).includes(medId)) {
        labels.push(slotTitle(s.label, s.legacyKey, s.time));
      }
    });
    return labels;
  }, [doseSlotList, medSlotMap]);

  // 어느 복용 시간대에도 안 넣은 약(active). 등록만 하고 시간대 배정 안 한 약 → 메인 안내.
  // medSlotMap 의 모든 슬롯을 통틀어 한 곳도 없는 약만.
  const assignedMedIdSet = (() => {
    const set = new Set<string>();
    Object.values(medSlotMap).forEach((ids) => ids.forEach((id) => set.add(id)));
    return set;
  })();
  const unassignedMeds = medications.filter((m) => !assignedMedIdSet.has(m.id));

  // ── 렌더 ────────────────────────────────────────────────────────────────

  if (isLoading) {
    const LoadingWrap = hideTopBar ? View : SafeAreaView;
    return (
      <LoadingWrap style={styles.safeArea} {...(hideTopBar ? {} : { edges: ['top'] })}>
        {!hideTopBar && (
          <TopBar
            title={isMedsMode ? t('menu.medsTabLabel') : t('menu.doseSlotsTabLabel')}
            showBack={!hideBack}
            showBell
            bellBadge={unreadCount}
            onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
          />
        )}
        {/* 가벼운 스켈레톤: 약 카드 형태의 회색 플레이스홀더 3개 — 빈 스피너보다 로딩 체감 개선 */}
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: Colors.white,
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: Colors.border }} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={{ width: '55%', height: 18, borderRadius: 6, backgroundColor: Colors.border }} />
                <View style={{ width: '35%', height: 14, borderRadius: 6, backgroundColor: Colors.border, marginTop: 10 }} />
              </View>
            </View>
          ))}
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        </View>
      </LoadingWrap>
    );
  }

  const MainWrap = (hideTopBar || embedded) ? View : SafeAreaView;
  // 임베드면 자체 KAV/ScrollView 제거(부모 ScrollView가 스크롤 담당 → 중첩 스크롤 방지).
  const OuterKAV: any = embedded ? View : KeyboardAvoidingView;
  const outerKAVProps: any = embedded
    ? {}
    : { style: { flex: 1 }, behavior: Platform.OS === 'ios' ? 'padding' : 'height' };
  const InnerScroll: any = embedded ? View : ScrollView;
  const innerScrollProps: any = embedded
    // 임베드: 좌우 패딩 0(부모 Settings scrollContent padding:20이 담당 → 미복용/운동과 정렬),
    //   위 패딩 16(보호자용 알림 첫 카드 cardMarginTop과 동일).
    ? { style: { paddingHorizontal: 0, paddingTop: 16, paddingBottom: 8 } }
    : {
        ref: mainScrollRef, // 추가/수정한 슬롯으로 복귀 스크롤용
        style: styles.scroll,
        contentContainerStyle: styles.scrollContent,
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: 'handled',
      };
  return (
    <MainWrap style={embedded ? undefined : styles.safeArea} {...(hideTopBar || embedded ? {} : { edges: ['top'] })}>
      {!hideTopBar && (
        <TopBar
          title={isMedsMode ? t('menu.medsTabLabel') : t('menu.doseSlotsTabLabel')}
          showBack={!hideBack}
          showBell
          bellBadge={unreadCount}
          onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
        />
      )}
      {/* 미연동 보호자: 환자 약 대신 가족 연동 안내만 노출. 기준 화면(기록 보기)과 동일하게
          TopBar 아래 남는 영역 전체를 차지하며 세로·가로 중앙 정렬(ScrollView 바깥 flex:1). */}
      {caregiverUnlinked ? (
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>{t('medManage.linkPatientTitle')}</Text>
          <Text style={styles.unlinkedDesc}>
            {isMedsMode
              ? t('medManage.linkForMeds')
              : t('medManage.linkForSlots')}
          </Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            // 해외판 임베디드에서 raw navigate('FamilyLink')는 현재 탭에 그 라우트가 없어 무반응 →
            // 루트 기준 전역 네비게이션(MyInfo 탭의 FamilyLink)으로 항상 도달.
            onPress={() => navigateTo('Main', { screen: 'MyInfo', params: { screen: 'FamilyLink' } })}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>{t('medManage.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <OuterKAV {...outerKAVProps}>
        <InnerScroll {...innerScrollProps}>
          {/* ══════════════════════════════════════════════════════════════
              통합 복용 관리(슬롯 중심) — 와이어프레임 ①
              슬롯마다 ①시간 ②알림/약효추적 요약 ③그 슬롯에 먹는 약 + [약 넣기·빼기].
              "내 약 전체 보기"로 약별 목록(아래 기존 화면)으로 전환.
              ══════════════════════════════════════════════════════════════ */}
          {!isMedsMode && (
            <View style={styles.slotCentric}>
              {/* 광고: 복용시간·알림 설정 슬롯 목록 상단 — 해외+free 전용
                  (정확한 "슬롯 1·2 사이" 위치는 Phase 6에서 OTA로 조정) */}
              <AdSlot placement="remindersDoseTimes" />
              {/* 시간대에 아직 안 넣은 약 안내 — 등록만 하고 배정 안 한 약이 있을 때 */}
              {doseSlotList.length > 0 && unassignedMeds.length > 0 && (
                <TouchableOpacity
                  style={styles.unassignedBanner}
                  onPress={() => {
                    const firstSlot = doseSlotList.find((s) => !!s.id);
                    if (firstSlot) setMedSheetSlot(firstSlot);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="alert-circle" size={26} color={Colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.unassignedBannerTitle}>
                      {t('medManage.unassignedTitle', { count: unassignedMeds.length })}
                    </Text>
                    <Text style={styles.unassignedBannerSub}>
                      {t('medManage.unassignedSub')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={24} color={Colors.accent} />
                </TouchableOpacity>
              )}

              {doseSlotList.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="time-outline" size={56} color={Colors.textHint} />
                  <Text style={styles.emptyTitle}>{t('medManage.noSlotsTitle')}</Text>
                  <Text style={styles.emptyDesc}>{t('medManage.noSlotsDesc')}</Text>
                </View>
              ) : (
                doseSlotList.map((slot) => {
                  if (!slot.id) return null;
                  const sid = slot.id;
                  const medIds = medSlotMap[sid] ?? [];
                  const slotMeds = medIds
                    .map((id) => medById(id))
                    .filter((m): m is Medication => !!m);
                  return (
                    <View
                      key={sid}
                      style={styles.slotCard}
                      // 추가/수정 후 이 슬롯으로 돌아오기 위한 위치 수집(+대기 중이면 즉시 스크롤).
                      onLayout={(e) => {
                        const y = e.nativeEvent.layout.y;
                        slotCardY.current.set(sid, y);
                        if (pendingSlotScrollRef.current === sid) {
                          pendingSlotScrollRef.current = null;
                          (mainScrollRef.current as any)?.scrollTo?.({ y: Math.max(0, y - 12), animated: true });
                        }
                      }}
                    >
                      {/* 좌측 이미지 + 슬롯명·시간 + 수정/삭제(아이콘만) */}
                      <View style={styles.slotCardHead}>
                        <View style={styles.slotHeadEmoji}>
                          <SlotTimeIcon time={slot.time} size={30} />
                        </View>
                        <Text style={styles.slotCardTitle}>
                          {slotTitle(slot.label, slot.legacyKey, slot.time)}
                        </Text>
                        <View style={styles.slotHeadIcons}>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.slotHeadIconBtn}
                            onPress={() => openSlotAlarmEdit(sid)}
                            accessibilityLabel={t('medManage.a11yEditSlotTime')}
                          >
                            <Ionicons name="create-outline" size={24} color={Colors.textSub} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.slotHeadIconBtn}
                            onPress={() => handleDeleteSlot(slot)}
                            accessibilityLabel={t('medManage.a11yDeleteSlotTime')}
                          >
                            <Ionicons name="trash-outline" size={24} color={Colors.danger} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* 순서: 약 복용 알림 → 약효추적 → 약 */}
                      <View style={styles.slotToggleGroup}>
                        {/* 세트1: 약 복용 알림 + 그 알림소리(켜졌을 때) */}
                        <View style={styles.slotSetBox}>
                          <View style={styles.slotToggleRow}>
                            {/* 라벨/스위치를 각각 같은 높이(52) 박스에 넣고 박스 안에서 개별로 가운데 정렬 —
                                폰트 lineHeight·Switch 렌더 특성에 기대지 않는 확정적 정렬. */}
                            <View style={styles.slotToggleLabelBox}>
                              <Text style={[styles.slotToggleLabel, !slot.remindEnabled && styles.slotToggleLabelOff]}>
                                {t('medManage.medReminder')}
                              </Text>
                            </View>
                            <View style={styles.slotToggleSwitchBox}>
                              <Switch
                                value={slot.remindEnabled}
                                onValueChange={(v) => toggleSlotRemind(slot, v)}
                                trackColor={{ false: Colors.border, true: Colors.primary }}
                                thumbColor={Colors.white}
                              />
                            </View>
                          </View>
                          {slot.remindEnabled && (
                            <>
                              <View style={styles.slotSetDivider} />
                              <View style={styles.slotSoundWrap}>
                                <AlarmSoundPickerRow
                                  soundId={slot.remindSoundId}
                                  sounds={alarmSounds}
                                  onSelect={(sid) => setSlotRemindSound(slot, sid)}
                                  backgroundColor="transparent"
                                  fontSize={17}
                                />
                              </View>
                              <View style={styles.slotSetDivider} />
                              <TouchableOpacity
                                style={styles.slotModeRow}
                                onPress={() => pickAlarmMode(slot, 'remind')}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="alarm-outline" size={20} color={Colors.textSub} style={styles.slotModeIcon} />
                                <Text style={styles.slotModeLabel}>{t('medManage.alarmModeRow')}</Text>
                                {/* 값 컬럼: 글자크기 유지·줄바꿈, 둘째 줄은 값 시작 위치 정렬(약효추적 방식) */}
                                <View style={styles.slotModeValueCol}>
                                  <Text style={styles.slotModeValue}>
                                    {alarmModeLabel(slot.remindAlarmMode)}
                                  </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={Colors.textSub} style={styles.slotModeChevron} />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>

                        {/* 세트2: 약효 추적 알림 + 그 알림소리(켜졌을 때) */}
                        <View style={styles.slotSetBox}>
                          <View style={styles.slotTrackHeadRow}>
                            {/* 라벨+토큰은 flex-start(첫 줄 정렬·줄바꿈 유지). 스위치는 바깥 행 alignItems:center 로 블록 세로 가운데. */}
                            <View style={styles.slotTrackHeadContent}>
                              <Text style={[styles.slotTrackLabelText, !slot.trackEnabled && styles.slotToggleLabelOff]}>
                                {t('medManage.effectTrack')}
                              </Text>
                              {/* 요약 토큰 컬럼: 라벨 바로 오른쪽에서 시작 → 넘치면 이 컬럼 왼쪽(=복용직후 위치)에 정렬해 줄바꿈 */}
                              <View style={styles.slotTrackTokensCol}>
                                {slot.trackEnabled && slotTrackIntervalSummary(slot)
                                  ? slotTrackIntervalSummary(slot).split(' · ').map((tok, i, arr) => (
                                      // 구분점은 토큰 '뒤'에 붙임(마지막 제외) → 줄바꿈 시 점은 이전 줄 끝에 남고 새 줄은 글자로 시작.
                                      <Text key={i} style={styles.slotTrackToken}>
                                        {tok}
                                        {i < arr.length - 1 && (
                                          <Text style={styles.slotTrackTokenSep}>  ·  </Text>
                                        )}
                                      </Text>
                                    ))
                                  : null}
                              </View>
                            </View>
                            <Switch
                              value={slot.trackEnabled}
                              onValueChange={(v) => toggleSlotTrack(slot, v)}
                              trackColor={{ false: Colors.border, true: Colors.primary }}
                              thumbColor={Colors.white}
                            />
                          </View>
                          {slot.trackEnabled && (
                            <>
                              <View style={styles.slotSetDivider} />
                              <View style={styles.slotSoundWrap}>
                                <AlarmSoundPickerRow
                                  soundId={slot.trackSoundId}
                                  sounds={alarmSounds}
                                  onSelect={(sid) => setSlotTrackSound(slot, sid)}
                                  backgroundColor="transparent"
                                  fontSize={17}
                                />
                              </View>
                              <View style={styles.slotSetDivider} />
                              <TouchableOpacity
                                style={styles.slotModeRow}
                                onPress={() => pickAlarmMode(slot, 'track')}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="alarm-outline" size={20} color={Colors.textSub} style={styles.slotModeIcon} />
                                <Text style={styles.slotModeLabel}>{t('medManage.alarmModeRow')}</Text>
                                {/* 값 컬럼: 글자크기 유지·줄바꿈, 둘째 줄은 값 시작 위치 정렬(약효추적 방식) */}
                                <View style={styles.slotModeValueCol}>
                                  <Text style={styles.slotModeValue}>
                                    {alarmModeLabel(slot.trackAlarmMode)}
                                  </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={Colors.textSub} style={styles.slotModeChevron} />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>

                      {/* 복용약: 제목 + 약 이름(가나다순·중간점) — 토글 그룹 안에 두어 정렬 일치 */}
                      <View style={styles.slotDrugRow}>
                        <Text style={styles.slotDrugList}>
                          <Text style={styles.slotDrugTitle}>{t('medManage.medsListTitle')}  </Text>
                          {slotMeds.length === 0 ? (
                            <Text style={styles.slotDrugNone}>{t('medManage.noMedsInSlot')}</Text>
                          ) : (
                            [...slotMeds]
                              .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                              .map((m, i) => (
                                <Text
                                  key={m.id}
                                  style={styles.slotDrugNameItem}
                                  onPress={() => setSelectedDrug(m)}
                                >
                                  {i > 0 ? ' · ' : ''}{m.name}
                                </Text>
                              ))
                          )}
                        </Text>
                        <TouchableOpacity
                          style={styles.slotDrugBtn}
                          onPress={() => setMedSheetSlot(slot)}
                          activeOpacity={0.8}
                          accessibilityLabel={t('medManage.a11yAddRemoveMeds')}
                        >
                          <Ionicons name="create-outline" size={24} color={Colors.textSub} />
                        </TouchableOpacity>
                      </View>
                      </View>
                    </View>
                  );
                })
              )}

              {/* 복용 시간대 추가 버튼 — 슬롯 목록 하단. 누르면 곧장 시간 선택 시트(한 단계).
                  미연동 보호자는 대상 환자가 없으므로 추가 버튼 숨김(환자 본인 경로는 그대로). */}
              {!caregiverUnlinked && (
                <TouchableOpacity style={styles.addSlotBtn} onPress={openSlotAlarmAdd} activeOpacity={0.85}>
                  <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                  <Text style={styles.addSlotBtnText}>{t('medManage.addSlotBtn')}</Text>
                </TouchableOpacity>
              )}

            </View>
          )}

          {/* ══════════════════════════════════════════════════════════════
              내 약 (meds 모드) — 슬롯/시간대 일절 없음
              ⓞ 처방전으로 등록  ① 약 직접 입력  ② 등록된 약  ③ 지난 약 기록
              ══════════════════════════════════════════════════════════════ */}
          {isMedsMode && (
          <>
          {/* ── ⓞ 처방전으로 등록 (OCR) ── */}
          <TouchableOpacity
            style={styles.prescriptionBtn}
            onPress={handleOcrPress}
            activeOpacity={0.8}
          >
            <View style={styles.prescriptionIconCircle}>
              <Ionicons name="camera-outline" size={32} color={Colors.primary} />
            </View>
            <View style={styles.prescriptionTextGroup}>
              <Text style={styles.prescriptionTitle}>{t('medManage.prescriptionRegisterTitle')}</Text>
              <Text style={styles.prescriptionSub}>{t('medManage.prescriptionRegisterSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color={Colors.primary} />
          </TouchableOpacity>

          {/* 광고: 처방전 등록 버튼 바로 아래 — 해외+free 전용 */}
          <AdSlot placement="remindersMeds" />

          {/* ── ① 약 직접 입력 (섹션 제목은 박스 바깥) ── */}
          <Text style={styles.regSecTitle}>{t('medManage.directInputTitle')}</Text>
          <View style={styles.regBox}>
            {/* 약 이름 + 식약처 확인 한 줄 */}
            <Text style={styles.regLabel}>{t('medManage.medNameLabel')}</Text>
            <View style={styles.regRow}>
              <TextInput
                style={[styles.regInput, { flex: 1 }]}
                value={addName}
                onChangeText={(v) => { setAddName(v); setAddDrugInfo(undefined); }}
                placeholder={t('medManage.medNamePlaceholder')}
                placeholderTextColor="#C2C8D0"
                returnKeyType="done"
              />
              {/* 식약처(한국 정부) DB 조회 버튼 — 해외 로케일에선 의미 없어 숨김(2026-07) */}
              {!isOverseasLocale() && (
                <TouchableOpacity
                  style={[styles.mfdsConfirmBtn, addDrugInfo ? styles.mfdsConfirmBtnOk : null]}
                  onPress={handleFetchMfdsForAdd}
                  activeOpacity={0.85}
                  disabled={isMfdsLoading}
                >
                  {isMfdsLoading ? (
                    <ActivityIndicator size="small" color={addDrugInfo ? Colors.white : Colors.dark} />
                  ) : addDrugInfo ? (
                    <View style={styles.mfdsConfirmInner}>
                      <Ionicons name="checkmark-sharp" size={16} color={Colors.white} />
                      <Text style={[styles.mfdsConfirmBtnText, styles.mfdsConfirmBtnTextOk]}>{t('medManage.mfdsConfirmed')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.mfdsConfirmBtnText}>{t('medManage.mfdsCheck')}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {addDrugInfo === null && (
              <Text style={styles.mfdsInlineFail}>{t('medManage.mfdsNoInfo')}</Text>
            )}
            {addDrugInfo && addDrugInfo.entpName ? (
              <Text style={styles.mfdsInlineOk}>{addDrugInfo.entpName}</Text>
            ) : null}

            {/* 복용량 + 복용횟수 한 줄 */}
            <View style={styles.regRowTop}>
              <View style={styles.regHalf}>
                <Text style={styles.regLabel}>{t('medManage.dosageLabel')}</Text>
                {(() => {
                  // OCR 시트와 동일 패턴: 숫자 입력 + 정/mg 칩, "숫자+단위" 합성해 dosage 문자열에 저장.
                  const numMatch = addDosage.match(/[0-9]+(?:\.[0-9]+)?/);
                  const numStr = numMatch ? numMatch[0] : '';
                  const writeDosage = (n: string, u: '정' | 'mg') => {
                    setAddDosageUnit(u);
                    setAddDosage(n.trim() ? `${n.trim()}${u}` : '');
                  };
                  return (
                    <View style={styles.regDosageWrap}>
                      <TextInput
                        style={styles.regDosageInput}
                        value={numStr}
                        onChangeText={(v) => writeDosage(v.replace(/[^0-9.]/g, ''), addDosageUnit)}
                        placeholder="1"
                        placeholderTextColor="#C2C8D0"
                        keyboardType="decimal-pad"
                        maxLength={6}
                        returnKeyType="done"
                      />
                      <TouchableOpacity
                        style={styles.regCountUnitBtn}
                        onPress={() => writeDosage(numStr, addDosageUnit === '정' ? 'mg' : '정')}
                        activeOpacity={0.7}
                        accessibilityLabel={t('medManage.a11yDosageUnitSwap')}
                      >
                        <Text style={styles.regCountUnitText}>{addDosageUnit === '정' ? t('medManage.unitTablet') : addDosageUnit}</Text>
                        <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                      </TouchableOpacity>
                    </View>
                  );
                })()}
              </View>
              <View style={styles.regHalf}>
                <Text style={styles.regLabel}>{t('medManage.doseCountLabel')}</Text>
                {(() => {
                  // 해외판(영문)은 "3 times /day"처럼 값이 먼저, 단위 버튼이 맨 뒤(오른쪽) —
                  // 위 복용량(Dosage) 필드에서 단위 버튼이 오른쪽에 있는 것과 배치를 통일한다.
                  // 국내(한국어)는 "1일 3회"가 자연스러운 어순이라 기존 순서(버튼 먼저) 그대로 유지.
                  const unitBtn = (
                    <TouchableOpacity
                      key="unit"
                      style={styles.regCountUnitBtn}
                      onPress={() => setAddCountUnit(u => (u === 'day' ? 'week' : 'day'))}
                      activeOpacity={0.7}
                      accessibilityLabel={t('medManage.a11yCountUnitSwap')}
                    >
                      <Text style={styles.regCountUnitText}>{addCountUnit === 'week' ? t('medManage.countUnitWeek') : t('medManage.countUnitDay')}</Text>
                      <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                    </TouchableOpacity>
                  );
                  const input = (
                    <TextInput
                      key={`addcount-${addCountNonce}`}
                      style={styles.regCountInput}
                      defaultValue={addDailyCount}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9]/g, '');
                        addCountRef.current = clean;
                        setAddDailyCount(clean);
                      }}
                      placeholder="3"
                      placeholderTextColor="#C2C8D0"
                      keyboardType="number-pad"
                      maxLength={2}
                      returnKeyType="done"
                    />
                  );
                  const suffix = <Text key="suffix" style={styles.regCountFix}>{t('medManage.countSuffix')}</Text>;
                  return isOverseasLocale() ? (
                    <View style={styles.regCountWrap}>{input}{suffix}{unitBtn}</View>
                  ) : (
                    <View style={styles.regCountWrap}>{unitBtn}{input}{suffix}</View>
                  );
                })()}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.regSubmitBtn, !addName.trim() && styles.regSubmitBtnDisabled]}
              onPress={handleAddSubmitMyMedOnly}
              activeOpacity={0.85}
              disabled={!addName.trim()}
            >
              <Text style={styles.regSubmitBtnText}>{t('medManage.formSubmit')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── ② 등록된 약 (섹션 제목 바깥) ── */}
          <Text style={[styles.regSecTitle, styles.regSecTitleMt]}>{t('medManage.registeredMedsTitle')}</Text>
          {medications.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="medkit-outline" size={56} color={Colors.textHint} />
              <Text style={styles.emptyTitle}>{t('medManage.noRegisteredMedsTitle')}</Text>
              <Text style={styles.emptyDesc}>{t('medManage.noRegisteredMedsDesc')}</Text>
            </View>
          ) : (
            <View style={styles.allMedsList}>
              {medications.map(med => {
                const isEditing = editingId === med.id;

                if (isEditing) {
                  return (
                    <View key={med.id} style={styles.medCardEditing}>
                      <Text style={styles.regLabel}>{t('medManage.medNameLabel')}</Text>
                      <View style={styles.regRow}>
                        <TextInput
                          style={[styles.regInput, { flex: 1 }]}
                          value={editName}
                          onChangeText={(v) => { setEditName(v); setEditDrugInfo(undefined); }}
                          placeholder={t('medManage.medNamePlaceholder')}
                          placeholderTextColor="#C2C8D0"
                          returnKeyType="done"
                          autoFocus
                        />
                        {!isOverseasLocale() && (
                          <TouchableOpacity
                            style={[styles.mfdsConfirmBtn, editDrugInfo ? styles.mfdsConfirmBtnOk : null]}
                            onPress={handleFetchMfdsForEdit}
                            activeOpacity={0.85}
                            disabled={isEditMfdsLoading}
                          >
                            {isEditMfdsLoading ? (
                              <ActivityIndicator size="small" color={editDrugInfo ? Colors.white : Colors.dark} />
                            ) : editDrugInfo ? (
                              <View style={styles.mfdsConfirmInner}>
                                <Ionicons name="checkmark-sharp" size={16} color={Colors.white} />
                                <Text style={[styles.mfdsConfirmBtnText, styles.mfdsConfirmBtnTextOk]}>{t('medManage.mfdsConfirmed')}</Text>
                              </View>
                            ) : (
                              <Text style={styles.mfdsConfirmBtnText}>{t('medManage.mfdsCheck')}</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                      {editDrugInfo === null && (
                        <Text style={styles.mfdsInlineFail}>{t('medManage.mfdsNoInfo')}</Text>
                      )}
                      {editDrugInfo && editDrugInfo.entpName ? (
                        <Text style={styles.mfdsInlineOk}>{editDrugInfo.entpName}</Text>
                      ) : null}

                      <View style={styles.regRowTop}>
                        <View style={styles.regHalf}>
                          <Text style={styles.regLabel}>{t('medManage.dosageLabel')}</Text>
                          {(() => {
                            // OCR 시트/직접등록과 동일 패턴: 숫자 입력 + 정/mg 칩 → dosage 문자열에 합성 저장.
                            const numMatch = editDosage.match(/[0-9]+(?:\.[0-9]+)?/);
                            const numStr = numMatch ? numMatch[0] : '';
                            const writeDosage = (n: string, u: '정' | 'mg') => {
                              setEditDosageUnit(u);
                              setEditDosage(n.trim() ? `${n.trim()}${u}` : '');
                            };
                            return (
                              <View style={styles.regDosageWrap}>
                                <TextInput
                                  style={styles.regDosageInput}
                                  value={numStr}
                                  onChangeText={(v) => writeDosage(v.replace(/[^0-9.]/g, ''), editDosageUnit)}
                                  placeholder="1"
                                  placeholderTextColor="#C2C8D0"
                                  keyboardType="decimal-pad"
                                  maxLength={6}
                                  returnKeyType="done"
                                />
                                <TouchableOpacity
                                  style={styles.regCountUnitBtn}
                                  onPress={() => writeDosage(numStr, editDosageUnit === '정' ? 'mg' : '정')}
                                  activeOpacity={0.7}
                                  accessibilityLabel={t('medManage.a11yDosageUnitSwap')}
                                >
                                  <Text style={styles.regCountUnitText}>{editDosageUnit === '정' ? t('medManage.unitTablet') : editDosageUnit}</Text>
                                  <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                                </TouchableOpacity>
                              </View>
                            );
                          })()}
                        </View>
                        <View style={styles.regHalf}>
                          <Text style={styles.regLabel}>{t('medManage.doseCountLabel')}</Text>
                          {(() => {
                            // 해외판은 "3 times /day"처럼 값이 먼저, 단위 버튼이 맨 뒤(오른쪽) —
                            // 위 Dosage 필드와 배치 통일. 국내는 "1일 3회" 어순 그대로 유지.
                            const unitBtn = (
                              <TouchableOpacity
                                key="unit"
                                style={styles.regCountUnitBtn}
                                onPress={() => setEditCountUnit(u => (u === 'day' ? 'week' : 'day'))}
                                activeOpacity={0.7}
                                accessibilityLabel={t('medManage.a11yCountUnitSwap')}
                              >
                                <Text style={styles.regCountUnitText}>{editCountUnit === 'week' ? t('medManage.countUnitWeek') : t('medManage.countUnitDay')}</Text>
                                <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                              </TouchableOpacity>
                            );
                            const input = (
                              <TextInput
                                key="input"
                                style={styles.regCountInput}
                                defaultValue={editDailyCount}
                                onChangeText={(v) => {
                                  const clean = v.replace(/[^0-9]/g, '');
                                  editCountRef.current = clean;
                                  setEditDailyCount(clean);
                                }}
                                placeholder="3"
                                placeholderTextColor="#C2C8D0"
                                keyboardType="number-pad"
                                maxLength={2}
                                returnKeyType="done"
                              />
                            );
                            const suffix = <Text key="suffix" style={styles.regCountFix}>{t('medManage.countSuffix')}</Text>;
                            return isOverseasLocale() ? (
                              <View style={styles.regCountWrap}>{input}{suffix}{unitBtn}</View>
                            ) : (
                              <View style={styles.regCountWrap}>{unitBtn}{input}{suffix}</View>
                            );
                          })()}
                        </View>
                      </View>

                      <View style={styles.editActionRow}>
                        <TouchableOpacity style={styles.editCancelBtn} onPress={handleEditCancel} activeOpacity={0.85}>
                          <Text style={styles.editCancelBtnText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.editSaveBtn} onPress={handleEditSave} activeOpacity={0.85}>
                          <Text style={styles.editSaveBtnText}>{t('medManage.editSave')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }

                const dosageText = med.dosage && med.dosage.trim() ? formatDosageForDisplay(med.dosage) : '—';
                const countText = formatDoseCount(med.dailyCount, med.countUnit);
                return (
                  <View key={med.id} style={styles.regMedCard}>
                    <View style={styles.regMedLeft}>
                      <Text style={styles.regMedName}>{med.name}</Text>
                      <Text style={styles.regMedMeta}>
                        {t('medManage.dosageMetaPrefix', { dosage: dosageText })} · <Text style={styles.regMedMetaCount}>{countText}</Text>
                      </Text>
                      {/* 해외 로케일은 MFDS 확인 자체가 없는 기능이라 "정보 없음" 배지도 노출하지 않는다. */}
                      {!isOverseasLocale() && med.drugInfo === null && (
                        <Text style={styles.noInfoBadge}>{t('medManage.mfdsNoInfo')}</Text>
                      )}
                    </View>
                    {/* 우측 수정/삭제 = 아이콘만 (DoseSlotSetList 규칙) */}
                    <View style={styles.regMedIcons}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.regMedIconBtn}
                        onPress={() => handleEditStart(med)}
                        accessibilityLabel={t('medManage.a11yEditMed')}
                      >
                        <Ionicons name="create-outline" size={24} color={Colors.textSub} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.regMedIconBtn}
                        onPress={() => handleDelete(med)}
                        accessibilityLabel={t('medManage.a11yDeleteMed')}
                      >
                        <Ionicons name="trash-outline" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── ③ 지난 약 기록 (섹션 제목 바깥) — 표시 전용 ── */}
          {stoppedMeds.length > 0 && (
            <>
              <Text style={[styles.regSecTitle, styles.regSecTitleMt]}>{t('medManage.pastMedsTitle')}</Text>
              <View style={styles.allMedsList}>
                {stoppedMeds.map(med => {
                  const dosageText = med.dosage && med.dosage.trim() ? formatDosageForDisplay(med.dosage) : '—';
                  const countText = formatDoseCount(med.dailyCount, med.countUnit);
                  return (
                    <View key={med.id} style={styles.pastCard}>
                      <View style={styles.pastLeft}>
                        <Text style={styles.pastName}>{med.name}</Text>
                        <Text style={styles.pastMeta}>
                          {t('medManage.dosageMetaPrefix', { dosage: dosageText })} · {countText}
                        </Text>
                        <Text style={styles.pastPeriod}>
                          {t('medManage.pastPeriod', { range: formatStoppedRange(med.startedAt, med.endedAt) })}
                        </Text>
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.regMedIconBtn}
                        onPress={() => handleDeleteStoppedMed(med)}
                        accessibilityLabel={t('medManage.a11yDeletePastMed')}
                      >
                        <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* 온보딩 약효추적 흐름: 약 다 등록 → 다음(복용시간 설정으로 복귀해 약효추적 켜기). 이 흐름일 때만 노출 */}
          {route.params?.onboardingEffectTracking && (
            <TouchableOpacity
              style={styles.onbNextBtn}
              onPress={() => navigation.navigate('MedicationManage', { mode: 'slots', openEffectTrackingAfterMeds: true })}
              activeOpacity={0.85}
            >
              <Text style={styles.onbNextBtnText}>{t('medManage.onbMedsDoneNext')}</Text>
            </TouchableOpacity>
          )}

          </>
          )}
        </InnerScroll>
      </OuterKAV>
      )}

      {/* OCR 로딩 오버레이 */}
      {isOcrLoading && (
        <View style={styles.ocrOverlay}>
          <View style={styles.ocrCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.ocrText}>{t('medManage.ocrReadingTitle')}</Text>
            <Text style={styles.ocrSubText}>{t('medManage.ocrReadingSub')}</Text>
          </View>
        </View>
      )}

      {/* 약 상세 모달 */}
      <DrugInfoModal drug={selectedDrug} onClose={() => setSelectedDrug(null)} />

      {/* 약 넣기·빼기 바텀시트 (와이어프레임 ②) — 시각 입력 없이 슬롯 체크 */}
      <MedToSlotSheet
        slot={medSheetSlot}
        slots={doseSlotList}
        medications={medications}
        medSlotMap={medSlotMap}
        onClose={() => setMedSheetSlot(null)}
        onCommitMedSlot={commitMedSlot}
        onGoRegister={() => { setMedSheetSlot(null); handleRegisterPress(); }}
      />

      {/* ── "복용 시간대 추가"(addOnly) = 1겹 ──
          이전엔 호스트 Modal(딤 없는 투명 껍데기) 안에 DoseSlotSetList(addOnly)를 넣어
          그 안의 TimePickerSheet(또 다른 Modal)를 띄웠다 → 화면엔 Modal 이 2겹이라
          닫기 버튼 누르면 [시트 Modal 닫힘] + [호스트 Modal 닫힘]이 연속으로 보여
          "닫히고 또 한 번 닫힘"이 났다.
          이제 호스트 Modal 을 아예 렌더하지 않고, DoseSlotSetList(addOnly)를 화면에
          직접 마운트한다. addOnly 모드의 DoseSlotSetList 는 목록을 일절 렌더하지 않고
          (visibleSlots=[]) 내부 TimePickerSheet(Modal) 하나만 띄우므로, 화면에 실제로
          보이는 Modal 은 시간 선택 시트 단 1겹이다.
          닫기/취소 → 시트 onClose 가 setTimeSheet(null)[시트 Modal 1개만 닫힘] + onAddDone()
          으로 부모 state 초기화 → 이 빈 View(DoseSlotSetList 컨테이너)가 언마운트되지만
          그건 Modal 이 아니라 보이지 않는 빈 컨테이너라 슬라이드/닫힘 효과가 없다.
          저장 → onAddDone(newSlotId) → addOnly 해제 + soloSlotId 설정 → 아래 호스트 Modal
          (soloSlot 편집 시트)이 순차로 뜸(중첩 아님). */}
      {slotAlarmEditVisible && slotAlarmAddOnly && (
        <View style={dmStyles.addOnlyHost} pointerEvents="box-none">
          <DoseSlotSetList
            alarmSounds={alarmSounds}
            autoOpenAddNonce={slotAlarmAddNonce}
            addOnly
            onAddDone={handleSlotAlarmAddDone}
            onGoRegisterMeds={onGoRegisterMeds}
          />
        </View>
      )}

      {/* 시간·알림 수정 (DoseSlotSetList 재사용) — 단일 슬롯/전체 관리 편집(비-addOnly)
          ⚠️ iOS Modal 중첩 방지: 이 시트가 Modal이면 그 안의 "알림음 선택"(AlarmSoundPickerRow=Modal)이
             Modal-on-Modal이 되어 앱이 굳는다(오너 재현: choose alert sound 열고 멈춤).
             Modal 대신 전체화면 오버레이 View로 띄워, 위에 뜨는 피커 Modal이 유일한 Modal이 되게 한다. */}
      {slotAlarmEditVisible && !slotAlarmAddOnly && (
        <View style={dmStyles.editOverlay}>
          <View style={dmStyles.editSheet}>
            {/* 전체 관리 진입에서만 헤더 표시. 단일 슬롯 수정은 카드 제목 줄에 닫기를 둠(중복 제거). */}
            {!slotAlarmFocusId && (
              <View style={dmStyles.editHead}>
                <Text style={dmStyles.editTitle}>{t('medManage.editSlotsAllTitle')}</Text>
                <TouchableOpacity
                  style={dmStyles.editCloseBtn}
                  onPress={closeSlotAlarmEdit}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={20} color={Colors.dark} />
                  <Text style={dmStyles.editCloseText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
            )}
            <ScrollView
              ref={slotAlarmScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: slotAlarmFocusId ? 12 : 0, paddingBottom: sheetBottomPad }}
              showsVerticalScrollIndicator={false}
            >
              <DoseSlotSetList
                alarmSounds={alarmSounds}
                soloSlotId={slotAlarmFocusId}
                onSoloClose={closeSlotAlarmEdit}
                focusSlotId={slotAlarmFocusId}
                focusNonce={slotAlarmFocusNonce}
                autoOpenAddNonce={slotAlarmAddNonce}
                onGoRegisterMeds={onGoRegisterMeds}
                onFocusScrollTo={(y) =>
                  slotAlarmScrollRef.current?.scrollTo({
                    y: Math.max(0, y - 12),
                    animated: true,
                  })
                }
              />
            </ScrollView>
          </View>
        </View>
      )}

      {/* OCR 결과 확인 바텀시트 */}
      <Modal
        visible={ocrResultVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOcrResultVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={{
            backgroundColor: Colors.white,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: sheetBottomPad,
            maxHeight: '80%',
          }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 12 }}>
              {t('medManage.ocrResultTitle')}
            </Text>
            {/* OCR 정확성 강조 안내 — 경고 톤 박스 + 아이콘 */}
            <View style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 8,
              backgroundColor: '#FFF3E0', borderRadius: 12, borderLeftWidth: 4, borderLeftColor: Colors.accent,
              paddingVertical: 12, paddingHorizontal: 14, marginBottom: 16,
            }}>
              <Ionicons name="alert-circle" size={22} color={Colors.accent} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '600', color: '#8A5200', lineHeight: 26 }}>
                {t('medManage.ocrWarning')}
              </Text>
            </View>
            <ScrollView
              ref={ocrScrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 + ocrKbHeight }}
            >
              {ocrEnrichedMeds.map((med, idx) => {
                const rowLoading = ocrMfdsLoadingIds.has(med.id);
                // 오른쪽 "식약처 확인" 버튼 상태 3종: 확인됨(초록 채움) / 못 찾음(빨강 외곽선) / 미확인(주황 외곽선)
                const mfdsConfirmed = !!med.drugInfo;
                const mfdsNotFound = !med.drugInfo && med.mfdsFetched;
                const mfdsBtnBg = mfdsConfirmed ? Colors.primary : '#fff';
                const mfdsBtnBorder = mfdsConfirmed ? Colors.primary : (mfdsNotFound ? '#E57373' : '#CFE3D2');
                const mfdsBtnText = mfdsConfirmed ? '#fff' : (mfdsNotFound ? '#C62828' : Colors.dark);
                // 왼쪽 확인 체크박스(이 약 등록 선택 토글) 상태색
                const checkBg = med.checked ? Colors.primary : '#fff';
                const checkBorder = med.checked ? Colors.primary : '#CDD3DC';
                return (
                <View
                  key={med.id}
                  onLayout={(e) => { ocrCardY.current[med.id] = e.nativeEvent.layout.y; }}
                  style={{
                    borderWidth: 1,
                    borderColor: '#EEF1F4',
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 12,
                    backgroundColor: '#fff',
                  }}
                >
                  {/* 1행: 약 이름 + 식약처 확인 버튼 */}
                  <Text style={ocrStyles.fieldLabel}>{t('medManage.medNameLabel')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <TextInput
                      style={[ocrStyles.fieldInput, { flex: 1, fontWeight: '700' }]}
                      value={med.name}
                      onFocus={() => scrollOcrFocusedInput(ocrCardY.current[med.id] ?? 0)}
                      onChangeText={(v) => setOcrEnrichedMeds(prev =>
                        prev.map((m, i) => i === idx
                          ? { ...m, name: v, drugInfo: null, mfdsFetched: false }
                          : m)
                      )}
                      placeholder={t('medManage.medNameLabel')}
                      placeholderTextColor="#C2C8D0"
                      returnKeyType="done"
                    />
                    {!isOverseasLocale() && (
                      <TouchableOpacity
                        onPress={() => handleFetchMfdsForOcrRow(med.id)}
                        disabled={rowLoading}
                        activeOpacity={0.85}
                        style={{
                          minWidth: 96, minHeight: 52, paddingHorizontal: 10, borderRadius: 10,
                          backgroundColor: mfdsBtnBg,
                          borderWidth: mfdsConfirmed ? 0 : 1.6,
                          borderColor: mfdsBtnBorder,
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {mfdsConfirmed ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Ionicons name="checkmark-sharp" size={16} color="#fff" />
                            <Text style={{ fontSize: 15, fontWeight: '800', color: mfdsBtnText }}>{t('medManage.mfdsConfirmed')}</Text>
                          </View>
                        ) : (
                          <Text style={{ fontSize: 15, fontWeight: '800', color: mfdsBtnText, textAlign: 'center' }}>{t('medManage.mfdsCheck')}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                  {/* 식약처 연결 실패 안내 (직접입력 폼과 동일 패턴) */}
                  {mfdsNotFound && (
                    <View style={ocrStyles.mfdsFailRow}>
                      <Ionicons name="alert-circle" size={20} color={Colors.danger} style={{ marginTop: 2 }} />
                      <Text style={ocrStyles.mfdsFail}>{t('medManage.ocrMfdsFailMsg')}</Text>
                    </View>
                  )}
                  {mfdsConfirmed && med.drugInfo?.entpName ? (
                    <Text style={ocrStyles.mfdsOk}>{med.drugInfo.entpName}</Text>
                  ) : null}

                  {/* 2·3행: 복용량 / 복용횟수 (직접등록 폼과 명칭 통일). 각각 한 줄씩(세로 스택) —
                      가로 반반이면 "/week" 같은 긴 영문 라벨이 숫자 입력칸을 가리는 문제(직접등록 폼과 동일)가 있어 세로 배치. */}
                  <View style={{ gap: 10, marginTop: 14 }}>
                    <View style={{ width: '100%' }}>
                      <Text style={ocrStyles.fieldLabel}>{t('medManage.dosageLabel')}</Text>
                      {(() => {
                        const dUnit: '정' | 'mg' = med.dosageUnit ?? '정';
                        // dosage 문자열에서 숫자(소수 포함)만 추출해 숫자칸 초기값으로
                        const numMatch = (med.dosage ?? '').match(/[0-9]+(?:\.[0-9]+)?/);
                        const numStr = numMatch ? numMatch[0] : '';
                        const writeDosage = (n: string, u: '정' | 'mg') =>
                          setOcrEnrichedMeds(prev => prev.map((m, i) =>
                            i === idx ? { ...m, dosageUnit: u, dosage: n.trim() ? `${n.trim()}${u}` : null } : m));
                        return (
                          <View style={ocrStyles.dosageWrap}>
                            <TextInput
                              style={ocrStyles.dosageInput}
                              value={numStr}
                              onFocus={() => scrollOcrFocusedInput((ocrCardY.current[med.id] ?? 0) + 90)}
                              onChangeText={(v) => {
                                const clean = v.replace(/[^0-9.]/g, '');
                                writeDosage(clean, dUnit);
                              }}
                              placeholder="1"
                              placeholderTextColor="#C2C8D0"
                              keyboardType="decimal-pad"
                              maxLength={6}
                              returnKeyType="done"
                            />
                            <TouchableOpacity
                              style={ocrStyles.countUnitBtn}
                              onPress={() => writeDosage(numStr, dUnit === '정' ? 'mg' : '정')}
                              activeOpacity={0.7}
                              accessibilityLabel={t('medManage.a11yDosageUnitSwap')}
                            >
                              <Text style={ocrStyles.countUnitText}>{dUnit === '정' ? t('medManage.unitTablet') : dUnit}</Text>
                              <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                            </TouchableOpacity>
                          </View>
                        );
                      })()}
                    </View>
                    <View style={{ width: '100%' }}>
                      <Text style={ocrStyles.fieldLabel}>{t('medManage.doseCountLabel')}</Text>
                      <View style={ocrStyles.countWrap}>
                        <TouchableOpacity
                          style={ocrStyles.countUnitBtn}
                          onPress={() => setOcrEnrichedMeds(prev => prev.map((m, i) =>
                            i === idx ? { ...m, countUnit: m.countUnit === 'week' ? 'day' : 'week' } : m))}
                          activeOpacity={0.7}
                          accessibilityLabel={t('medManage.a11yCountUnitSwap')}
                        >
                          <Text style={ocrStyles.countUnitText}>{med.countUnit === 'week' ? t('medManage.countUnitWeek') : t('medManage.countUnitDay')}</Text>
                          <Ionicons name="swap-horizontal" size={13} color={Colors.dark} />
                        </TouchableOpacity>
                        <TextInput
                          style={ocrStyles.countInput}
                          value={med.dailyCount && med.dailyCount > 0 ? String(med.dailyCount) : ''}
                          onFocus={() => scrollOcrFocusedInput((ocrCardY.current[med.id] ?? 0) + 90)}
                          onChangeText={(v) => {
                            const clean = v.replace(/[^0-9]/g, '');
                            const n = clean ? parseInt(clean, 10) : null;
                            setOcrEnrichedMeds(prev => prev.map((m, i) =>
                              i === idx ? { ...m, dailyCount: (n && n > 0) ? n : null } : m));
                          }}
                          placeholder="3"
                          placeholderTextColor="#C2C8D0"
                          keyboardType="number-pad"
                          maxLength={2}
                          returnKeyType="done"
                        />
                        <Text style={ocrStyles.countFix}>{t('medManage.countSuffix')}</Text>
                      </View>
                    </View>
                  </View>

                  {/* 하단: 등록 선택 체크박스(입력 행과 분리) */}
                  <TouchableOpacity
                    onPress={() => setOcrEnrichedMeds(prev =>
                      prev.map((m, i) => i === idx ? { ...m, checked: !m.checked } : m)
                    )}
                    activeOpacity={0.8}
                    accessibilityLabel={t('medManage.a11ySelectThisMed')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14 }}
                  >
                    <View style={{
                      width: 28, height: 28, borderRadius: 8,
                      backgroundColor: checkBg, borderWidth: 1.8, borderColor: checkBorder,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {med.checked ? <Ionicons name="checkmark-sharp" size={18} color="#fff" /> : null}
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: med.checked ? Colors.dark : Colors.textSub }}>
                      {t('medManage.selectThisMedLabel')}
                    </Text>
                  </TouchableOpacity>
                </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={handleOcrConfirm}
              style={{
                marginTop: 20,
                backgroundColor: Colors.primary,
                borderRadius: 12,
                paddingVertical: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                {t('medManage.registerSelected', { count: ocrEnrichedMeds.filter(m => m.checked).length })}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 식약처 조회 중 — 시트 중앙 큰 스피너 오버레이 */}
          {ocrMfdsLoadingIds.size > 0 && (
            <View style={styles.ocrOverlay}>
              <View style={styles.ocrCard}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={[styles.ocrText, { textAlign: 'center', lineHeight: 28 }]}>{i18n.t('loading.checkingMfds')}</Text>
                <Text style={styles.ocrSubText}>{t('medManage.mfdsCheckingSub')}</Text>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* 온보딩 마무리 — 약별 복용 시간대 배정(약효추적 안내 팝업 다음 단계) */}
      <MedSlotAssignModal
        visible={assignVisible}
        patientId={targetPatientId ?? user?.id ?? null}
        onDone={() => {
          setAssignVisible(false);
          loadDoseSlotsRef.current?.();
          loadMedicationsRef.current?.();
          setTimeout(() => {
            dialog.alert({ title: t('medSlotAssign.doneTitle'), message: t('medSlotAssign.doneMsg') });
          }, 250);
        }}
      />
    </MainWrap>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

// 시간·알림 수정(DoseSlotSetList) 모달 스타일
const dmStyles = StyleSheet.create({
  // Modal이 아니라 화면 트리에 직접 마운트되는 전체화면 오버레이 → absolute fill(형제 레이아웃 안 밀림).
  editOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', zIndex: 1000, elevation: 1000 },
  // 추가 전용 진입 — 관리 모달 껍데기 없이 시간 시트(TimePickerSheet=Modal)만 띄우는
  // 빈 투명 호스트. 이제 Modal 안이 아니라 화면 트리에 직접 마운트되므로, 본문 ScrollView
  // 등 형제 레이아웃을 밀지 않도록 absolute fill + box-none(터치 통과)로 둔다.
  // 보이는 건 자식 TimePickerSheet(Modal, 루트 렌더)뿐이라 이 컨테이너 자체는 무영향.
  addOnlyHost: { ...StyleSheet.absoluteFillObject },
  editSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    // 고정 height (maxHeight 아님). 바닥 고정(flex-end) + 콘텐츠 기준 maxHeight 였을 때는
    // 약효추적 recBox 가 토글로 생겼다/사라지며 콘텐츠 높이가 변해 시트 윗변이 점프했다.
    // 외곽 높이를 콘텐츠와 무관하게 고정하면 윗변이 고정되어 점프가 구조적으로 사라진다.
    // 내부 콘텐츠는 아래 ScrollView(flex:1) 안에서만 늘었다 줄었다 하므로 윗변에 영향 없음.
    // 92% 는 단일 슬롯 편집에서 빈 공간이 과해 80% 로 (점수 제거가 최우선, 빈 공간 절충).
    height: '80%', paddingTop: 8,
  },
  editHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  editTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  editCloseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EEF0F3',
  },
  editCloseText: { fontSize: 15, fontWeight: '700', color: Colors.dark },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  // 온보딩 약효추적 흐름: 약 등록 화면 하단 "다 등록했어요 → 다음" 버튼(sticky 아님, 목록 아래 스크롤).
  onbNextBtn: {
    marginTop: 20,
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onbNextBtnText: { fontSize: 20, fontWeight: '800', color: Colors.white },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 40 },

  // ── 통합 복용 관리(슬롯 중심) ──
  slotCentric: { marginBottom: 8 },
  slotCentricHint: { fontSize: 16, color: Colors.textSub, marginBottom: 14, marginLeft: 2 },
  addSlotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 56, borderRadius: 14, borderWidth: 1.6, borderColor: Colors.primary,
    backgroundColor: Colors.light, marginBottom: 16, paddingHorizontal: 12,
  },
  addSlotBtnText: { fontSize: 16, fontWeight: '700', color: Colors.dark },
  unassignedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderWidth: 1.6, borderColor: Colors.accent,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 16,
  },
  unassignedBannerTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  unassignedBannerSub: { fontSize: 15, color: Colors.textSub, marginTop: 3 },
  slotCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: '#EAEDF1',
    borderRadius: 18, padding: 16, marginBottom: 13,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  slotCardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  // 좌측 이미지(이모지) 원형 — 편집 시트와 동일 느낌
  slotHeadEmoji: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light,
    alignItems: 'center', justifyContent: 'center',
  },
  slotHeadEmojiText: { fontSize: 20 },
  slotCardTitle: { flex: 1, fontSize: 19, fontWeight: '800', color: Colors.text },
  // 우측 수정/삭제 — 아이콘만(글자 없음)
  slotHeadIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotHeadIconBtn: { padding: 6 },
  slotEditPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F1F3F6', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9,
  },
  slotEditPillText: { fontSize: 15, fontWeight: '700', color: '#5B6472' },
  // 박스 제거 — 토글 행과 같은 정렬(좌측 패딩 0)로 '복용약'이 약효추적 라인에 맞춰짐
  slotDrugRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    minHeight: 48, paddingVertical: 4,
  },
  slotDrugList: { flex: 1, fontSize: 17, lineHeight: 26 },
  slotDrugTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  slotDrugNameItem: { fontSize: 17, fontWeight: '700', color: Colors.dark },
  slotDrugNone: { fontSize: 17, color: '#A6AEBA', fontWeight: '500' },
  drugPill: { backgroundColor: Colors.light, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  drugPillText: { fontSize: 17, fontWeight: '700', color: Colors.dark },
  slotDrugBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  slotDrugBtnText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  slotToggleGroup: {
    borderTopWidth: 1, borderTopColor: '#EEF1F4', paddingTop: 6, marginTop: 2, gap: 2,
  },
  // 알림+알림소리를 한 박스로 묶은 "세트"(음영 겹침 대신 그룹핑). 살짝 녹색 배경.
  slotSetBox: {
    borderWidth: 1, borderColor: '#CFE6D4', borderRadius: 12, backgroundColor: '#EBF6ED',
    marginBottom: 10, overflow: 'hidden',
  },
  slotSetDivider: { height: 1, backgroundColor: '#D3E8D7' },
  // 토글 행 = 소리 행과 같은 높이(52)로 통일. paddingVertical 없이 minHeight 로만.
  slotToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 52, paddingHorizontal: 14,
  },
  // 라벨/스위치를 같은 높이(52) 박스에 넣고 각자 justifyContent:center 로 가운데 정렬.
  // 폰트 lineHeight·Switch 렌더 특성에 기대지 않는 확정적 방식(둘 다 52 높이 박스 정중앙).
  slotToggleLabelBox: { flex: 1, height: 52, justifyContent: 'center', paddingRight: 10 },
  slotToggleSwitchBox: { height: 52, justifyContent: 'center', alignItems: 'center' },
  slotToggleLabel: { fontSize: 17, fontWeight: '700', color: Colors.text },
  slotToggleLabelOff: { color: '#A6AEBA', fontWeight: '600' },
  // 알림소리 행(AlarmSoundPickerRow) 자체 marginTop:8 을 상쇄해 구분선 바로 아래 붙임(토글 행과 등높이).
  slotSoundWrap: { marginTop: -8 },
  // 약효추적 헤더 행: [라벨][요약토큰 컬럼(flex:1)][스위치]. flex-start 라 라벨과 첫 토큰(복용직후)이 같은 줄.
  slotTrackHeadRow: {
    // 바깥 행은 center → 스위치가 (라벨+토큰) 블록 세로 가운데. 라벨/토큰 자체는 아래 content 가 flex-start 로 첫 줄 정렬.
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13,
  },
  slotTrackHeadContent: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-start',
  },
  slotTrackLabelText: { fontSize: 17, fontWeight: '700', color: Colors.text, lineHeight: 26, marginRight: 8 },
  // 토큰 컬럼: 라벨 오른쪽에서 시작, 넘치면 이 컬럼 왼쪽(복용직후 라인)에 맞춰 줄바꿈.
  slotTrackTokensCol: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  // 요약 글자 크기도 17로 통일(라벨·복용약·알림소리와 동일).
  slotTrackToken: { color: Colors.dark, fontWeight: '700', fontSize: 17, lineHeight: 26 },
  slotTrackTokenSep: { color: '#9CC3A2', fontWeight: '700', fontSize: 17, lineHeight: 26 },
  // "알림 방식" 행 — 알림 소리 행(AlarmSoundPickerRow triggerBtn)과 같은 높이·좌우 패딩(14)으로 정렬.
  // 값이 길면 글자크기 유지한 채 줄바꿈 → flex-start 정렬(약효추적 방식).
  slotModeRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 52, paddingHorizontal: 14, paddingVertical: 13,
  },
  slotModeIcon: { marginTop: 3 },
  slotModeChevron: { marginTop: 4 },
  slotModeLabel: { fontSize: 17, lineHeight: 26, fontWeight: '700', color: Colors.text },
  // 값 컬럼: 라벨 오른쪽 남은 폭 차지 → 줄바꿈 시 둘째 줄이 값 시작 위치에 정렬.
  slotModeValueCol: { flex: 1 },
  slotModeValue: { fontSize: 17, lineHeight: 26, fontWeight: '700', color: Colors.dark },
  viewAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 56, borderWidth: 1, borderColor: '#DCE0E6', backgroundColor: Colors.white,
    borderRadius: 13, marginTop: 6, paddingHorizontal: 12,
  },
  viewAllBtnText: { fontSize: 16, fontWeight: '700', color: '#3A414C' },
  // 슬롯 뷰 → "내 약" 메뉴 안내 버튼 (약 등록 이관)
  goMyMedsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 56, borderRadius: 14, borderWidth: 1.4, borderColor: '#CFE3D2',
    backgroundColor: '#F1F8F2', marginBottom: 16, paddingHorizontal: 14,
  },
  goMyMedsBtnText: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.primary },

  // ── 내 약 (meds 모드) 등록·관리 페이지 ──
  // ① 섹션 제목(박스 바깥)
  regSecTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 6, marginBottom: 10, marginLeft: 2 },
  regSecTitleMt: { marginTop: 24 },

  // 약 직접 입력 박스
  regBox: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: '#EAEDF1',
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  regLabel: { fontSize: 13.5, fontWeight: '800', color: '#4A515C', marginBottom: 6, marginLeft: 2 },
  regRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // 복용량/복용횟수 각각 한 줄씩(세로 스택) — 가로 반반이면 "/week" 같은 긴 영문 라벨이
  // 숫자 입력칸을 가려버리는 문제가 있어(오너 지적, 2026-07) 세로 배치로 변경.
  regRowTop: { gap: 10, marginTop: 14 },
  regHalf: { width: '100%' },
  regInput: {
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: Colors.text, backgroundColor: Colors.white,
  },
  // 식약처 확인 버튼(미확인=연초록 외곽선, 확인됨=초록 채움) — 앱 메인 컬러(초록)에 맞춤
  mfdsConfirmBtn: {
    width: 104, minHeight: 52, borderRadius: 10,
    borderWidth: 1.6, borderColor: '#CFE3D2', backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  mfdsConfirmBtnOk: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  mfdsConfirmInner: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  mfdsConfirmBtnText: { fontSize: 15, fontWeight: '800', color: Colors.dark, textAlign: 'center' },
  mfdsConfirmBtnTextOk: { color: Colors.white },
  mfdsInlineOk: { fontSize: 14, fontWeight: '600', color: '#2E7D32', marginTop: 8, marginLeft: 2 },
  mfdsInlineFail: { fontSize: 14, fontWeight: '600', color: '#E65100', marginTop: 8, marginLeft: 2 },
  // 복용횟수 "1일 [숫자] 회"
  regCountWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 12, backgroundColor: Colors.white,
  },
  regCountFix: { fontSize: 16, fontWeight: '700', color: '#4A515C' },
  // 1일/1주 단위 토글 버튼 (탭하면 전환)
  regCountUnitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.light, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7,
  },
  regCountUnitText: { fontSize: 16, fontWeight: '800', color: Colors.dark, minWidth: 30, textAlign: 'center' },
  regCountInput: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', paddingVertical: 12 },
  // 복용량: 숫자 입력 + 단위 토글(정↔mg, 복용횟수 1일/1주 토글과 동일) — 복용횟수 박스와 같은 골격
  regDosageWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 10, backgroundColor: Colors.white,
  },
  regDosageInput: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', paddingVertical: 12 },
  regSubmitBtn: {
    minHeight: 56, borderRadius: 12, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  regSubmitBtnDisabled: { backgroundColor: '#A5D6A7' },
  regSubmitBtnText: { fontSize: 17, fontWeight: '800', color: Colors.white },

  // ② 등록된 약 카드
  regMedCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: '#EAEDF1',
    borderRadius: 14, padding: 16, marginBottom: 10,
  },
  regMedLeft: { flex: 1 },
  regMedName: { fontSize: 17, fontWeight: '800', color: Colors.text },
  regMedMeta: { fontSize: 15, fontWeight: '600', color: '#3A414C', marginTop: 6 },
  regMedMetaCount: { color: '#3A414C', fontWeight: '800' },
  regMedIcons: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10 },
  regMedIconBtn: { padding: 8 },

  // ③ 지난 약 기록 카드
  pastCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FAFBFC', borderWidth: 1, borderColor: '#EEF1F4',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
  },
  pastLeft: { flex: 1 },
  pastName: { fontSize: 16, fontWeight: '700', color: '#8A929E' },
  pastMeta: { fontSize: 15, fontWeight: '600', color: '#8A929E', marginTop: 5 },
  pastPeriod: { fontSize: 14, fontWeight: '600', color: '#AEB4BE', marginTop: 3 },

  // 처방전 버튼
  prescriptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    borderWidth: 2,
    borderColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 16,
  },
  prescriptionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prescriptionTextGroup: { flex: 1, marginHorizontal: 16 },
  prescriptionTitle: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  prescriptionSub: { fontSize: 16, color: Colors.textSub, marginTop: 4 },

  // 전체 수정 영역
  allEditArea: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  allEditSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
    marginTop: 8,
  },

  // 직접 추가 폼
  addFormCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  medInput: {
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    color: Colors.text,
    marginBottom: 12,
    backgroundColor: Colors.white,
  },

  // 식약처 버튼 및 결과
  mfdsBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  mfdsBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  mfdsResult: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  mfdsResultOk: { backgroundColor: '#E8F5E9' },
  mfdsResultFail: { backgroundColor: '#FFF3E0' },
  mfdsResultText: { fontSize: 16, fontWeight: '600' },
  mfdsResultTextOk: { color: '#2E7D32' },
  mfdsResultTextFail: { color: '#E65100' },

  addFormHint: { fontSize: 16, color: Colors.textSub, lineHeight: 24, marginBottom: 12 },
  addSubmitBtnDisabled: { backgroundColor: Colors.border },

  // 빈 상태
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  emptyDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },

  // 미연동 보호자 안내(가족 연동 유도) — 기준 화면(기록 보기·영상 기록)과 동일한 중앙 심플 안내
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  unlinkedTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  unlinkedDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },
  linkFamilyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    marginTop: 24,
  },
  linkFamilyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },

  // 약 카드 (전체 수정 영역 내)
  medCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 10,
    minHeight: 130,
  },
  medCardEditing: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    padding: 16,
    marginBottom: 10,
  },
  medName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  medEditBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medEditBtnText: { fontSize: 16, fontWeight: '700', color: '#555' },
  medDeleteBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medDeleteBtnText: { fontSize: 16, fontWeight: '700', color: '#F44336' },
  medCardBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  noInfoBadge: { fontSize: 16, color: Colors.danger, marginTop: 4 },

  // 내 약 전체 보기 — 약별 평면 목록
  allMedsTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginTop: 4, marginBottom: 12 },
  allMedsList: { marginBottom: 16 },
  medDailyCount: { fontSize: 17, fontWeight: '700', color: Colors.dark, marginTop: 6 },
  medSlotBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  medSlotBadge: { backgroundColor: Colors.light, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  medSlotBadgeText: { fontSize: 17, fontWeight: '700', color: Colors.dark },
  medSlotBadgeNone: { fontSize: 17, color: Colors.textHint, fontWeight: '600' },
  medInfoBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E8F5E9',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medInfoBtnText: { fontSize: 16, fontWeight: '700', color: '#2E7D32' },

  // 인라인 수정 액션
  editActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancelBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  editSaveBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // OCR 오버레이
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ocrCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    minWidth: 200,
  },
  ocrText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  ocrSubText: { fontSize: 18, color: Colors.textSub },

  // ── 중단한 약(이력) 섹션 — "복용 중인 약"과 같은 골격(제목 + 약별 카드). 카드 톤만 흐림 ──
  stoppedSection: { marginTop: 12, marginBottom: 20 },
  stoppedSectionDesc: { fontSize: 16, color: Colors.textHint, marginTop: -6, marginBottom: 12 },
  // 복용 중 medCard 와 동일 골격(개별 카드). 톤만 흐리게(회색 배경·연한 테두리).
  stoppedCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 10,
  },
  stoppedName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textHint,
    textDecorationLine: 'line-through',
    marginBottom: 6,
  },
  stoppedRange: { fontSize: 16, color: Colors.textHint },
});

// ── OCR 결과 바텀시트 약 카드 입력 스타일 (목업 step4 레이아웃) ──
const ocrStyles = StyleSheet.create({
  fieldLabel: { fontSize: 16, fontWeight: '800', color: '#4A515C', marginBottom: 6, marginLeft: 2 },
  fieldInput: {
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 18, color: Colors.text, backgroundColor: Colors.white,
  },
  mfdsOk: { fontSize: 18, fontWeight: '600', color: '#2E7D32', marginTop: 8, marginLeft: 2 },
  // 행잉 인덴트용: 아이콘 분리 후 텍스트만 담는 스타일 (flex:1로 둘째 줄 정렬)
  mfdsFail: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.danger, lineHeight: 26 },
  mfdsFailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, marginLeft: 2 },
  countWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 10, backgroundColor: Colors.white,
  },
  countUnitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.light, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7,
  },
  countUnitText: { fontSize: 16, fontWeight: '800', color: Colors.dark, minWidth: 30, textAlign: 'center' },
  countInput: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', paddingVertical: 12 },
  countFix: { fontSize: 16, fontWeight: '700', color: '#4A515C' },
  // 1회 투약량: 숫자 입력 + 단위 칩(정/mg) — 투여횟수 행과 같은 박스 골격
  dosageWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: 52, borderWidth: 1.4, borderColor: '#E0E4EA', borderRadius: 10,
    paddingHorizontal: 10, backgroundColor: Colors.white,
  },
  dosageInput: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', paddingVertical: 12 },
});
