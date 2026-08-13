# Finhay Live Adapter

StockOS keeps research state and historical scanner state separate from live market state.

## Runtime model

- Research state: canonical Notion databases.
- Historical Daily scanner: DNSE when available, Yahoo Finance `.VN` fallback with explicit provider provenance.
- Live market state: Finhay Remote MCP after the StockOS user completes FHSC OAuth.

## Security

- OAuth 2.1 / PKCE flow.
- Access and refresh tokens are stored only in secure HTTP-only cookies.
- No `NEXT_PUBLIC_*` token or market credential is used.
- StockOS requests only read-only market tools in this adapter.
- The ChatGPT Finhay connector session is not reused by StockOS.

## UI states

- `AUTH_REQUIRED`: StockOS has no Finhay OAuth session; user can connect.
- `LIVE`: OAuth is valid and a HOSE session probe succeeds.
- `ERROR`: an OAuth session exists but the MCP probe failed; reconnect is offered.

Research overview polls MSN + VNINDEX every 15 seconds after connection. Ticker detail polls the selected ticker. Scanner shows Finhay connection status only; technical indicator rows remain tied to the timestamped Daily scan rather than silently mixing intraday prices into Daily indicator calculations.
