<?php

namespace App\Market;

final class MarketFrameBuffer
{
    private const MAX_PAYLOAD_BYTES = 524288;

    /** @var array<string, array<string, mixed>> */
    private array $frames = [];

    /** @param array<string, mixed> $frame */
    public function push(array $frame): void
    {
        $type = trim((string) ($frame['T'] ?? ''));
        $symbol = strtoupper(trim((string) ($frame['symbol'] ?? $frame['indexName'] ?? '')));
        if ($type === '' || $symbol === '') {
            return;
        }
        if (!in_array($type, ['t', 'mi'], true)) {
            return;
        }

        $this->frames["{$type}:{$symbol}"] = $frame;
        $this->trimToPayloadBudget();
    }

    /** @return list<array<string, mixed>> */
    public function drain(): array
    {
        $frames = array_values($this->frames);
        $this->frames = [];
        return $frames;
    }

    /** @param list<array<string, mixed>> $frames */
    public function requeue(array $frames): void
    {
        foreach ($frames as $frame) {
            $this->push($frame);
        }
    }

    private function trimToPayloadBudget(): void
    {
        while (count($this->frames) > 1) {
            $json = json_encode(array_values($this->frames), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json !== false && strlen($json) <= self::MAX_PAYLOAD_BYTES) {
                return;
            }
            array_shift($this->frames);
        }
    }
}
