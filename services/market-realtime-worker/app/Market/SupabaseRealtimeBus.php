<?php

namespace App\Market;

use GuzzleHttp\Client;
use RuntimeException;

final class SupabaseRealtimeBus
{
    private Client $http;
    private string $serviceKey;

    public function __construct()
    {
        $url = rtrim(trim((string) getenv('SUPABASE_URL')), '/');
        $this->serviceKey = trim((string) getenv('SUPABASE_SERVICE_ROLE_KEY'));
        if ($url === '' || $this->serviceKey === '') {
            throw new RuntimeException('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
        }
        $this->http = new Client(['base_uri' => $url, 'timeout' => 5.0]);
    }

    /** @param list<array<string, mixed>> $frames */
    public function publish(int $sequence, array $frames): void
    {
        if ($frames === []) {
            return;
        }
        $now = gmdate('c');
        $this->http->post('/rest/v1/market_realtime_bus?on_conflict=stream', [
            'headers' => [
                'apikey' => $this->serviceKey,
                'Authorization' => 'Bearer '.$this->serviceKey,
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
                'Prefer' => 'resolution=merge-duplicates,return=minimal',
            ],
            'json' => [
                'stream' => 'dnse-market',
                'sequence' => $sequence,
                'provider' => 'DNSE',
                'frames' => $frames,
                'source_updated_at' => $now,
                'updated_at' => $now,
            ],
        ]);
    }
}
