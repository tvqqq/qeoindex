package worker

import (
	"strings"

	"github.com/tvqqq/qeoindex/services/market-realtime-worker/internal/realtime"
)

type marketFrameRouter struct {
	checkpoint *realtime.Buffer
	market     *realtime.Buffer
	orderbook  *realtime.OrderbookBuffer
	context    *contextSnapshotBuffer
}

func newMarketFrameRouter(checkpoint, market *realtime.Buffer, orderbook *realtime.OrderbookBuffer, context *contextSnapshotBuffer) *marketFrameRouter {
	return &marketFrameRouter{checkpoint: checkpoint, market: market, orderbook: orderbook, context: context}
}

func (r *marketFrameRouter) OnBoardFrame(frame map[string]any) {
	r.pushMarket(stampOrderbookFrame(frame))
}

func (r *marketFrameRouter) OnTickFrame(frame map[string]any) {
	stamped := stampOrderbookFrame(frame)
	r.pushMarket(stamped)
	r.orderbook.Push(stamped)
}

func (r *marketFrameRouter) OnOrderbookFrame(frame map[string]any) {
	stamped := stampOrderbookFrame(frame)
	typ, _ := stamped["T"].(string)
	if strings.TrimSpace(typ) == "f" {
		r.pushMarket(stamped)
	}
	r.orderbook.Push(stamped)
}

func (r *marketFrameRouter) PushIndexImpact(frame map[string]any) {
	r.pushMarket(stampOrderbookFrame(frame))
}

func (r *marketFrameRouter) pushMarket(frame realtime.Frame) {
	typ, _ := frame["T"].(string)
	if typ == "f" || typ == "index-impact" {
		if !r.context.Accepts(frame) {
			return
		}
		if !r.context.Push(frame) {
			r.checkpoint.Push(frame)
		}
	} else {
		r.checkpoint.Push(frame)
	}
	r.market.Push(frame)
}
