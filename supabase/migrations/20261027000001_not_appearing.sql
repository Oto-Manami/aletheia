-- 出演の状態から休演（absent）をなくし、出なかったことを not_appearing にまとめる（設計書 決定記録 0020）
--
-- 休演・欠席・その回の企画に入っていない、を区別しない。理由は記録しない。
-- 状態は scheduled（予定）/ appeared（出演した）/ not_appearing（出ていない）/ cancelled（中止）

update public.event_participants set status = 'not_appearing' where status = 'absent';

alter table public.event_participants
  drop constraint event_participants_status_check,
  add constraint event_participants_status_check
    check (status in ('scheduled', 'appeared', 'not_appearing', 'cancelled'));

comment on column public.event_participants.status is
  '出演の状態: scheduled 予定・appeared 出演した・not_appearing 出ていない（休演を含む）・cancelled 中止';
