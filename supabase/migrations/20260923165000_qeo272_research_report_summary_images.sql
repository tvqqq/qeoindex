alter table public.market_research_reports
  add column if not exists summary_image_status text not null default 'pending',
  add column if not exists summary_image_url text,
  add column if not exists summary_image_content_hash text,
  add column if not exists summary_image_prompt_version text,
  add column if not exists summary_image_generated_at timestamptz,
  add column if not exists summary_image_error text;

alter table public.market_research_reports
  drop constraint if exists market_research_reports_summary_image_status_check;

alter table public.market_research_reports
  add constraint market_research_reports_summary_image_status_check
  check (summary_image_status in ('pending', 'generating', 'ready', 'failed'));

alter table public.market_research_reports
  drop constraint if exists market_research_reports_summary_image_content_hash_check;

alter table public.market_research_reports
  add constraint market_research_reports_summary_image_content_hash_check
  check (summary_image_content_hash is null or summary_image_content_hash ~ '^[0-9a-f]{64}$');

comment on column public.market_research_reports.summary_image_status is
  'Best-effort AI landscape research-summary image lifecycle. Failure never invalidates canonical report analysis.';
comment on column public.market_research_reports.summary_image_url is
  'Generated report-summary image URL returned by the configured image creator.';
comment on column public.market_research_reports.summary_image_content_hash is
  'Report content hash used to generate summary_image_url; stale images are not shown for a different current hash.';
comment on column public.market_research_reports.summary_image_prompt_version is
  'Prompt-template version used for the generated research-summary image.';
comment on column public.market_research_reports.summary_image_error is
  'Sanitized bounded secondary image-generation error; never canonical report-analysis state.';
