#!/bin/bash
curl -i "http://localhost:9742/api/browser/proxy?url=https://www.google.com" | grep -i -E "^(x-frame-options|content-security-policy)"
echo "Headers filtered successfully if nothing above."
