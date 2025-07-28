<?php

require_once __DIR__ . '/vendor/autoload.php';

use GuzzleHttp\Client;
use GuzzleHttp\Promise\Utils;
use GuzzleHttp\Exception\RequestException;

$config = ["routers" => []];
$configFile = __DIR__ . "/config.json";

try {
    if (file_exists($configFile)) {
        $jsonString = file_get_contents($configFile);
        $decodedConfig = json_decode($jsonString, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $config = $decodedConfig;
        }
    }
} catch (Throwable $e) {
}

if (!function_exists('parseUptime')) {
    function parseUptime(string $data): ?int {
        $trimmedData = trim($data);

        foreach (explode("\n", $trimmedData) as $i => $line) {
            if (preg_match("/^===\s+uptime\s+router\d+\s+===/", trim($line))) {
                $lines = explode("\n", $trimmedData);
                if (isset($lines[$i + 1])) {
                    $uptimeLine = trim($lines[$i + 1]);
                    $parts = explode(' ', $uptimeLine);
                    if (isset($parts[0]) && is_numeric($parts[0])) {
                        return (int) floor((float) $parts[0]);
                    }
                }
            }
        }

        $parts = explode(' ', $trimmedData);
        if (isset($parts[0]) && is_numeric($parts[0])) {
            return (int) floor((float) $parts[0]);
        }

        if (preg_match("/up\s+((?:\d+\s+day(?:s)?,\s+)?(\d+):(\d+)(?::(\d+))?)/", $trimmedData, $matches)) {
            $days = 0;
            $hours = (int) $matches[2];
            $minutes = (int) $matches[3];
            $seconds = (int) ($matches[4] ?? 0);

            if (strpos($matches[1], 'day') !== false) {
                preg_match('/\d+/', $matches[1], $dayMatches);
                $days = (int) ($dayMatches[0] ?? 0);
            }

            return ($days * 24 * 3600) + ($hours * 3600) + ($minutes * 60) + $seconds;
        }

        return null;
    }
}

if (!function_exists('parseSsidsClients')) {
    function parseSsidsClients(string $data): array {
        $ssids = [];
        $clients = [];
        $lines = explode("\n", $data);
        $i = 0;

        while ($i < count($lines)) {
            $line = trim($lines[$i]);

            if (preg_match("/^Interface\s+(\S+)/", $line, $ifaceMatches)) {
                $ifaceName = $ifaceMatches[1];
                for ($j = $i + 1; $j < min($i + 5, count($lines)); $j++) {
                    if (preg_match("/^ssid\s+(\S+)/", trim($lines[$j]), $ssidMatches)) {
                        $ssids[$ifaceName] = $ssidMatches[1];
                        break;
                    }
                }
                $i++;
                continue;
            }

            if (preg_match("/^Station\s+([0-9a-fA-F:]{17})\s+\(on\s+(\S+)\)/", $line, $stationMatches)) {
                $mac = strtolower($stationMatches[1]);
                $iface = $stationMatches[2];
                $clientInfo = ["mac" => $mac, "interface" => $iface];
                $j = $i + 1;

                while ($j < count($lines)) {
                    $nextLine = trim($lines[$j]);
                    if (preg_match("/^Station\s+([0-9a-fA-F:]{17})/", $nextLine) ||
                        preg_match("/^Interface\s+(\S+)/", $nextLine) ||
                        preg_match("/^phy#\d+/", $nextLine)) {
                        break;
                    }

                    if (preg_match("/^rx bytes:\s+(\d+)/", $nextLine, $rxMatches)) {
                        $clientInfo["rx_bytes"] = (int) $rxMatches[1];
                    }
                    if (preg_match("/^tx bytes:\s+(\d+)/", $nextLine, $txMatches)) {
                        $clientInfo["tx_bytes"] = (int) $txMatches[1];
                    }
                    if (preg_match("/^connected time:\s+(\d+)\s+seconds/", $nextLine, $connTimeMatches)) {
                        $clientInfo["connected_time"] = (int) $connTimeMatches[1];
                    }
                    $j++;
                }
                $clients[] = $clientInfo;
                $i = $j - 1;
            }
            $i++;
        }
        return [$ssids, $clients];
    }
}

if (!function_exists('parseDhcp')) {
    function parseDhcp(string $data): array {
        $dhcpInfo = [];
        $lines = explode("\n", $data);
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', trim($line));
            if (count($parts) >= 4) {
                $mac = strtolower($parts[1]);
                $ip = $parts[2];
                $hostname = $parts[3];
                $entry = ["ip" => $ip];
                if ($hostname !== '*') {
                    $entry["hostname"] = $hostname;
                }
                $dhcpInfo[$mac] = $entry;
            }
        }
        return $dhcpInfo;
    }
}

