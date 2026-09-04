import {
  handleWatchlistDelete,
  handleWatchlistGet,
  handleWatchlistPost,
} from "@/modules/portfolio/watchlist/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handleWatchlistGet
export const POST = handleWatchlistPost
export const DELETE = handleWatchlistDelete
