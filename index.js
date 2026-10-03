// npm i express @line/bot-sdk @supabase/supabase-js   (package.json ต้องมี "type": "module")
import express from 'express';
import * as line from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';

const {
  LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET,
  SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_KEY, PORT = 3000,
} = process.env;

const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: LINE_ACCESS_TOKEN });
const blob = new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: LINE_ACCESS_TOKEN });
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const HOUSE_RE = /^\d{1,4}(\/\d{1,4})?$/; // เช่น 99 หรือ 99/12 (ปรับตามหมู่บ้าน)
const reply = (token, text) =>
  client.replyMessage({ replyToken: token, messages: [{ type: 'text', text }] });
const push = (to, text) =>
  client.pushMessage({ to, messages: [{ type: 'text', text }] });

const setStep = (uid, step) =>
  db.from('sessions').upsert({ line_user_id: uid, step, reminded: false, updated_at: new Date() });

const app = express();
app.get('/', (_req, res) => res.send('ok')); // health check

// ---------- LINE webhook ----------
app.post('/webhook', line.middleware({ channelSecret: LINE_CHANNEL_SECRET }), async (req, res) => {
  res.sendStatus(200); // ตอบ LINE ก่อนเสมอ
  for (const ev of req.body.events) {
    try { await handle(ev); } catch (e) { console.error(e); }
  }
});

async function handle(ev) {
  if (ev.type !== 'message') return;
  const uid = ev.source.userId;
  const text = ev.message.type === 'text' ? ev.message.text.trim() : '';

  const { data: member } = await db.from('members').select('*').eq('line_user_id', uid).maybeSingle();
  const { data: sess } = await db.from('sessions').select('*').eq('line_user_id', uid).maybeSingle();

  // 1) เริ่มแจ้งชำระ
  if (text === 'จ่ายค่าส่วนกลาง') {
    if (!member) {
      await setStep(uid, 'ask_house');
      return reply(ev.replyToken, 'กรุณาพิมพ์บ้านเลขที่ของคุณ (เช่น 99/12) เพื่อดำเนินการต่อค่ะ');
    }
    await setStep(uid, 'ask_slip');
    return reply(ev.replyToken, `บ้านเลขที่ ${member.house_no}\nกรุณาส่งรูปสลิปการโอนเงินได้เลยค่ะ`);
  }

  // 2) รอบ้านเลขที่ -> ไม่ตอบ/ตอบผิดรูปแบบ จะไม่ไปขั้นต่อไป
  if (sess?.step === 'ask_house') {
    if (!HOUSE_RE.test(text))
      return reply(ev.replyToken, 'รูปแบบบ้านเลขที่ไม่ถูกต้อง กรุณาพิมพ์ใหม่ เช่น 99 หรือ 99/12');
    await db.from('members').upsert({ line_user_id: uid, house_no: text });
    await setStep(uid, 'ask_slip');
    return reply(ev.replyToken, `บันทึกบ้านเลขที่ ${text} แล้วค่ะ\nกรุณาส่งรูปสลิปการโอนเงินได้เลย`);
  }

  // 3) รอสลิป -> ข้อมูลครบเมื่อได้รูป
  if (sess?.step === 'ask_slip') {
    if (ev.message.type !== 'image')
      return reply(ev.replyToken, 'กรุณาส่งเป็น "รูปสลิป" ค่ะ');

    const stream = await blob.getMessageContent(ev.message.id);
    const chunks = []; for await (const c of stream) chunks.push(c);
    const path = `${uid}/${Date.now()}.jpg`;
    const up = await db.storage.from('slips').upload(path, Buffer.concat(chunks), { contentType: 'image/jpeg' });
    if (up.error) throw up.error;

    const m = member ?? (await db.from('members').select('*').eq('line_user_id', uid).single()).data;
    await db.from('payments').insert({ line_user_id: uid, house_no: m.house_no, slip_url: path });
    await db.from('sessions').delete().eq('line_user_id', uid);
    return reply(ev.replyToken, `รับข้อมูลครบแล้วค่ะ\nบ้านเลขที่ ${m.house_no}\nสถานะ: รอดำเนินการ รอออกใบเสร็จ`);
  }
}

// ---------- หลังบ้าน (ป้องกันด้วย ADMIN_KEY) ----------
const admin = (req, res, next) =>
  req.headers['x-admin-key'] === ADMIN_KEY ? next() : res.sendStatus(401);

// ดูรายการที่รอออกใบเสร็จ
app.get('/admin/payments', admin, async (req, res) => {
  const { data } = await db.from('payments').select('*')
    .eq('status', req.query.status ?? 'pending_receipt').order('created_at');
  res.json(data);
});

// ออกใบเสร็จแล้ว -> แจ้งลูกบ้าน
app.post('/admin/payments/:id/issue', admin, async (req, res) => {
  const { data } = await db.from('payments')
    .update({ status: 'receipt_issued', issued_at: new Date() })
    .eq('id', req.params.id).select().single();
  await push(data.line_user_id, `ออกใบเสร็จค่าส่วนกลางบ้านเลขที่ ${data.house_no} เรียบร้อยแล้วค่ะ`);
  res.json(data);
});

// ตามคนที่ยังกรอกไม่ครบเกิน 24 ชม. (ให้ cron-job.org เรียกวันละครั้ง)
app.get('/cron/remind', admin, async (req, res) => {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db.from('sessions').select('*').lt('updated_at', cutoff).eq('reminded', false);
  for (const s of data ?? []) {
    const msg = s.step === 'ask_house'
      ? 'ยังไม่ได้รับบ้านเลขที่ค่ะ กรุณาพิมพ์บ้านเลขที่เพื่อดำเนินการจ่ายค่าส่วนกลางต่อ'
      : 'ยังไม่ได้รับสลิปการโอนค่ะ กรุณาส่งรูปสลิปเพื่อดำเนินการต่อ';
    await push(s.line_user_id, msg);
    await db.from('sessions').update({ reminded: true }).eq('line_user_id', s.line_user_id);
  }
  res.json({ reminded: data?.length ?? 0 });
});

app.listen(PORT, () => console.log('running on', PORT));