if (!function_exists('openwrtStatsEndpoint')) {
    function openwrtStatsEndpoint(array $config) {
        $uptimes = [];
        $clientsBySsid = [];
        $identifiedSsids = [];
        $dhcpLeases = [];
        $client = new Client();

        $requests = [];
        $routerDataMap = [];
        $dhcpData = null;

        $router1DhcpUrl = null;
        foreach ($config["routers"] as $routerConf) {
            if (($routerConf["id"] ?? null) === "router1" && isset($routerConf["dhcp_url"])) {
                $router1DhcpUrl = $routerConf["dhcp_url"];
                break;
            }
        }

        if ($router1DhcpUrl) {
            $requests['router1_dhcp'] = $client->getAsync($router1DhcpUrl, ['timeout' => 5])->then(
                function ($response) {
                    return (string)$response->getBody();
                },
                function (RequestException $e) {
                    return null;
                }
            );
        }

        foreach ($config["routers"] as $routerConf) {
            $routerId = $routerConf["id"] ?? null;
            $infoUrl = $routerConf["info_url"] ?? null;

            if (!$routerId || !$infoUrl) {
                continue;
            }

            $requests[$routerId] = $client->getAsync($infoUrl, ['timeout' => 5])->then(
                function ($response) {
                    return (string)$response->getBody();
                },
                function (RequestException $e) use ($routerId) {
                    return null;
                }
            );
        }

        $results = Utils::settle($requests)->wait();

        if (isset($results['router1_dhcp']) && $results['router1_dhcp']['state'] === 'fulfilled' && $results['router1_dhcp']['value'] !== null) {
            $dhcpData = $results['router1_dhcp']['value'];
        }

        if ($dhcpData !== null) {
            $dhcpLeases = parseDhcp($dhcpData);
        }

        foreach ($config["routers"] as $routerConf) {
            $routerId = $routerConf["id"] ?? null;
            if (!$routerId) continue;

            $routerData = null;
            if (isset($results[$routerId]) && $results[$routerId]['state'] === 'fulfilled' && $results[$routerId]['value'] !== null) {
                $routerData = $results[$routerId]['value'];
            }

            if (empty($routerData)) {
                continue;
            }

            $rawUptimeSeconds = parseUptime($routerData);
            $uptimes["{$routerId} uptime"] = (string)($rawUptimeSeconds ?? 'N/A');

            list($ssids, $clients) = parseSsidsClients($routerData);

            foreach ($ssids as $ssidValue) {
                $identifiedSsids[] = str_replace(" ", "_", strtolower($ssidValue));
            }

            foreach ($clients as $client) {
                $ssidKey = str_replace(" ", "_", strtolower($ssids[$client["interface"]] ?? "unknown_ssid"));

                $hostname = $dhcpLeases[$client["mac"]]["hostname"] ?? ($dhcpLeases[$client["mac"]]["ip"] ?? $client["mac"]);

                $clientsBySsid[$ssidKey][] = [
                    "hostname" => $hostname,
                    "rx/tx" => (string)($client["rx_bytes"] ?? 'N/A') . "/" . (string)($client["tx_bytes"] ?? 'N/A'),
                    "uptime" => (string)($client["connected_time"] ?? 'N/A')
                ];
            }
        }

        $finalOutput = array_merge([], $uptimes);

        $allSsids = array_unique(array_merge($identifiedSsids, array_keys($clientsBySsid)));
        sort($allSsids);

        foreach ($allSsids as $ssidKey) {
            $finalOutput[$ssidKey] = (string)count($clientsBySsid[$ssidKey] ?? []);
        }

        if (isset($clientsBySsid["unknown_ssid"])) {
            $finalOutput["unknown_ssid"] = (string)count($clientsBySsid["unknown_ssid"]);
        }

        $totalClients = 0;
        foreach ($clientsBySsid as $clients) {
            $totalClients += count($clients);
        }
        $finalOutput["total clients"] = (string)$totalClients;

        $sortedClientsData = [];
        foreach ($allSsids as $ssidKey) {
            $sortedClientsData[$ssidKey] = $clientsBySsid[$ssidKey] ?? [];
        }
        $finalOutput["clients"] = $sortedClientsData;

        header('Content-Type: application/json');
        echo json_encode($finalOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

if (isset($_SERVER['REQUEST_URI']) && $_SERVER['REQUEST_URI'] === '/api/openwrt') {
    openwrtStatsEndpoint($config);
} else {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Not Found', 'message' => 'The requested URL was not found on this server.']);
    exit;
}

?>
