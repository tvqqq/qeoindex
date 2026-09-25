import {
  handleWatchlistDelete,
  handleWatchlistGet,
  handleWatchlistPatch,
  handleWatchlistPost,
  handleWatchlistPut,
} from "@/modules/portfolio/watchlist/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handleWatchlistGet
export const POST = handleWatchlistPost
export const PUT = handleWatchlistPut
export const PATCH = handleWatchlistPatch
export const DELETE = handleWatchlistDelete
