# Portfolio Risk Sizing

Pure deterministic QEO-139 domain for stop-first Trade Size calculations.

- Accounting inputs remain kVND where they originate from the portfolio engine.
- Calculator money values are full VND.
- `Slippage Allowance` is an explicit QeoIndex safety extension to McDowell's printed Trade Size formula.
- `DEFAULT_REGULAR_LOT_SHARES = 100` is a QeoIndex calculator convention and remains injectable.
