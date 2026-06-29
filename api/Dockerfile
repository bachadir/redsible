# Build Stage
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o redsible redis_inventory.go

# Final Stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/redsible .

# Expose API port
EXPOSE 8080

CMD ["./redsible", "--serve", "--redis", "redis:6379"]
