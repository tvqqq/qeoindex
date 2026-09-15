package worker

import (
	"strings"
	"sync"
)

type orderbookRelayState struct {
	mu            sync.Mutex
	universe      map[string]struct{}
	sequences     map[string]int64
	continuityGap map[string]bool
}

func newOrderbookRelayState(symbols []string) *orderbookRelayState {
	state := &orderbookRelayState{
		universe:      map[string]struct{}{},
		sequences:     map[string]int64{},
		continuityGap: map[string]bool{},
	}
	state.SetUniverse(symbols)
	return state
}

func (s *orderbookRelayState) SetUniverse(symbols []string) {
	next := make(map[string]struct{}, len(symbols))
	for _, raw := range symbols {
		symbol := strings.ToUpper(strings.TrimSpace(raw))
		if symbol != "" {
			next[symbol] = struct{}{}
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for symbol := range s.universe {
		if _, exists := next[symbol]; exists {
			continue
		}
		delete(s.sequences, symbol)
		delete(s.continuityGap, symbol)
	}
	for symbol := range next {
		if _, exists := s.universe[symbol]; !exists {
			s.continuityGap[symbol] = true
		}
	}
	s.universe = next
}

func (s *orderbookRelayState) MarkContinuityGapAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for symbol := range s.universe {
		s.continuityGap[symbol] = true
	}
}

func (s *orderbookRelayState) Next(rawSymbol string) (sequence int64, continuityGap bool, ok bool) {
	symbol := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if symbol == "" {
		return 0, false, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.universe[symbol]; !exists {
		return 0, false, false
	}
	s.sequences[symbol]++
	sequence = s.sequences[symbol]
	continuityGap = s.continuityGap[symbol]
	delete(s.continuityGap, symbol)
	return sequence, continuityGap, true
}
