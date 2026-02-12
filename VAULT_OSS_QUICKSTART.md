# Vault OSS Quickstart для TrustChain

Перед запуском (если нужен контекст) прочитайте `VAULT_OSS_SIMPLE_EXPLANATION.md`.

## 1) Поднять Vault OSS (dev режим)

```bash
docker run --rm \
  --cap-add=IPC_LOCK \
  -e VAULT_DEV_ROOT_TOKEN_ID=root \
  -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 \
  -p 8200:8200 \
  hashicorp/vault:latest
```

## 2) Включить transit и создать ключ Ed25519

```bash
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=root

vault secrets enable transit
vault write -f transit/keys/trustchain-ed25519 type=ed25519
```

## 3) Получить `key_id` и `public_key`

```bash
VAULT_ADDR=http://127.0.0.1:8200 \
VAULT_TOKEN=root \
VAULT_TRANSIT_KEY=trustchain-ed25519 \
npm run trustchain:vault-key-info
```

Скопируйте из вывода:

- `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID`
- `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY`
- и эти же значения в allowlist MCP-сервера:
  - `TRUSTCHAIN_ALLOWED_KEY_IDS`
  - `TRUSTCHAIN_ALLOWED_PUBKEYS`

## 4) Запустить signer-bridge

```bash
VAULT_ADDR=http://127.0.0.1:8200 \
VAULT_TOKEN=root \
VAULT_TRANSIT_KEY=trustchain-ed25519 \
VAULT_SIGNER_PORT=9780 \
npm run trustchain:vault-bridge
```

## 5) Настроить `.env` агента

```env
VITE_TRUSTCHAIN_STRICT_MODE=true
VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP=false

VITE_TRUSTCHAIN_EXTERNAL_SIGNER_CANARY=true
VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL=http://127.0.0.1:9780
VITE_TRUSTCHAIN_EXTERNAL_SIGNER_TIMEOUT_MS=5000
VITE_TRUSTCHAIN_EXTERNAL_SIGNER_SIGN_PATH=/sign
VITE_TRUSTCHAIN_EXTERNAL_SIGNER_HEALTH_PATH=/health

VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID=<из trustchain:vault-key-info>
VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY=<из trustchain:vault-key-info>
```

## 6) Проверка

```bash
set -a; source .env; set +a
npm run trustchain:validate-prod-env
```

Если `ok=true`, агент готов к работе через Vault signer-bridge.

## Важно

- Dev Vault (`root` токен) использовать только для стенда/локальной проверки.
- Для production используйте отдельный Vault, политику least-privilege и ротацию токенов/ключей.
