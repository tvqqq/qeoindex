<?php

namespace App\Market;

use GuzzleHttp\Client;
use RuntimeException;

final class SupabaseUniverse
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
        $this->http = new Client(['base_uri' => $url, 'timeout' => 10.0]);
    }

    /** @return list<string> */
    public function tickers(): array
    {
        $response = $this->http->post('/rest/v1/rpc/qeo_current_market_universe', [
            'headers' => $this->headers(),
            'json' => ['p_universe_key' => 'vn_top_stocks'],
        ]);
        $payload = json_decode((string) $response->getBody(), true);
        $stocks = is_array($payload) && isset($payload['stocks']) && is_array($payload['stocks'])
            ? $payload['stocks']
            : [];

        $tickers = [];
        foreach ($stocks as $stock) {
            $ticker = strtoupper(trim((string) ($stock['ticker'] ?? '')));
            if (preg_match('/^[A-Z0-9]{2,12}$/', $ticker) === 1) {
                $tickers[] = $ticker;
            }
        }
        $tickers = array_values(array_unique($tickers));
        if ($tickers === []) {
            throw new RuntimeException('Canonical vn_top_stocks universe is empty.');
        }

        return array_slice($tickers, 0, 200);
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        return [
            'apikey' => $this->serviceKey,
            'Authorization' => 'Bearer '.$this->serviceKey,
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];
    }
}
