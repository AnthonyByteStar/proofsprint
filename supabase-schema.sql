create table if not exists public.sprints (
  id text primary key,
  product_name text not null check (char_length(product_name) between 2 and 80),
  product_url text not null,
  audience text not null check (char_length(audience) between 8 and 180),
  goal text not null check (goal in ('clarity', 'value', 'confidence', 'onboarding', 'pricing')),
  signals text[] not null default '{}',
  hypothesis text not null check (char_length(hypothesis) between 16 and 320),
  task text not null check (char_length(task) between 16 and 320),
  created_at timestamptz not null default now()
);

create table if not exists public.responses (
  id text primary key,
  sprint_id text not null references public.sprints(id) on delete cascade,
  tester_name text,
  intent text not null check (intent in ('Yes', 'Maybe', 'No')),
  clarity int not null check (clarity between 1 and 5),
  value int not null check (value between 1 and 5),
  confidence int not null check (confidence between 1 and 5),
  friction int not null check (friction between 1 and 5),
  understood text not null check (char_length(understood) >= 8),
  confusion text not null check (char_length(confusion) >= 8),
  improvement text not null check (char_length(improvement) >= 8),
  created_at timestamptz not null default now()
);

alter table public.sprints enable row level security;
alter table public.responses enable row level security;

grant select, insert on table public.sprints to anon;
grant select, insert on table public.responses to anon;

drop policy if exists "Anyone can create sprints" on public.sprints;
drop policy if exists "Anyone can read sprints" on public.sprints;
drop policy if exists "Anyone can submit responses" on public.responses;
drop policy if exists "Anyone can read responses" on public.responses;

create policy "Anyone can create sprints"
on public.sprints
for insert
to anon
with check (true);

create policy "Anyone can read sprints"
on public.sprints
for select
to anon
using (true);

create policy "Anyone can submit responses"
on public.responses
for insert
to anon
with check (true);

create policy "Anyone can read responses"
on public.responses
for select
to anon
using (true);
