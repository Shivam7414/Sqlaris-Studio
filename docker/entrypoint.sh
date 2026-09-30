#!/bin/sh
set -eu

# The viewer only answers requests from this computer. In a container, the
# host's requests arrive from the container network's gateway instead of
# 127.0.0.1, so that one address is allowed too, unless SQLARIS_ALLOW_FROM
# already says otherwise. The Host header must still be localhost or
# 127.0.0.1, and the port should be published on 127.0.0.1 only.
if [ -z "${SQLARIS_ALLOW_FROM:-}" ]; then
    # The default route's gateway, from the kernel's routing table. It is
    # written in hex, lowest byte first.
    gw=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route)

    if [ -n "$gw" ]; then
        byte() { printf '%d' "0x$(echo "$gw" | cut -c"$1")"; }
        SQLARIS_ALLOW_FROM="$(byte 7-8).$(byte 5-6).$(byte 3-4).$(byte 1-2)"
        export SQLARIS_ALLOW_FROM
    fi
fi

echo "Sqlaris Studio on port 8765, taking requests from ${SQLARIS_ALLOW_FROM:-127.0.0.1 only}"
exec php -S 0.0.0.0:8765 router.php
