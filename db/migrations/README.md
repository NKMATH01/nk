# DB 마이그레이션 규칙

## 파일명

`NNNN_설명.sql` (예: `0002_migration_tracking.sql`)

- `NNNN`은 4자리 일련번호. 기존 번호를 재사용하지 않는다.
- 한 번 커밋된 마이그레이션 파일은 수정하지 않는다. 변경이 필요하면 새 번호로 추가한다.

## 작성 규칙

- **모든 문은 멱등**이어야 한다. 재실행해도 데이터가 삭제되거나 중복되지 않아야 한다.
  - 테이블·컬럼·인덱스: `create table if not exists`, `alter table ... add column if not exists`, `create index if not exists`
  - 정책: `drop policy if exists ...` 후 `create policy ...`
  - 함수·트리거: `create or replace function`, `drop trigger if exists` 후 `create trigger`
- **`drop table` / `truncate` / `delete` 는 쓰지 않는다.** 데이터 삭제가 필요하면 별도로 협의한다.
- 각 파일 마지막에 자기 버전을 기록한다.

  ```sql
  insert into public.schema_migrations (version) values ('NNNN_설명')
  on conflict do nothing;
  ```

- 파일 상단에 목적·실행 방법·주의사항을 주석으로 남긴다.

## 실행

Supabase 대시보드 → SQL Editor에 파일 내용을 붙여넣고 수동 실행한다. 번호 순서대로 적용한다.
적용 여부는 앱의 **설정 → DB 마이그레이션 상태** 카드에서 확인한다.

## 금지

`db/legacy/` 아래 파일은 **절대 실행하지 않는다.** 상단 DROP 블록이 전체 데이터를 삭제한다.
과거 기록 보관용이며 현행 스키마의 기준이 아니다.
