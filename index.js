// ส่งรูปสลิปมา -> ตอบกลับว่ากำลังดำเนินการ
import express from 'express';
import * as line from '@line/bot-sdk';
 
const { LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET, PORT = 3000 } = process.env;
 
const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: LINE_ACCESS_TOKEN });
const app = express();
 
app.get('/', (_req, res) => res.send('ok')); // health check
 
app.post('/webhook', line.middleware({ channelSecret: LINE_CHANNEL_SECRET }), async (req, res) => {
  res.sendStatus(200);
  for (const ev of req.body.events) {
    if (ev.type === 'message' && ev.message.type === 'image') {
      try {
        await client.replyMessage({
          replyToken: ev.replyToken,
          messages: [{ type: 'text', text: 'กรุณารอเจ้าหน้าที่ตอบกลับ' }],
        });
      } catch (e) { console.error(e); }
    }
  }
});
 
app.listen(PORT, () => console.log('running on', PORT));
