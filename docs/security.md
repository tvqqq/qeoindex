# Security

## Secret handling

- Keep DNSE, Notion, Telegram, Finhay OAuth, scheduler, and infrastructure credentials in server-side environment variables.
- Never add a `NEXT_PUBLIC_` prefix to a credential. Next.js inlines those values into browser bundles.
- Commit only empty examples such as `.env.example` and `supabase/.env.example`.
- Run `pnpm scan:secrets` before committing. CI runs the same check for every pull request and push to `main`.
- The scanner reports filenames only so an accidental credential is not copied into CI logs.

## DNSE credential rotation

The DNSE API credential present before the P0 cleanup existed in Git history and must be treated as compromised:

1. Revoke or rotate the old credential in DNSE.
2. Update `DNSE_API_KEY` and `DNSE_API_SECRET` in the server environment only.
3. Redeploy the application so every server runtime uses the rotated credential.
4. Confirm the old credential is rejected and `/api/market/stream-auth` works only for an authenticated Finhay session.
5. Do not rewrite shared Git history until collaborators and deployment owners agree on the operational plan; rotation is required even if history is later rewritten.
