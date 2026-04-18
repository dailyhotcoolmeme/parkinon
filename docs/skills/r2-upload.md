# Cloudflare R2 업로드 패턴

## 설정

R2 업로드는 Supabase Edge Function을 통해 처리한다.
클라이언트에서 직접 R2에 접근하지 말 것.

---

## 영상 업로드 흐름

```
클라이언트
  → duration 체크 (2분 초과 시 업로드 중단)
  → 영상 압축 (expo-video-thumbnails + ffmpeg)
  → Supabase Edge Function 호출
  → R2에 저장
  → media_logs 테이블에 URL 저장
```

---

## Supabase Edge Function (r2-upload)

```typescript
// supabase/functions/r2-upload/index.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const R2 = new S3Client({
  region: 'auto',
  endpoint: Deno.env.get('R2_ENDPOINT'),
  credentials: {
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  },
});

Deno.serve(async (req) => {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const patientId = formData.get('patientId') as string;
  const type = formData.get('type') as string; // 'video' | 'image'

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fileName = `${Date.now()}-${file.name}`;
  const key = `parkinon/${type}s/${patientId}/${yearMonth}/${fileName}`;

  await R2.send(new PutObjectCommand({
    Bucket: Deno.env.get('R2_BUCKET_NAME'),
    Key: key,
    Body: await file.arrayBuffer(),
    ContentType: file.type,
  }));

  const url = `${Deno.env.get('R2_PUBLIC_URL')}/${key}`;
  return new Response(JSON.stringify({ url }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

---

## 클라이언트 업로드 호출

```typescript
const uploadVideo = async (uri: string, patientId: string) => {
  const formData = new FormData();
  formData.append('file', {
    uri,
    type: 'video/mp4',
    name: 'video.mp4',
  } as any);
  formData.append('patientId', patientId);
  formData.append('type', 'video');

  const { data, error } = await supabase.functions.invoke('r2-upload', {
    body: formData,
  });

  return data.url;
};
```

---

## 파일 경로 규칙

```
parkinon/videos/{patient_id}/{YYYY-MM}/{timestamp}-{filename}
parkinon/images/{patient_id}/{YYYY-MM}/{timestamp}-{filename}
```

---

## 보관 정책

- 영상: 6개월 후 자동 삭제 (R2 lifecycle rule 설정)
- media_logs.expires_at 필드에 만료일 저장
- 처방전 원본 사진: 분석 완료 즉시 삭제 (저장 안 함)

---

## 주의사항

- 영상 최대 2분. 클라이언트에서 duration 체크 후 업로드.
- 최대 압축 적용 후 업로드.
- 업로드 실패 시 재시도 로직 구현.
- R2 환경변수는 Supabase Edge Function secrets에 저장.
