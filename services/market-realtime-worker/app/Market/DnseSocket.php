<?php

namespace App\Market;

use Closure;
use Ratchet\Client\Connector;
use Ratchet\Client\WebSocket;
use React\EventLoop\LoopInterface;
use React\EventLoop\TimerInterface;
use Throwable;

final class DnseSocket
{
    private ?WebSocket $connection = null;
    private ?TimerInterface $reconnectTimer = null;
    private ?TimerInterface $pingTimer = null;
    private int $attempt = 0;

    /** @param list<array{name:string,symbols?:list<string>}> $channels */
    public function __construct(
        private readonly LoopInterface $loop,
        private readonly DnseAuth $auth,
        private array $channels,
        private readonly Closure $onFrame,
        private readonly string $url,
        private readonly string $name,
    ) {
    }

    public function start(): void
    {
        $this->connect();
    }

    /** @param list<array{name:string,symbols?:list<string>}> $channels */
    public function replaceChannels(array $channels): void
    {
        if ($channels === $this->channels) {
            return;
        }
        $this->channels = $channels;
        if ($this->connection !== null) {
            $this->connection->close();
            return;
        }
        $this->scheduleReconnect(0.1);
    }

    private function connect(): void
    {
        if ($this->reconnectTimer !== null) {
            $this->loop->cancelTimer($this->reconnectTimer);
            $this->reconnectTimer = null;
        }

        $connector = new Connector($this->loop);
        $connector($this->url)->then(
            function (WebSocket $connection): void {
                $this->connection = $connection;
                $this->attempt = 0;
                $connection->on('message', function ($message): void {
                    $this->handleMessage((string) $message);
                });
                $connection->on('close', function (): void {
                    $this->stopPing();
                    $this->connection = null;
                    $this->scheduleReconnect();
                });
                $connection->on('error', function (): void {
                    $connection = $this->connection;
                    if ($connection !== null) {
                        $connection->close();
                    }
                });
            },
            function (Throwable $error): void {
                fwrite(STDERR, "[{$this->name}] connect failed: {$error->getMessage()}\n");
                $this->connection = null;
                $this->scheduleReconnect();
            },
        );
    }

    private function handleMessage(string $raw): void
    {
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return;
        }
        $action = (string) ($data['action'] ?? $data['a'] ?? '');
        if ($action === 'ping') {
            $this->send(['action' => 'pong', 'timestamp' => $data['timestamp'] ?? null]);
            return;
        }
        if ($action === 'welcome' || isset($data['session_id']) || isset($data['sid'])) {
            $this->send($this->auth->payload());
            return;
        }
        if ($action === 'auth_success') {
            $this->send(['action' => 'subscribe', 'channels' => $this->channels]);
            $this->startPing();
            fwrite(STDOUT, "[{$this->name}] subscribed\n");
            return;
        }
        if ($action === 'auth_error' || $action === 'error') {
            fwrite(STDERR, "[{$this->name}] DNSE error: ".($data['message'] ?? $data['msg'] ?? 'unknown')."\n");
            $this->connection?->close();
            return;
        }
        if (isset($data['T'])) {
            ($this->onFrame)($data);
        }
    }

    /** @param array<string, mixed> $payload */
    private function send(array $payload): void
    {
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded !== false && $this->connection !== null) {
            $this->connection->send($encoded);
        }
    }

    private function startPing(): void
    {
        $this->stopPing();
        $this->pingTimer = $this->loop->addPeriodicTimer(15.0, function (): void {
            $this->send(['action' => 'ping', 'timestamp' => (int) floor(microtime(true) * 1000)]);
        });
    }

    private function stopPing(): void
    {
        if ($this->pingTimer !== null) {
            $this->loop->cancelTimer($this->pingTimer);
            $this->pingTimer = null;
        }
    }

    private function scheduleReconnect(?float $overrideDelay = null): void
    {
        if ($this->reconnectTimer !== null) {
            return;
        }
        $this->attempt++;
        $base = min(0.75 * (2 ** min(max($this->attempt - 1, 0), 4)), 10.0);
        $delay = $overrideDelay ?? ($base + random_int(0, 500) / 1000);
        $this->reconnectTimer = $this->loop->addTimer($delay, function (): void {
            $this->reconnectTimer = null;
            $this->connect();
        });
    }
}
