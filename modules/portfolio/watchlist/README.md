# Watchlist module

- `server.ts` is the server-only public boundary for watchlist auth, validation, and Supabase CRUD.
- `app/api/watchlist/route.ts` is a thin HTTP adapter over this module.
- Client components must not import `server.ts` directly.
