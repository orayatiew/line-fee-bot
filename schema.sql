-- รันใน Supabase > SQL Editor

-- ข้อมูลลูกบ้าน (จำบ้านเลขที่ไว้ ไม่ต้องถามซ้ำ)
create table members (
  line_user_id text primary key,
  house_no     text not null,
  created_at   timestamptz default now()
);

-- สถานะการสนทนาที่ยังกรอกไม่ครบ
create table sessions (
  line_user_id text primary key,
  step         text not null,          -- ask_house | ask_slip
  slip_url     text,                   -- รูปที่ส่งมาก่อนแจ้งบ้านเลขที่
  reminded     boolean default false,  -- เตือนแล้วหรือยัง
  updated_at   timestamptz default now()
);

-- รายการแจ้งชำระ
create table payments (
  id           bigint generated always as identity primary key,
  line_user_id text not null,
  house_no     text not null,
  slip_url     text not null,
  status       text not null default 'pending_receipt', -- pending_receipt | receipt_issued
  created_at   timestamptz default now(),
  issued_at    timestamptz
);

-- สร้าง Storage bucket ชื่อ "slips" (ตั้งเป็น private) ที่เมนู Storage
