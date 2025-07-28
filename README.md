# OpenWrt WiFi Info API (PHP)

This project provides a PHP-based API to fetch and display real-time statistics from OpenWrt routers, including device uptime, connected Wi-Fi clients, and their data usage. It leverages Guzzle for asynchronous HTTP requests to ensure efficient data retrieval from multiple routers.

## Features

* **Router Uptime:** Displays the uptime for each configured router.

* **Wi-Fi Client Monitoring:** Lists connected clients per SSID, including their hostname (resolved via DHCP leases), RX/TX data, and connection uptime.

* **Asynchronous Data Fetching:** Uses Guzzle Promises to fetch data from multiple OpenWrt endpoints concurrently, improving performance.

* **JSON Output:** Provides data in a clean JSON format. Some fields, such as RX/TX and uptime for clients, may contain raw numerical data as provided by the router, depending on the script's configuration.

* **Nginx Front Controller:** Configured to use `api.php` as a central entry point for all API requests.

## Prerequisites

Before you begin, ensure you have the following installed and configured on your Orange Pi Zero 3 (or similar Linux server):

* **PHP 8.2+** with `php8.2-fpm`

* **Nginx**

* **Composer** (for Guzzle HTTP client)

* **OpenWrt Routers:** Configured to expose the necessary data endpoints (e.g., via `luci-app-statistics` or custom scripts that output `uptime`, `iw dev <interface> station dump`, and `cat /tmp/dhcp.leases`).

  * Ensure your OpenWrt routers are accessible via HTTP from your Orange Pi.

## Installation and Setup

Follow these steps to get the OpenWrt Statistics API up and running.

### 1. Clone the Repository

Assuming your web root is `/var/www/html/`, clone your project into a new directory:

```
cd /var/www/html/
git clone <your-repo-url> wifi
cd wifi


```

*(Replace `<your-repo-url>` with the actual URL of your GitHub repository.)*

### 2. Install PHP Dependencies

Navigate to your project directory and install Guzzle using Composer:

```
cd /var/www/html/wifi/
composer install


```

If `composer` command is not found, you may need to install it globally:

```
php -r "copy('[https://getcomposer.org/installer](https://getcomposer.org/installer)', 'composer-setup.php');"
sudo php composer-setup.php --install-dir=/usr/local/bin --filename=composer
php -r "unlink('composer-setup.php');"
composer --version


```

### 3. Configure `config.json`

Create a `config.json` file in your `/var/www/html/wifi/` directory. This file will define the OpenWrt routers and their respective data endpoints.

Example `config.json`:

```json
{
    "routers": [
        {
            "id": "router1",
            "info_url": "[http://192.168.1.1/cgi-bin/info.cgi](http://192.168.1.1/cgi-bin/info.cgi)",
            "dhcp_url": "[http://192.168.1.1/cgi-bin/dhcp.cgi](http://192.168.1.1/cgi-bin/dhcp.cgi)"
        },
        {
            "id": "router2",
            "info_url": "[http://192.168.1.2/cgi-bin/info.cgi](http://192.168.1.2/cgi-bin/info.cgi)"
        }
    ]
}
```

* **`id`**: A unique identifier for your router.

* **`info_url`**: The URL on your OpenWrt router that provides system information (e.g., uptime, Wi-Fi client data). This typically comes from `luci-app-statistics` or a custom script.

* **`dhcp_url`**: The URL on your OpenWrt router that provides DHCP lease information. This is used to resolve client hostnames from MAC addresses. Note that this field is optional for each router.

### 4. Configure Nginx

You need to create or modify an Nginx server block to serve your API. This configuration uses `api.php` as a front controller.

Create a new Nginx configuration file (e.g., `/etc/nginx/sites-available/wifi.conf`) or modify your `default` file.

```
# /etc/nginx/sites-available/wifi.conf
server {
    listen 80;
    server_name wifi.home 192.168.1.3; # Replace with your desired domain and Orange Pi's IP

    root /var/www/html/wifi; # Your project directory

    index index.html index.htm api.php; # api.php is now an index file

    location / {
        # Try to serve static files first, otherwise pass to api.php
        try_files $uri $uri/ /api.php?$args;
    }

    location ~ \.php$ {
        root /var/www/html/wifi; # Explicit root for PHP processing
        try_files $uri =404; # Ensure PHP file exists

        fastcgi_pass unix:/run/php/php8.2-fpm.sock; # Path to your PHP-FPM socket
        fastcgi_index api.php;

        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Security: Deny access to hidden files and Composer directories
    location ~ /\. {
        deny all;
    }

    location ~ /(composer\.json|composer\.lock|vendor) {
        deny all;
    }
}


```

