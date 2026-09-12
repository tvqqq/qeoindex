<?php

namespace App\Market;

use RuntimeException;

final class DnseAuth
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $apiSecret,
    ) {
    }

    public static function fromEnvironment(): self
    {
        $apiKey = trim((string) getenv('DNSE_API_KEY'));
        $apiSecret = trim((string) getenv('DNSE_API_SECRET'));
        if ($apiKey === '' || $apiSecret === '') {
            throw new RuntimeException('DNSE_API_KEY and DNSE_API_SECRET are required.');
        }

        return new self($apiKey, $apiSecret);
    }

    /** @return array<string, string|int> */
    public function payload(): array
    {
        $timestamp = time();
        $nonce = (string) (((int) floor(microtime(true) * 1000)) * 1000 + random_int(0, 999));
        $signature = hash_hmac('sha256', "{$this->apiKey}:{$timestamp}:{$nonce}", $this->apiSecret);

        return [
            'action' => 'auth',
            'api_key' => $this->apiKey,
            'signature' => $signature,
            'timestamp' => $timestamp,
            'nonce' => $nonce,
        ];
    }
}
