begin;

alter table public.market_research_reports
  add column if not exists summary_image_status text not null default 'pending'
    check (summary_image_status in ('pending', 'generating', 'ready', 'failed')),
  add column if not exists summary_image_path text,
  add column if not exists summary_image_analysis_id uuid references public.market_research_report_analyses(id) on delete set null,
  add column if not exists summary_image_generated_at timestamptz,
  add column if not exists summary_image_error text;

comment on column public.market_research_reports.summary_image_status is
  'Lifecycle for the AI-generated landscape A4 research summary image.';
comment on column public.market_research_reports.summary_image_path is
  'Private Supabase Storage object path for the generated research summary image.';

create index if not exists market_research_reports_summary_image_status_idx
  on public.market_research_reports(summary_image_status, publish_date desc, id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'research-report-images',
  'research-report-images',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