**Enable the Nginx Configuration:**

If you created a new file, create a symlink to enable it:

```
sudo ln -s /etc/nginx/sites-available/wifi.conf /etc/nginx/sites-enabled/


```

**Test and Reload Nginx:**

```
sudo nginx -t
sudo systemctl reload nginx


```

### 5. Configure PHP-FPM

Ensure PHP-FPM is running and configured correctly.

* **Check PHP-FPM status:**

  ```
  sudo systemctl status php8.2-fpm
  
  
  ```

* **Check PHP-FPM socket permissions:**

  ```
  ls -l /run/php/php8.2-fpm.sock
  
  
  ```

  (Should be owned by `www-data:www-data` or similar, with read/write permissions for the group).

* **Configure PHP Error Logging:**
  Edit your `php.ini` (e.g., `/etc/php/8.2/fpm/php.ini` or `/etc/php/8.2/fpm/pool.d/www.conf`) to ensure errors are logged:

  ```
  error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
  display_errors = Off
  log_errors = On
  error_log = /var/log/fpm-php.www.log ; <--- Ensure this path is writable by www-data
  
  
  ```

  Create the log directory and set permissions if necessary:

  ```
  sudo mkdir -p /var/log/php
  sudo chown www-data:www-data /var/log/php
  sudo chmod 755 /var/log/php
  sudo touch /var/log/fpm-php.www.log # Create the log file
  sudo chown www-data:www-data /var/log/fpm-php.www.log # Set ownership
  sudo chmod 644 /var/log/fpm-php.www.log # Set permissions
  
  
  ```

* **Restart PHP-FPM:**

  ```
  sudo systemctl restart php8.2-fpm
  
  
  ```

### 6. Update Client `hosts` file (if using `wifi.home`)

On the machine you're using to access the API, edit your `hosts` file to map `wifi.home` to your Orange Pi's IP address.

* **Windows:** `C:\Windows\System32\drivers\etc\hosts`

* **macOS/Linux:** `/etc/hosts`

Add the following line (replace `192.168.1.3` with your Orange Pi's actual IP):

```
192.168.1.3 wifi.home


```

After modifying the `hosts` file, flush your client's DNS cache:

* **Windows:** `ipconfig /flushdns` (in Admin Command Prompt)

* **macOS:** `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`

* **Linux:** `sudo systemctl restart NetworkManager` or `sudo /etc/init.d/nscd restart`

## Usage

Access the API in your web browser or using `curl`:

```
curl [http://wifi.home/api/openwrt](http://wifi.home/api/openwrt)
# OR
curl [http://192.168.1.3/api/openwrt](http://192.168.1.3/api/openwrt)


```

You should receive a JSON response containing the OpenWrt statistics.

## Troubleshooting

* **"Downloaded `api.php` instead of execution" / "404 Not Found":**

  * **Nginx Configuration:** Double-check your Nginx `server` block for `wifi.home`. Ensure `root` is correct, `index` includes `api.php`, and the `location /` `try_files` directive correctly points to `/api.php?$args`.

  * **Nginx Reload:** Always `sudo systemctl reload nginx` after making changes.

  * **Client DNS/Hosts:** Verify your client machine's `hosts` file is correctly mapping `wifi.home` to your Orange Pi's IP, and flush DNS cache.

  * **Nginx Logs:** Check `/var/log/nginx/wifi.home_access.log` and `/var/log/nginx/wifi.home_error.log` for requests hitting the server. If no entries, the request isn't reaching Nginx.

* **"Empty Output" or "500 Internal Server Error":**

  * **PHP Error Log:** This is the most important. Check `/var/log/fpm-php.www.log` (or your configured `error_log` path) for specific PHP fatal errors or warnings.

  * **PHP-FPM Status:** Ensure `php8.2-fpm` is `active (running)`: `sudo systemctl status php8.2-fpm`.

  * **PHP-FPM Socket:** Verify the socket exists and has correct permissions: `ls -l /run/php/php8.2-fpm.sock`.

  * **`exit;` statement:** Ensure `exit;` is present after `echo json_encode(...)` in `api.php` to prevent unintended trailing output.

* **"Double JSON Output":**

  * This was a very rare issue that should be resolved by the `exit;` statements and the refined Nginx front-controller setup. If it re-occurs, double-check that `exit;` is truly present and that no other Nginx or PHP-FPM configuration is inadvertently causing a double execution. Check `__execution_id` in the output to confirm if it's one script execution outputting twice, or two separate executions.

## Contributing

Feel free to open issues or submit pull requests if you have improvements or bug fixes.
