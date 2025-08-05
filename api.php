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
    // Log the error if config.json cannot be read or decoded
    error_log("Error reading or decoding config.json: " . $e->getMessage());
}

if (!function_exists('parseUptime')) {
    function parseUptime(string $data): ?int {
        $trimmedData = trim($data);

        // Attempt to parse uptime from lines starting with "=== uptime routerX ==="
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

        // Attempt to parse uptime if it's just a number at the beginning
        $parts = explode(' ', $trimmedData);
        if (isset($parts[0]) && is_numeric($parts[0])) {
            return (int) floor((float) $parts[0]);
        }

        // Attempt to parse uptime in "days, HH:MM:SS" format
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

            // Parse SSID information
            if (preg_match("/^Interface\s+(\S+)/", $line, $ifaceMatches)) {
                $ifaceName = $ifaceMatches[1];
                // Look for ssid line within the next few lines
                for ($j = $i + 1; $j < min($i + 5, count($lines)); $j++) {
                    if (preg_match("/^ssid\s+(\S+)/", trim($lines[$j]), $ssidMatches)) {
                        $ssids[$ifaceName] = $ssidMatches[1];
                        break;
                    }
                }
                $i++; // Move to the next line after interface
                continue;
            }

            // Parse client (station) information
            if (preg_match("/^Station\s+([0-9a-fA-F:]{17})\s+\(on\s+(\S+)\)/", $line, $stationMatches)) {
                $mac = strtolower($stationMatches[1]);
                $iface = $stationMatches[2];
                $clientInfo = ["mac" => $mac, "interface" => $iface];
                $j = $i + 1;

                // Loop through subsequent lines to extract client details
                while ($j < count($lines)) {
                    $nextLine = trim($lines[$j]);
                    // Stop if we encounter a new station, interface, or phy block
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
                $i = $j - 1; // Set outer loop index to continue from where inner loop left off
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
            // Expecting format: expires MAC_ADDRESS IP_ADDRESS HOSTNAME
            if (count($parts) >= 4) {
                $mac = strtolower($parts[1]);
                $ip = $parts[2];
                $hostname = $parts[3];
                $entry = ["ip" => $ip];
                if ($hostname !== '*') { // '*' indicates no hostname
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
        $dhcpData = null;
        $dhcpUrl = null;

        // Find the first router that has a dhcp_url specified and use it for DHCP leases
        foreach ($config["routers"] as $routerConf) {
            if (isset($routerConf["dhcp_url"])) {
                $dhcpUrl = $routerConf["dhcp_url"];
                break;
            }
        }

        // Add DHCP request if a URL is found
        if ($dhcpUrl) {
            $requests['dhcp'] = $client->getAsync($dhcpUrl, ['timeout' => 5])->then(
                function ($response) {
                    return (string)$response->getBody();
                },
                function (RequestException $e) {
                    error_log("DHCP URL request failed: " . $e->getMessage());
                    return null;
                }
            );
        }

        // Add info requests for each configured router
        foreach ($config["routers"] as $routerConf) {
            $routerId = $routerConf["id"] ?? null;
            $infoUrl = $routerConf["info_url"] ?? null;

            if (!$routerId || !$infoUrl) {
                error_log("Skipping router configuration due to missing ID or info_url: " . json_encode($routerConf));
                continue;
            }

            $requests[$routerId] = $client->getAsync($infoUrl, ['timeout' => 5])->then(
                function ($response) {
                    return (string)$response->getBody();
                },
                function (RequestException $e) use ($routerId) {
                    error_log("Router info URL request failed for " . $routerId . ": " . $e->getMessage());
                    return null;
                }
            );
        }

        // Wait for all requests to complete
        $results = Utils::settle($requests)->wait();

        // Process DHCP data
        if (isset($results['dhcp']) && $results['dhcp']['state'] === 'fulfilled' && $results['dhcp']['value'] !== null) {
            $dhcpData = $results['dhcp']['value'];
        }

        if ($dhcpData !== null) {
            $dhcpLeases = parseDhcp($dhcpData);
        }

        // Process each router's data
        $routerUptimes = [];
        foreach ($config["routers"] as $routerConf) {
            $routerId = $routerConf["id"] ?? null;
            if (!$routerId) continue; // Should not happen if config is valid, but good for safety

            $routerData = null;
            if (isset($results[$routerId]) && $results[$routerId]['state'] === 'fulfilled' && $results[$routerId]['value'] !== null) {
                $routerData = $results[$routerId]['value'];
            }

            if (empty($routerData)) {
                $routerUptimes[$routerId] = 'N/A'; // Indicate that data couldn't be fetched
                continue;
            }

            // Parse uptime and add to results
            $rawUptimeSeconds = parseUptime($routerData);
            $routerUptimes[$routerId] = (string)($rawUptimeSeconds ?? 'N/A');

            // Parse SSIDs and clients
            list($ssids, $clients) = parseSsidsClients($routerData);

            // Collect identified SSIDs
            foreach ($ssids as $ssidValue) {
                $identifiedSsids[] = str_replace(" ", "_", strtolower($ssidValue));
            }

            // Process clients, associating with DHCP leases and SSIDs
            foreach ($clients as $client) {
                $ssidKey = str_replace(" ", "_", strtolower($ssids[$client["interface"]] ?? "unknown_ssid"));

                // Get hostname from DHCP leases, fallback to IP, then MAC
                $hostname = $dhcpLeases[$client["mac"]]["hostname"] ?? ($dhcpLeases[$client["mac"]]["ip"] ?? $client["mac"]);

                $clientsBySsid[$ssidKey][] = [
                    "hostname" => $hostname,
                    "rx/tx" => (string)($client["rx_bytes"] ?? 'N/A') . "/" . (string)($client["tx_bytes"] ?? 'N/A'),
                    "uptime" => (string)($client["connected_time"] ?? 'N/A')
                ];
            }
        }

        // Prepare the final output structure
        $finalOutput = [
            "router_uptimes" => $routerUptimes
        ];

        // Get all unique SSIDs and sort them
        $allSsids = array_unique(array_merge($identifiedSsids, array_keys($clientsBySsid)));
        sort($allSsids);

        // Add client counts per SSID
        foreach ($allSsids as $ssidKey) {
            $finalOutput[$ssidKey] = (string)count($clientsBySsid[$ssidKey] ?? []);
        }

        // Explicitly add unknown_ssid count if present
        if (isset($clientsBySsid["unknown_ssid"])) {
            $finalOutput["unknown_ssid"] = (string)count($clientsBySsid["unknown_ssid"]);
        }

        // Calculate total clients
        $totalClients = 0;
        foreach ($clientsBySsid as $clients) {
            $totalClients += count($clients);
        }
        $finalOutput["total clients"] = (string)$totalClients;

        // Add detailed client data, sorted by SSID
        $sortedClientsData = [];
        foreach ($allSsids as $ssidKey) {
            $sortedClientsData[$ssidKey] = $clientsBySsid[$ssidKey] ?? [];
        }
        $finalOutput["clients"] = $sortedClientsData;

        // Set content type and output JSON
        header('Content-Type: application/json');
        echo json_encode($finalOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

// Route the request to the appropriate function
if (isset($_SERVER['REQUEST_URI']) && $_SERVER['REQUEST_URI'] === '/api/openwrt') {
    openwrtStatsEndpoint($config);
} else {
    // Handle 404 for other requests
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Not Found', 'message' => 'The requested URL was not found on this server.']);
    exit;
}

?>
