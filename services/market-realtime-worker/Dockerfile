FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/market-realtime-worker ./cmd/market-realtime-worker

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app app
COPY --from=build /out/market-realtime-worker /usr/local/bin/market-realtime-worker
USER app:app
ENTRYPOINT ["/usr/local/bin/market-realtime-worker"]
