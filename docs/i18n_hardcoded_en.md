해외 분기 안 영어 하드코딩 88건 / 28개 파일

──── screens/menu/SettingsScreen.tsx (12)
    129  "${slotLabel(curr)}(${slotTimes[curr]})~${slotLabel(next)}(${slotTimes[next]})"
    142  "${h}${sep}${hourUnit} ${m}${sep}${minuteUnit}"
    143  "${h}${sep}${hourUnit}"
    144  "${m}${sep}${minuteUnit}"
    156  "${SUPABASE_URL}/rest/v1/users?id=eq.${userId}"
    160  "Authorization"
    160  "Bearer ${accessToken}"
    161  "Content-Type"
    162  "Prefer"
    162  "return=minimal"
   1654  "${n.ampm} ${n.hour}:${mm}"
   1684  "NotificationHistory"
──── screens/menu/MedicalRecordListScreen.tsx (7)
     61  "${fullDate(d)} ${hh}:${mm}"
     72  "${monthDayShort(d)} ${formatClock(d)}"
    119  "${ampm} ${h12}:${String(m).padStart(2, '0')}"
    122  "HH:MM"
    125  "${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}"
    148  "${ampm} ${h12}:${String(m).padStart(2, '0')}"
    169  "${dateStr}\\n${i18n.t('medRecordList.alarmPastNote')}"
──── utils/dateLabels.ts (7)
     31  "Mon"
     37  "July 2026"
     37  "juillet 2026"
     43  "July 29, Wednesday"
     51  "Jul 29 (Tue)"
     54  "${date.getMonth() + 1}/${date.getDate()} (${KO_WEEKDAY_SHORT[date.getDay()]})"
     62  "${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. (${KO_WEEKDAY_SHORT[date.getDay()]})"
──── navigation/MainNavigator.tsx (6)
     53  "Medication"
     54  "BodyStateTab"
     55  "Exercise"
     57  "OverseasMedTab"
     58  "Feed"
     59  "MyInfo"
──── screens/diary/DiaryScreen.tsx (6)
     80  "Georgia"
    130  "${ampm} ${h12}:${min}"
    139  "${m}:${String(s).padStart(2, '0')}"
   1379  "diary.quotaPhotoMsg"
   1379  "diary.quotaVideoMsg"
   1379  "diary.quotaVoiceMsg"
──── screens/menu/AppointmentWriteScreen.tsx (6)
    242  "${d} (${getDayOfWeek(year, month, d)})"
    453  "${selYear}-${selMonth}-${selDay} (${dow})"
    456  "${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}"
    474  "Bearer ${token}"
    475  "Content-Type"
    476  "return=representation"
──── hooks/useDiary.ts (5)
    143  "right after taking"
    144  "${min} min later"
    145  "${h} hr later"
    145  "${h} hr ${rem} min later"
    166  "${year}-${pad(month0 + 1)}-01"
──── constants/presetAlarmSounds.ts (4)
     59  "preset:<fileId>"
     71  "<fileId>.caf"
     73  "${fileId}.caf"
     76  "parkinon_preset_<fileId>"
──── screens/menu/MedicalRecordDetailScreen.tsx (4)
     53  "${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}"
     62  "#E3F2FD"
     63  "#FFEBEE"
     65  "#EEEEEE"
──── screens/menu/MedicalRecordWriteScreen.tsx (4)
    154  "${d} (${getDayOfWeek(year, month, d)})"
    217  "${SUPABASE_URL}/functions/v1/claude-medical-record"
    419  "${selYear}-${selMonth}-${selDay} (${dow})"
    422  "${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}"
──── screens/bodystate/VideoRecordScreen.tsx (3)
    207  "Main"
    207  "MyInfo"
    207  "SubscriptionManage"
──── screens/menu/MenuScreen.tsx (3)
    336  "menu.measurementCaregiverLabel"
    338  "menu.measurementCaregiverDesc"
    342  "menu.sectionRecords"
──── constants/doseSlots.ts (2)
    159  "${displayH}:${mm}"
    163  "${period} ${displayH}:${mm}"
──── screens/medication/MedicationScreen.tsx (2)
    109  "${ampm} ${hour}:${mm}"
    119  "${ampm} ${hour}:${mm}"
──── screens/menu/MedicationManageScreen.tsx (2)
    171  "${num} ${i18n.t('medManage.unitTablet')}"
   3869  "#fff"
──── screens/sound/AlarmSoundSettingsScreen.tsx (2)
    389  "SubscriptionManage"
    392  "RecordSound"
──── utils/measurementFormat.ts (2)
     22  "${seconds}s (${ms}ms)"
     41  "${y}-${mo}-${da}(${w}) ${h}:${mi}"
──── components/common/AdSlot.tsx (1)
     43  "ads not allowed (no consent)"
──── components/common/HistoryTimeline.tsx (1)
     76  "${m}.${d}(${dayNames[date.getDay()]})"
──── components/common/TopBar.tsx (1)
     70  "Medication"
──── lib/ads.ts (1)
     48  "[ads] consent gather start"
──── screens/bodystate/BodyStateScreen.tsx (1)
     97  "${ampm} ${hour}:${mm}"
──── screens/exercise/ExerciseScreen.tsx (1)
    305  "ExerciseVideo"
──── screens/notification/NotificationHistoryScreen.tsx (1)
    123  "${ampm} ${hour}:${String(m).padStart(2, '0')}"
──── utils/notifActionFeedback.ts (1)
     80  "${period} ${dh}:${mm}"
──── utils/notifLabels.ts (1)
     29  "${hour}:${mm}"
──── utils/notifications.ts (1)
     34  "missed-med-remind-${mealTime}"
──── utils/recommendUtils.ts (1)
    118  "rec-${minutes}"
