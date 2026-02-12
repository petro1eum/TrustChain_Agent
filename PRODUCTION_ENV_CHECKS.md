# TrustChain Agent Production Env Checks

## Обязательная preflight-проверка

```bash
npm run trustchain:validate-prod-env
```

## Что валидируется

- `VITE_TRUSTCHAIN_STRICT_MODE=true`
- `VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP=false`
- при `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_CANARY=true`:
  - задан `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL`
  - задан `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID`
  - задан `VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY`
  - таймаут signer >= 1000 мс

## Рекомендация

Запускать preflight в staging и production перед стартом Vite/деплоем панели.
Если нужен простой контекст "зачем это все", сначала прочитайте `VAULT_OSS_SIMPLE_EXPLANATION.md`.
Для бесплатного стендового профиля с Vault OSS используйте `VAULT_OSS_QUICKSTART.md`.

## CI release gate (GitHub Actions)

Для workflow `trustchain-agent-env-preflight.yml` задайте:

- **Repository Variables**
  - `TCA_TRUSTCHAIN_STRICT_MODE`
  - `TCA_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP`
  - `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_CANARY`
  - `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_URL`
  - `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_TIMEOUT_MS`
  - `TCA_OPENAI_BASE_URL`
- **Repository Secrets**
  - `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID`
  - `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY`
  - `TCA_OPENAI_API_KEY`
