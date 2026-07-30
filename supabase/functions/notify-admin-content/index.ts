// 정보·나눔에 새 글/댓글이 올라오면 운영자 이메일로 알린다.
//
// 왜 필요한가:
//   지금은 운영자가 관리자 화면에 수시로 들어가봐야 새 글이 올라온 걸 안다.
//   질문 글에 답을 늦게 달게 되는 문제가 있어, 올라오는 즉시 메일로 받는다.
//
// 어떻게 불리나:
//   posts / comments 의 INSERT 트리거가 pg_net 으로 이 함수를 호출한다(서버측 — 앱을 거치지 않음).
//   앱에서 호출하면 앱이 죽거나 네트워크가 끊긴 경우 알림이 통째로 누락되므로 DB 에서 건다.
//
// 발송 수단:
//   구글 워크스페이스 계정 SMTP(앱 비밀번호). 새 외부 서비스 가입 없이 쓰기 위함.
//
// 필요한 시크릿:
//   GMAIL_USER          보내는 계정 (예: admin@ourmine.co.kr)
//   GMAIL_APP_PASSWORD  구글 앱 비밀번호 16자리 (공백 없이)
//   ADMIN_NOTIFY_TO     받는 주소 (미설정 시 GMAIL_USER 로 보냄)
//   ADMIN_NOTIFY_SECRET 트리거만 호출할 수 있게 하는 공유 비밀값

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const NOTIFY_TO = Deno.env.get('ADMIN_NOTIFY_TO') || GMAIL_USER;
const NOTIFY_SECRET = Deno.env.get('ADMIN_NOTIFY_SECRET') ?? '';

const ADMIN_URL = 'https://parkinon.co.kr/admin';

/** 운영자가 직접 쓴 글·댓글에는 자기 자신에게 메일을 보내지 않는다. */
const OPERATOR_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

const POST_TYPE_LABEL: Record<string, string> = {
  free: '💬 자유수다',
  question: '❓ 질문있어요',
  info: '📢 정보공유',
  exercise: '💪 운동인증',
  cheer: '🙏 응원해요',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendMail(subject: string, html: string, text: string): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    await client.send({
      from: `파킨온 알림 <${GMAIL_USER}>`,
      to: NOTIFY_TO,
      subject,
      content: text,
      html,
    });
  } finally {
    await client.close();
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error('[notify-admin-content] GMAIL_USER / GMAIL_APP_PASSWORD 미설정');
      return new Response(JSON.stringify({ error: 'mail not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    // 트리거만 호출할 수 있게 — 공유 비밀값이 설정돼 있으면 반드시 일치해야 한다.
    if (NOTIFY_SECRET && body.secret !== NOTIFY_SECRET) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const kind: 'post' | 'comment' = body.kind;
    const id: string = body.id;
    if (!kind || !id) {
      return new Response(JSON.stringify({ error: 'kind, id 가 필요합니다' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (kind === 'post') {
      const { data: post } = await supabase
        .from('posts')
        .select('id,title,content,post_type,is_notice,author_id,created_at,users:author_id(name,role)')
        .eq('id', id)
        .single();
      if (!post) return new Response(JSON.stringify({ skipped: 'post not found' }), { status: 200, headers: corsHeaders });
      // 공지·운영자 글은 본인이 쓴 것이므로 알리지 않는다.
      if (post.is_notice || post.author_id === OPERATOR_AUTHOR_ID) {
        return new Response(JSON.stringify({ skipped: 'own content' }), { status: 200, headers: corsHeaders });
      }

      const author = (post.users as { name?: string } | null)?.name ?? '알 수 없음';
      const typeLabel = POST_TYPE_LABEL[post.post_type] ?? post.post_type;
      const subject = `[파킨온] 새 글 · ${typeLabel} · ${post.title}`;
      const text = `${typeLabel}\n제목: ${post.title}\n작성자: ${author}\n\n${post.content}\n\n관리자: ${ADMIN_URL}`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;color:#222">
          <div style="color:#666;font-size:13px">${esc(typeLabel)} · 새 글</div>
          <h2 style="margin:6px 0 2px;font-size:18px">${esc(post.title)}</h2>
          <div style="color:#666;font-size:13px;margin-bottom:12px">작성자 ${esc(author)}</div>
          <div style="white-space:pre-wrap;background:#f7f7f8;border-radius:10px;padding:14px">${esc(post.content)}</div>
          <p style="margin-top:16px"><a href="${ADMIN_URL}" style="color:#2e7d32">관리자에서 열기</a></p>
        </div>`;
      await sendMail(subject, html, text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: c } = await supabase
      .from('comments')
      .select('id,content,post_id,parent_id,author_id,author_name_override,created_at,users:author_id(name),posts:post_id(title)')
      .eq('id', id)
      .single();
    if (!c) return new Response(JSON.stringify({ skipped: 'comment not found' }), { status: 200, headers: corsHeaders });
    // 운영자가 관리자 화면에서 단 댓글은 알리지 않는다.
    if (c.author_id === OPERATOR_AUTHOR_ID || c.author_name_override) {
      return new Response(JSON.stringify({ skipped: 'own content' }), { status: 200, headers: corsHeaders });
    }

    const author = (c.users as { name?: string } | null)?.name ?? '알 수 없음';
    const postTitle = (c.posts as { title?: string } | null)?.title ?? '(제목 없음)';
    const what = c.parent_id ? '새 대댓글' : '새 댓글';
    const subject = `[파킨온] ${what} · ${postTitle}`;
    const text = `${what}\n글: ${postTitle}\n작성자: ${author}\n\n${c.content}\n\n관리자: ${ADMIN_URL}`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;color:#222">
        <div style="color:#666;font-size:13px">${what}</div>
        <h2 style="margin:6px 0 2px;font-size:18px">${esc(postTitle)}</h2>
        <div style="color:#666;font-size:13px;margin-bottom:12px">작성자 ${esc(author)}</div>
        <div style="white-space:pre-wrap;background:#f7f7f8;border-radius:10px;padding:14px">${esc(c.content)}</div>
        <p style="margin-top:16px"><a href="${ADMIN_URL}" style="color:#2e7d32">관리자에서 열기</a></p>
      </div>`;
    await sendMail(subject, html, text);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[notify-admin-content] 실패:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
