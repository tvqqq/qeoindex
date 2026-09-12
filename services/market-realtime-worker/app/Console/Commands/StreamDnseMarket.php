<?php

namespace App\Console\Commands;

use App\Market\DnseAuth;
use App\Market\DnseSocket;
use App\Market\MarketFrameBuffer;
use App\Market\SupabaseRealtimeBus;
use App\Market\SupabaseUniverse;
use Illuminate\Console\Command;
use React\EventLoop\Loop;
use Throwable;

final class StreamDnseMarket extends Command
{
    protected $signature = 'market:stream';
    protected $description = 'Stream one centralized DNSE market feed into the bounded Supabase realtime bus.';

    public function handle(): int
    {
        $flushMs = (int) (getenv('MARKET_REALTIME_FLUSH_MS') ?: 1000);
        $flushMs = max(250, min($flushMs, 5000));
        $url = trim((string) getenv('DNSE_WS_URL')) ?: 'wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json';

        try {
            $auth = DnseAuth::fromEnvironment();
            $universe = new SupabaseUniverse();
            $publisher = new SupabaseRealtimeBus();
            $tickers = $universe->tickers();
        } catch (Throwable $error) {
            $this->error($error->getMessage());
            return self::FAILURE;
        }

        $this->info('QEO-175 worker starting for '.count($tickers).' canonical symbols; flush='.$flushMs.'ms');
        $buffer = new MarketFrameBuffer();
        $loop = Loop::get();
        $onFrame = static function (array $frame) use ($buffer): void {
            $buffer->push($frame);
        };

        // Keep each provider socket at or below the DNSE normalUser 200-membership budget.
        $tickSocket = new DnseSocket(
            $loop,
            $auth,
            [['name' => 'tick.G1.json', 'symbols' => $tickers]],
            $onFrame,
            $url,
            'ticks',
        );
        $indexSocket = new DnseSocket(
            $loop,
            $auth,
            [
                ['name' => 'market_index.VNINDEX.json'],
                ['name' => 'market_index.VN30.json'],
                ['name' => 'market_index.HNX.json'],
                ['name' => 'market_index.UPCOM.json'],
            ],
            $onFrame,
            $url,
            'indexes',
        );

        $tickSocket->start();
        $indexSocket->start();

        $lastSequence = 0;
        $loop->addPeriodicTimer($flushMs / 1000, function () use ($buffer, $publisher, &$lastSequence): void {
            $frames = $buffer->drain();
            if ($frames === []) {
                return;
            }
            $nextSequence = max($lastSequence + 1, (int) floor(microtime(true) * 1000));
            try {
                $publisher->publish($nextSequence, $frames);
                $lastSequence = $nextSequence;
            } catch (Throwable $error) {
                $buffer->requeue($frames);
                fwrite(STDERR, '[supabase] publish failed: '.$error->getMessage()."\n");
            }
        });

        // Canonical universe normally changes monthly; refresh in-process without a deploy.
        $loop->addPeriodicTimer(300.0, function () use ($universe, $tickSocket, &$tickers): void {
            try {
                $next = $universe->tickers();
                if ($next !== $tickers) {
                    $tickers = $next;
                    $tickSocket->replaceChannels([['name' => 'tick.G1.json', 'symbols' => $tickers]]);
                    fwrite(STDOUT, '[universe] subscription refreshed: '.count($tickers)." symbols\n");
                }
            } catch (Throwable $error) {
                fwrite(STDERR, '[universe] refresh failed: '.$error->getMessage()."\n");
            }
        });

        $loop->run();
        return self::SUCCESS;
    }
}
