# Техническое Задание: Хостинг TrustChain Agent

**Дата:** 19.02.2026  
**Проект:** TrustChain Agent  
**Репозиторий:** [github.com/petro1eum/TrustChain_Agent](https://github.com/petro1eum/TrustChain_Agent)  
**Лицензия:** MIT  
**Ответственный:** _назначенный сотрудник_

---

## 1. Описание проекта

**TrustChain Agent** — криптографически верифицируемый AI-кодинг-агент с ReAct-циклом, планированием, рефлексией и исполнением кода в Docker-песочнице. Каждый вызов инструмента подписывается Ed25519.

### Стек технологий

| Уровень | Технология | Версия |
|---------|-----------|--------|
| **Frontend** | React + Vite + TailwindCSS v4 | React 19, Vite 7, TS 5.9 |
| **Backend** | Python FastAPI + Uvicorn | Python 3.12, FastAPI |
| **Sandbox** | Docker (gVisor-ready) | Ubuntu 24.04 образ |
| **Crypto** | TrustChain (Ed25519, Merkle) | OSS + Pro |
| **LLM** | OpenRouter / OpenAI API | — |
| **i18n** | i18next | EN/RU |
| **CI** | GitHub Actions | — |

### Порты (по умолчанию)

| Сервис | Порт |
|--------|------|
| Frontend (Vite dev / Nginx prod) | 9741 |
| Backend (FastAPI/Uvicorn) | 9742 |
| Playwright MCP | 8931 |

---

## 2. Задание по поиску домена

> [!IMPORTANT]
> Найти и зарегистрировать доменное имя, содержащее **trustchain**.

### Инструкции

1. **Проверить доступность** следующих доменов (и аналогичных):
   - `trustchain.ai`
   - `trustchain.dev`
   - `trustchain.io`
   - `trustchain.app`
   - `trustchain.tech`
   - `trustchain.tools`
   - `trustchain.pro`
   - `trustchainagent.com`
   - `trustchainagent.ai`
   - `trustchain-agent.com`
   - `trustchain-agent.dev`
   - `gettrust.chain` (хак с TLD)
   - `mytrust.chain`
   - `trustchain.network`
   - `trustchain.cloud`
   - `trustchain.solutions`

2. **Использовать сервисы поиска:**
   - [Namecheap](https://www.namecheap.com)
   - [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)
   - [Google Domains / Squarespace](https://domains.squarespace.com)
   - [GoDaddy](https://www.godaddy.com)
   - [Porkbun](https://porkbun.com)
   - [Name.com](https://www.name.com)

3. **Составить таблицу результатов:**

   | Домен | Доступен? | Цена/год | Регистратор | Примечание |
   |-------|-----------|----------|-------------|------------|
   | trustchain.ai | ? | ? | ? | предпочтительный |
   | ... | | | | |

4. **Критерии выбора (приоритет):**
   - `.ai` > `.dev` > `.io` > `.app` > `.com`
   - Короткое имя без дефисов предпочтительнее
   - Цена до $50/год приемлема, если больше — согласовать

---

## 3. Требования к серверу

### Минимальная конфигурация

| Параметр | Значение |
|----------|---------|
| CPU | 2 vCPU |
| RAM | 4 GB |
| Диск | 40 GB SSD |
| ОС | Ubuntu 22.04 / 24.04 LTS |
| Docker | 24+ |
| Node.js | 22.x |
| Python | 3.12 |

### Рекомендуемая конфигурация (продакшн)

| Параметр | Значение |
|----------|---------|
| CPU | 4 vCPU |
| RAM | 8 GB |
| Диск | 80 GB SSD |

### Варианты хостинга (исследовать и сравнить)

| Провайдер | Тип | Примечание |
|-----------|-----|------------|
| **Hetzner** | VPS | Оптимальное соотношение цена/качество (EU) |
| **DigitalOcean** | Droplet / App Platform | Простой UI, Docker-ready |
| **Railway / Render** | PaaS | Деплой из GitHub, но дороже |
| **Yandex Cloud** | VPS | Если нужен RU-регион |
| **AWS Lightsail** | VPS | Дешёвый вход в AWS |
| **Fly.io** | Container | Хорошо для Docker |

> [!TIP]
> Предпочтительный вариант: **VPS (Hetzner или DigitalOcean)** с ручной настройкой. Это даёт полный контроль над Docker-песочницей и портами.

---

## 4. Этапы развёртывания

### Этап 1: Подготовка сервера

- [ ] Выбрать и оплатить VPS
- [ ] Настроить SSH-доступ (ключи, отключить пароль)
- [ ] Создать пользователя `deploy` c sudo
- [ ] Установить: Docker, Docker Compose, Node.js 22.x, Python 3.12, Nginx, Certbot
- [ ] Настроить файрвол (UFW): открыть 22, 80, 443

### Этап 2: Доменное имя и DNS

- [ ] Зарегистрировать домен (см. раздел 2)
- [ ] Настроить DNS A-записи → IP сервера
- [ ] Настроить поддомены (опционально):
  - `app.trustchain.ai` → фронтенд
  - `api.trustchain.ai` → бэкенд

### Этап 3: SSL-сертификат

- [ ] Установить Certbot
- [ ] Получить Let's Encrypt сертификат: `certbot --nginx -d trustchain.ai -d www.trustchain.ai`
- [ ] Настроить автопродление

### Этап 4: Деплой приложения

- [ ] Клонировать репозиторий: `git clone https://github.com/petro1eum/TrustChain_Agent.git`
- [ ] Скопировать `.env.production.example` → `.env` и заполнить значения:
  ```
  VITE_OPENAI_API_KEY=<ключ>
  VITE_OPENAI_BASE_URL=https://openrouter.ai/api/v1
  VITE_BACKEND_URL=https://api.trustchain.ai
  VITE_TRUSTCHAIN_STRICT_MODE=true
  VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP=false
  ```
- [ ] Собрать фронтенд: `npm install && npm run build`
- [ ] Установить зависимости бэкенда: `pip install fastapi uvicorn docker trustchain`
- [ ] Собрать Docker-образ для песочницы: `docker build -f Dockerfile.agent -t trustchain-agent:latest .`
- [ ] Запустить preflight-проверку: `npm run trustchain:validate-prod-env`

### Этап 5: Nginx как reverse proxy

Настроить `/etc/nginx/sites-available/trustchain`:

```nginx
server {
    listen 443 ssl http2;
    server_name trustchain.ai www.trustchain.ai;

    ssl_certificate     /etc/letsencrypt/live/trustchain.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/trustchain.ai/privkey.pem;

    # Frontend — статика из dist/
    location / {
        root /opt/trustchain-agent/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:9742;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /trustchain/ {
        proxy_pass http://127.0.0.1:9742;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://127.0.0.1:9742;
    }

    location /metrics {
        proxy_pass http://127.0.0.1:9742;
        # Ограничить доступ
        # allow 10.0.0.0/8;
        # deny all;
    }
}

server {
    listen 80;
    server_name trustchain.ai www.trustchain.ai;
    return 301 https://$host$request_uri;
}
```

### Этап 6: Процесс-менеджер (systemd)

Создать `/etc/systemd/system/trustchain-backend.service`:

```ini
[Unit]
Description=TrustChain Agent Backend
After=network.target docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/trustchain-agent
ExecStart=/usr/bin/python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 9742
Restart=always
RestartSec=5
EnvironmentFile=/opt/trustchain-agent/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable trustchain-backend
sudo systemctl start trustchain-backend
```

---

## 5. CI/CD (GitHub Actions → Сервер)

### Базовый вариант: deploy по SSH

- [ ] Настроить GitHub Secrets: `SSH_HOST`, `SSH_KEY`, `SSH_USER`
- [ ] Workflow: при push в `main` → SSH → `git pull && npm run build && systemctl restart trustchain-backend`
- [ ] Добавить preflight-проверку в CI (см. `PRODUCTION_ENV_CHECKS.md`)

### Переменные для CI (из проекта)

| Variable / Secret | Описание |
|---|---|
| `TCA_TRUSTCHAIN_STRICT_MODE` | `true` |
| `TCA_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP` | `false` |
| `TCA_OPENAI_API_KEY` *(secret)* | Ключ OpenAI/OpenRouter |
| `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID` *(secret)* | ID ключа подписи |
| `TCA_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY` *(secret)* | Публичный ключ подписи |

---

## 6. Мониторинг и безопасность

- [ ] **Uptime monitoring**: Настроить пинг `/health` (UptimeRobot, BetterStack или аналог)
- [ ] **Логи**: Настроить `journalctl` для systemd-сервиса, ротацию логов
- [ ] **Метрики**: Эндпоинт `/metrics` уже существует (Prometheus-формат) — при необходимости подключить Grafana
- [ ] **Безопасность**:
  - Все секреты только через `.env` (не в Git)
  - SSH только по ключам
  - Ограничить `/metrics` по IP
  - Регулярные обновления ОС
- [ ] **Бэкапы**: Скрипт ежедневного бэкапа `/opt/trustchain-agent/data/` (если используется persistent memory)

---

## 7. Сроки и критерии приёмки

| # | Майлстоун | Срок | Критерий |
|---|-----------|------|----------|
| 1 | Таблица доменов | 1 день | Таблица с ≥10 проверенных доменов, рекомендация |
| 2 | Сервер готов | 2 дня | SSH-доступ, Docker работает, файрвол настроен |
| 3 | Домен + SSL | 1 день | HTTPS, редирект с HTTP, сертификат валиден |
| 4 | Деплой работает | 2 дня | Приложение открывается по домену, `/health` → `{"status":"ok"}` |
| 5 | CI/CD настроен | 1 день | Push в `main` → автодеплой на сервер |
| 6 | Мониторинг | 0.5 дня | Уведомления при даунтайме |

**Общий срок:** ~7 рабочих дней

---

## 8. Документация для сдачи

По завершении предоставить:

1. **Доменная таблица** — результаты поиска и финальный выбор
2. **Данные сервера** — IP, SSH-доступ, провайдер, тариф
3. **Конфигурация Nginx** — финальный файл
4. **Systemd-юнит** — файл сервиса
5. **CI/CD Workflow** — `.github/workflows/deploy.yml`
6. **Инструкция по обновлению** — шаги для ручного деплоя если CI сломан
