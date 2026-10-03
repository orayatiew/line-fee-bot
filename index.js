// ตอบเมื่อได้รับรูป "หลังจาก" ที่ลูกบ้านเคยพิมพ์ข้อความชำระค่าส่วนกลาง (ไม่ต้องติดกัน)
import express from 'express';
import * as line from '@line/bot-sdk';

const { LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET, PORT = 3000 } = process.env;

// ---------- ตั้งค่า ----------
const TRIGGERS = ['ชำระค่าส่วนกลางออนไลน์', 'ชำระค่าส่วนกลางเงินสด']; // เทียบแบบไม่สนช่องว่าง
const TTL_HOURS = 24;          // ข้อความนำหน้ามีผลกี่ชั่วโมง
const ONE_REPLY_PER_TRIGGER = true; // true = ตอบรูปแรกครั้งเดียวต่อ 1 ข้อความนำ
const REPLY_MESSAGES = [
  { type: 'text', text: 'ถ้ายังไม่ได้แจ้งข้อมูล ชื่อ / บ้านเลขที่ / เดือนที่จ่าย รบกวนแจ้งข้อมูลให้หน่อยนะครับ' },
  { type: 'text', text: 'ถ้าแจ้งข้อมูลครบเรียบร้อยแล้ว' },
  { type: 'text', text: 'กรุณารอเจ้าหน้าที่ทำการตรวจสอบและตอบกลับนะครับ' },
];
// ------------------------------

const OTHER_IMAGE_REPLY = [
  { type: 'text', text: 'กรุณารอเจ้าหน้าที่ตอบกลับสักครู่นะครับ' },
]; // ตอบเมื่อส่งรูปโดยไม่ได้อยู่หลังข้อความชำระค่าส่วนกลาง

const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: LINE_ACCESS_TOKEN });
const armed = new Map(); // userId -> เวลาที่ส่งข้อความนำ (เก็บในหน่วยความจำ)

const isTrigger = (text) => {
  const t = text.replace(/\s+/g, '');
  return TRIGGERS.some((k) => t.includes(k));
};
const isArmed = (uid) => {
  const at = armed.get(uid);
  if (!at) return false;
  if (Date.now() - at > TTL_HOURS * 3600 * 1000) { armed.delete(uid); return false; }
  return true;
};

const app = express();
app.get('/', (_req, res) => res.send('ok')); // health check

app.post('/webhook', line.middleware({ channelSecret: LINE_CHANNEL_SECRET }), async (req, res) => {
  res.sendStatus(200);
  for (const ev of req.body.events) {
    if (ev.type !== 'message') continue;
    const uid = ev.source?.userId;
    if (!uid) continue;

    // 1) ลูกบ้านพิมพ์ข้อความนำ -> จำไว้
    if (ev.message.type === 'text' && isTrigger(ev.message.text)) {
      armed.set(uid, Date.now());
      continue;
    }

    // 2) ลูกบ้านส่งรูป
    if (ev.message.type === 'image') {
      try {
        if (isArmed(uid)) {
          // เคยพิมพ์ข้อความนำก่อนหน้า -> ตอบชุดชำระค่าส่วนกลาง
          await client.replyMessage({ replyToken: ev.replyToken, messages: REPLY_MESSAGES });
          if (ONE_REPLY_PER_TRIGGER) armed.delete(uid);
        } else {
          // รูปในบริบทอื่น
          await client.replyMessage({ replyToken: ev.replyToken, messages: OTHER_IMAGE_REPLY });
        }
      } catch (e) { console.error(e); }
    }
  }
});

app.listen(PORT, () => console.log('running on', PORT));
